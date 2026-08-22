import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { cancelarJobAgendado } from '@/queues/cadencia.queue';
import { notificarNovaMensagem, notificarLeadAtualizado, notificarStatusMensagem } from '@/lib/pusher';
import { EnviarTextoInput, EnviarTemplateInput, WhatsappWebhookPayload } from './whatsapp.schema';
import { IaService } from '@/modules/ia/ia.service';
import { incrementarScore } from '@/lib/score.service';

const GRAPH_API_VERSION = 'v19.0';

export class WhatsappService {
  private iaService: IaService;

  constructor(private prisma: PrismaClient) {
    this.iaService = new IaService(prisma);
  }

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

    // Se foi um HUMANO que mandou essa mensagem (enviadaPorUsuarioId
    // presente) e a IA estava ativa nesse lead, o humano acabou de assumir
    // a conversa — pausa a IA automaticamente, pra ela não responder por
    // cima do que a pessoa acabou de escrever.
    if (enviadaPorUsuarioId) {
      await this.prisma.lead.updateMany({
        where: { id: leadId, statusIA: 'ativa' },
        data: { statusIA: 'pausada_humano' },
      });
    }

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
  /** Monta os componentes (cabeçalho de mídia + corpo) do payload de template. */
  private montarComponentesTemplate(input: EnviarTemplateInput): Record<string, unknown>[] {
    const componentes: Record<string, unknown>[] = [];

    // Cabeçalho de mídia entra ANTES do corpo — é assim que a API do
    // WhatsApp espera a ordem dos componentes.
    if (input.midiaUrl && input.midiaTipo) {
      componentes.push({
        type: 'header',
        parameters: [
          {
            type: input.midiaTipo,
            [input.midiaTipo]: { link: input.midiaUrl },
          },
        ],
      });
    }

    if (input.parametros && input.parametros.length > 0) {
      // Se o template usa variáveis NOMEADAS (nomes não-numéricos), a Meta
      // exige `parameter_name` em cada parâmetro. Para posicionais ({{1}}),
      // envia sem nome (formato clássico).
      const nomes = input.nomesVariaveis;
      const nomeado = Boolean(nomes && nomes.some((n) => !/^\d+$/.test(n)));

      componentes.push({
        type: 'body',
        parameters: input.parametros.map((texto, i) =>
          nomeado && nomes?.[i]
            ? { type: 'text', parameter_name: nomes[i], text: texto }
            : { type: 'text', text: texto }
        ),
      });
    }

    return componentes;
  }

  async enviarTemplate(leadId: string, input: EnviarTemplateInput, templateId?: string) {
    const componentes = this.montarComponentesTemplate(input);

    const whatsappMessageId = await this.chamarApi({
      messaging_product: 'whatsapp',
      to: input.telefone,
      type: 'template',
      template: {
        name: input.nomeTemplate,
        language: { code: input.idioma },
        components: componentes.length > 0 ? componentes : undefined,
      },
    });

    return this.registrarMensagemEnviada(
      leadId,
      `[template: ${input.nomeTemplate}]${input.midiaUrl ? ' 📎' : ''}`,
      whatsappMessageId,
      templateId
    );
  }

  /**
   * Envio TESTE de um template para um número avulso — NÃO registra Mensagem
   * nem exige um lead. Usado pelo compositor de campanha ("enviar teste para o
   * meu WhatsApp" antes de disparar para o público inteiro).
   */
  async enviarTemplateTeste(input: EnviarTemplateInput): Promise<string | undefined> {
    const componentes = this.montarComponentesTemplate(input);
    return this.chamarApi({
      messaging_product: 'whatsapp',
      to: input.telefone,
      type: 'template',
      template: {
        name: input.nomeTemplate,
        language: { code: input.idioma },
        components: componentes.length > 0 ? componentes : undefined,
      },
    });
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
      include: { enviadaPorUsuario: true }, // pro chat já exibir "enviado por Ana" sem esperar refetch
    });

    // Notifica o painel em tempo real (Pusher) — o chat aberto e o card no
    // board são atualizados sem precisar de polling.
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

    await notificarNovaMensagem({
      id: mensagem.id,
      leadId: mensagem.leadId,
      direcao: mensagem.direcao,
      conteudo: mensagem.conteudo,
      criadoEm: mensagem.criadoEm,
    });

    // Inteligência Norden — cada mensagem do lead soma ao score de
    // engajamento. Não trava o fluxo se falhar (não é crítico).
    incrementarScore(this.prisma, lead.id, 'mensagem_recebida').catch(() => {});

    // --- Ramo da IA ---------------------------------------------------
    // Se a IA está ativa pra esse lead, ela gera E MANDA a resposta
    // sozinha (sem revisão humana — decisão explícita do negócio). Se
    // falhar por qualquer motivo, cai pro comportamento padrão (marca
    // como precisa de atendimento humano), pra nunca deixar o lead sem
    // resposta nenhuma por causa de um erro técnico da IA.
    if (lead.statusIA === 'ativa') {
      try {
        const respostaIA = await this.iaService.gerarRespostaParaLead(lead.id, texto);

        if (respostaIA.trim()) {
          // telefoneOrigem é o número que acabou de escrever — sempre presente
          // aqui (o lead foi encontrado justamente por ele).
          await this.enviarTexto(lead.id, { telefone: telefoneOrigem, texto: respostaIA });
        }

        const leadAtualizado = await this.prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'respondeu' },
        });

        await notificarLeadAtualizado({
          id: leadAtualizado.id,
          status: leadAtualizado.status,
          atendimentoHumano: leadAtualizado.atendimentoHumano,
          corretorId: leadAtualizado.corretorId,
        });

        return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[ia] Falha ao gerar/enviar resposta automática pro lead ${lead.id}:`, err);
        // Cai pro fluxo padrão abaixo — marca como precisando de humano.
      }
    }

    /**
     * Gatilho de Interrupção Absoluta (Regra 3 da cadência):
     * destrói o job agendado no Redis, cancela a execução, marca o lead como
     * 'respondeu' + `atendimentoHumano = true`, e notifica o painel em tempo
     * real (Pusher) — é isso que faz o alerta "Aguardando Resposta" aparecer
     * no card do Kanban instantaneamente, sem o corretor precisar dar refresh.
     */
    const leadAtualizado = await this.prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'respondeu', atendimentoHumano: true },
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

    // Busca antes de atualizar para conseguir o id/leadId e notificar o
    // canal certo — updateMany não retorna os registros afetados.
    const mensagem = await this.prisma.mensagem.findFirst({ where: { whatsappMessageId } });
    if (!mensagem) return;

    await this.prisma.mensagem.update({ where: { id: mensagem.id }, data: { status: novoStatus } });

    await notificarStatusMensagem({ id: mensagem.id, leadId: mensagem.leadId, status: novoStatus });
  }
}
