import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { redisConnection } from '@/lib/redis';
import { CADENCIA_QUEUE_NAME, CadenciaJobPayload, agendarPasso, agendarParaData } from '@/queues/cadencia.queue';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { reservarSlotDeEnvio } from '@/lib/limite-diario';
import { proximaJanelaComercialAmanha } from '@/utils/horario-comercial';

const prisma = new PrismaClient();
const whatsappService = new WhatsappService(prisma);

/**
 * Worker que processa cada passo da régua de cadência (Passo 1 a 4).
 * Roda como processo independente (start:worker), separado da API HTTP.
 *
 * Fluxo por execução:
 * 1. Confirma que a execução ainda está ativa (pode ter sido cancelada pela
 *    Regra 3 - Gatilho de Interrupção - entre o agendamento e a execução do job).
 * 2. Envia o template do passo atual via WhatsApp.
 * 3. Se for o último passo (Passo 4), marca a cadência como concluída e o lead
 *    como 'frio_standby'. Caso contrário, agenda o próximo passo já respeitando
 *    o horário comercial, e salva o novo jobId para permitir cancelamento futuro.
 */
const worker = new Worker<CadenciaJobPayload>(
  CADENCIA_QUEUE_NAME,
  async (job) => {
    const { execucaoId, leadId } = job.data;

    const execucao = await prisma.leadCadenciaExecucao.findUnique({
      where: { id: execucaoId },
      include: { cadencia: { include: { passos: { orderBy: { ordem: 'asc' } } } } },
    });

    if (!execucao || execucao.status !== 'ativa') {
      // Execução foi cancelada (lead respondeu) — não faz nada.
      // Isso cobre o caso raro de o lead responder no exato instante em que
      // o worker já tinha pego o job da fila, antes do cancelamento surtir efeito.
      return;
    }

    const passoAtual = execucao.cadencia.passos.find((p) => p.ordem === execucao.passoAtual + 1);

    if (!passoAtual) {
      await prisma.leadCadenciaExecucao.update({
        where: { id: execucaoId },
        data: { status: 'concluida', proximoJobId: null },
      });
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { corretor: true } });
    if (!lead) return;

    // Trava Anti-Ban: tenta reservar um slot no teto diário de MAX_DAILY_MESSAGES
    // ANTES de enviar. Se o teto já foi atingido, o passo NÃO avança — ele é
    // reagendado para a próxima janela comercial (amanhã 09h), mantendo a
    // prioridade por ordem de passo (Passo 1 sempre na frente de 2/3/4 no backlog).
    const slotDisponivel = await reservarSlotDeEnvio();

    if (!slotDisponivel) {
      const proximaJanela = proximaJanelaComercialAmanha(new Date());

      const { jobId, agendadoPara } = await agendarParaData(
        { execucaoId, leadId },
        passoAtual.ordem,
        proximaJanela
      );

      await prisma.leadCadenciaExecucao.update({
        where: { id: execucaoId },
        data: { proximoJobId: jobId, proximoDisparoEm: agendadoPara },
      });

      // eslint-disable-next-line no-console
      console.warn(
        `[cadencia] Teto diário de ${process.env.MAX_DAILY_MESSAGES ?? 100} mensagens atingido — Passo ${passoAtual.ordem} do lead ${leadId} movido para o backlog de ${agendadoPara.toISOString()}`
      );
      return;
    }

    const template = passoAtual.templateMensagemId
      ? await prisma.templateMensagem.findUnique({ where: { id: passoAtual.templateMensagemId } })
      : null;

    if (template?.metaTemplateName && template.aprovadoMeta) {
      // Passo 1 usa apresentação dinâmica: "Olá {{2}}, aqui é {{1}}, consultor(a)
      // da Norden Imóveis...". Os demais passos só precisam do nome do lead.
      const parametros =
        passoAtual.ordem === 1
          ? [lead.corretor?.nome ?? 'nossa equipe', lead.nome ?? '']
          : lead.nome
            ? [lead.nome]
            : undefined;

      await whatsappService.enviarTemplate(
        leadId,
        {
          telefone: lead.telefone,
          nomeTemplate: template.metaTemplateName,
          idioma: 'pt_BR',
          parametros,
        },
        template.id
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[cadencia] Passo ${passoAtual.ordem} do lead ${leadId} não tem template aprovado configurado — envio pulado`
      );
    }

    const proximoPasso = execucao.cadencia.passos.find((p) => p.ordem === passoAtual.ordem + 1);

    if (!proximoPasso) {
      // Passo 4 (Despedida Elegante) foi o que acabou de disparar — fecha o ciclo
      await prisma.leadCadenciaExecucao.update({
        where: { id: execucaoId },
        data: { passoAtual: passoAtual.ordem, status: 'concluida', proximoJobId: null },
      });

      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'frio_standby' },
      });

      // eslint-disable-next-line no-console
      console.log(`[cadencia] Passo ${passoAtual.ordem} (último) disparado para lead ${leadId} — cadência concluída`);
      return;
    }

    // Agenda o próximo passo, já respeitando horário comercial
    const { jobId, agendadoPara } = await agendarPasso(
      { execucaoId, leadId },
      proximoPasso.ordem,
      proximoPasso.atrasoMinutos
    );

    await prisma.leadCadenciaExecucao.update({
      where: { id: execucaoId },
      data: {
        passoAtual: passoAtual.ordem,
        proximoJobId: jobId,
        proximoDisparoEm: agendadoPara,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `[cadencia] Passo ${passoAtual.ordem} disparado para lead ${leadId} — próximo passo agendado para ${agendadoPara.toISOString()}`
    );
  },
  { connection: redisConnection, concurrency: 5 }
);

worker.on('failed', (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[cadencia] job ${job?.id} falhou:`, err.message);
});

// eslint-disable-next-line no-console
console.log('🚀 Worker de cadência rodando...');
