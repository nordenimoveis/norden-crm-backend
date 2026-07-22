import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { redisConnection } from '@/lib/redis';
import { CADENCIA_QUEUE_NAME, CadenciaJobPayload, agendarPasso, agendarParaData } from '@/queues/cadencia.queue';
import { CAMPANHA_QUEUE_NAME, CampanhaJobPayload } from '@/queues/campanha-disparo.queue';
import { campanhaQueue } from '@/queues/campanha-disparo.queue';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { reservarSlotDeEnvio } from '@/lib/limite-diario';
import { proximaJanelaComercialAmanha } from '@/utils/horario-comercial';

const prisma = new PrismaClient();
const whatsappService = new WhatsappService(prisma);

const worker = new Worker<CadenciaJobPayload>(
  CADENCIA_QUEUE_NAME,
  async (job) => {
    const { execucaoId, leadId } = job.data;

    const execucao = await prisma.leadCadenciaExecucao.findUnique({
      where: { id: execucaoId },
      include: { cadencia: { include: { passos: { orderBy: { ordem: 'asc' } } } } },
    });

    if (!execucao || execucao.status !== 'ativa') {
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

const campanhaWorker = new Worker<CampanhaJobPayload>(
  CAMPANHA_QUEUE_NAME,
  async (job) => {
    const { campanhaDisparoId, campanhaDisparoLeadId } = job.data;

    const destinatario = await prisma.campanhaDisparoLead.findUnique({
      where: { id: campanhaDisparoLeadId },
      include: {
        lead: true,
        campanhaDisparo: { include: { templateMensagem: true } },
      },
    });

    if (!destinatario || destinatario.status !== 'pendente') return;
    if (destinatario.campanhaDisparo.status !== 'enviando') return;

    const template = destinatario.campanhaDisparo.templateMensagem;

    const slotDisponivel = await reservarSlotDeEnvio();

    if (!slotDisponivel) {
      const proximaJanela = proximaJanelaComercialAmanha(new Date());
      const delayMs = Math.max(0, proximaJanela.getTime() - Date.now());

      await campanhaQueue.add(
        'disparar-campanha-lead',
        { campanhaDisparoId, campanhaDisparoLeadId },
        { delay: delayMs, jobId: `${job.id}-retry-${Date.now()}` }
      );

      // eslint-disable-next-line no-console
      console.warn(
        `[campanha] Teto diário atingido — destinatário ${campanhaDisparoLeadId} da campanha ${campanhaDisparoId} movido para o backlog de ${proximaJanela.toISOString()}`
      );
      return;
    }

    if (!template.metaTemplateName || !template.aprovadoMeta) {
      await prisma.campanhaDisparoLead.update({
        where: { id: campanhaDisparoLeadId },
        data: { status: 'falhou', erro: 'Template sem nome aprovado pela Meta configurado' },
      });
    } else {
      try {
        await whatsappService.enviarTemplate(
          destinatario.leadId,
          {
            telefone: destinatario.lead.telefone,
            nomeTemplate: template.metaTemplateName,
            idioma: 'pt_BR',
            parametros: destinatario.lead.nome ? [destinatario.lead.nome] : undefined,
          },
          template.id
        );

        await prisma.campanhaDisparoLead.update({
          where: { id: campanhaDisparoLeadId },
          data: { status: 'enviado', enviadoEm: new Date() },
        });
      } catch (err) {
        await prisma.campanhaDisparoLead.update({
          where: { id: campanhaDisparoLeadId },
          data: { status: 'falhou', erro: (err as Error).message },
        });
      }
    }

    const pendentesRestantes = await prisma.campanhaDisparoLead.count({
      where: { campanhaDisparoId, status: 'pendente' },
    });

    if (pendentesRestantes === 0) {
      await prisma.campanhaDisparo.update({
        where: { id: campanhaDisparoId },
        data: { status: 'concluida' },
      });

      // eslint-disable-next-line no-console
      console.log(`[campanha] Campanha ${campanhaDisparoId} concluída`);
    }
  },
  { connection: redisConnection, concurrency: 3 }
);

campanhaWorker.on('failed', (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[campanha] job ${job?.id} falhou:`, err.message);
});

// eslint-disable-next-line no-console
console.log('🚀 Worker de campanhas rodando...');

// eslint-disable-next-line no-console
console.log('🚀 Worker de cadência rodando...');
