import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { cancelarJobAgendado } from '@/queues/cadencia.queue';
import { notificarNovaMensagem, notificarLeadAtualizado, notificarStatusMensagem } from '@/lib/pusher';
import { EnviarTextoInput, EnviarTemplateInput, WhatsappWebhookPayload } from './whatsapp.schema';

const GRAPH_API_VERSION = 'v19.0';

export class WhatsappService {
  constructor(private prisma: PrismaClient) {}

  private get baseUrl() {
    return `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  }

  private async chamarApi(body: Record<string, unknown>) {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID não configurados');
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as { messages?: { id: string }[]; [key: string]: unknown };

    if (!response.ok) {
      throw new Error(`Falha ao enviar mensagem WhatsApp: ${JSON.stringify(json)}`);
    }

    return json.messages?.[0]?.id;
  }

  /**
   * Envia texto livre. SÓ funciona dentro da janela de 24h após a última mensagem
   * do lead. `enviadaPorUsuarioId` identifica qual corretor mandou (modelo de
   * Número Único: várias pessoas usam a mesma conexão de WhatsApp).
   */
  async enviarTexto(leadId: string, input: EnviarTextoInput, enviadaPorUsuarioId?: string) {
    const whatsappMessageId = await this.chamarApi({
      messaging_product: 'whatsapp',
      to: input.telefone,
      type: 'text',
      text: { body: input.texto },
    });

    return this.registrarMensagemEnviada(
      leadId,
      input.texto,
      whatsappMessageId,
      undefined,
      enviadaPorUsuarioId
    );
  }

  /**
   * Envia um template pré-aprovado. Usado pela cadência automática — nesse
   * caso `enviadaPorUsuarioId` fica de fora (null = mensagem automática).
   */
  async enviarTemplate(leadId: string, input: EnviarTemplateInput, templateId?: string) {
    const whatsappMessageId = await this.chamarApi({
      messaging_product: 'whatsapp',
      to: input.telefone,
      type: 'template',
      template: {
        name: input.nomeTemplate,
        language: { code: input.idioma },
        components: input.parametros
          ? [
              {
                type: 'body',
                parameters: input.parametros.map((texto) => ({ type: 'text', text: texto })),
              },
            ]
          : undefined,
      },
    });

    return this.registrarMensagemEnviada(
      leadId,
      `[template: ${input.nomeTemplate}]`,
      whatsappMessageId,
      templateId
    );
  }

  private async registrarMensagemEnviada(
    leadId: string,
    conteudo: string,
    whatsappMessageId?: string,
    templateId?: string,
    enviadaPorUsuarioId?: string
  ) {
    const mensagem = await this.prisma.mensagem.create({
      data: {
        leadId,
        direcao: 'enviada',
        conteudo,
        templateId,
        enviadaPorUsuarioId,
        status: whatsappMessageId ? 'enviada' : 'falhou',
        whatsappMessageId,
        enviadaEm: new Date(),
      },
      include: { enviadaPorUsuario: true },
    });

    await notificarNovaMensagem({
      id: mensagem.id,
      leadId: mensagem.leadId,
      direcao: mensagem.direcao,
      conteudo: mensagem.conteudo,
      criadoEm: mensagem.criadoEm,
    });

    return mensagem;
  }

  async processarWebhook(payload: WhatsappWebhookPayload) {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const { messages, statuses } = change.value;

        if (messages) {
          for (const msg of messages) {
            const conteudo = msg.text?.body ?? `[mensagem recebida - tipo: ${msg.type}]`;
            await this.processarMensagemRecebida(msg.from, conteudo);
          }
        }

        if (statuses) {
          for (const status of statuses) {
            await this.atualizarStatusMensagem(status.id, status.status);
          }
        }
      }
    }
  }

  /**
   * Gatilho de Interrupção Absoluta (Regra 3 da cadência):
   * destrói o job agendado no Redis, cancela a execução, marca o lead como
   * 'respondeu' + `atendimentoHumano = true`, e notifica o painel em tempo
   * real (Pusher).
   */
  private async processarMensagemRecebida(telefoneOrigem: string, texto: string) {
    const lead = await this.prisma.lead.findFirst({ where: { telefone: telefoneOrigem } });

    if (!lead) return;

    const mensagem = await this.prisma.mensagem.create({
      data: {
        leadId: lead.id,
        direcao: 'recebida',
        conteudo: texto,
        status: 'entregue',
      },
    });

    const execucoesAtivas = await this.prisma.leadCadenciaExecucao.findMany({
      where: { leadId: lead.id, status: 'ativa' },
    });

    await Promise.all(execucoesAtivas.map((execucao) => cancelarJobAgendado(execucao.proximoJobId)));

    await this.prisma.leadCadenciaExecucao.updateMany({
      where: { leadId: lead.id, status: 'ativa' },
      data: { status: 'cancelada', proximoJobId: null },
    });

    const leadAtualizado = await this.prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'respondeu', atendimentoHumano: true },
    });

    await notificarNovaMensagem({
      id: mensagem.id,
      leadId: mensagem.leadId,
      direcao: mensagem.direcao,
      conteudo: mensagem.conteudo,
      criadoEm: mensagem.criadoEm,
    });

    await notificarLeadAtualizado({
      id: leadAtualizado.id,
      status: leadAtualizado.status,
      atendimentoHumano: leadAtualizado.atendimentoHumano,
      corretorId: leadAtualizado.corretorId,
    });
  }

  private async atualizarStatusMensagem(whatsappMessageId: string, status: string) {
    const statusMap: Record<string, 'enviada' | 'entregue' | 'lida' | 'falhou'> = {
      sent: 'enviada',
      delivered: 'entregue',
      read: 'lida',
      failed: 'falhou',
    };

    const novoStatus = statusMap[status] ?? 'enviada';

    const mensagem = await this.prisma.mensagem.findFirst({ where: { whatsappMessageId } });
    if (!mensagem) return;

    await this.prisma.mensagem.update({ where: { id: mensagem.id }, data: { status: novoStatus } });

    await notificarStatusMensagem({ id: mensagem.id, leadId: mensagem.leadId, status: novoStatus });
  }
}
