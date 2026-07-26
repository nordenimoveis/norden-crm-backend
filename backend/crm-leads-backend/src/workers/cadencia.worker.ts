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

/**
 * Worker do motor de disparo de campanhas em massa (Peça 4). Roda no MESMO
 * processo do worker de cadência (não precisa de um serviço novo no Railway)
 * — são filas diferentes, mas nada impede dois `Worker` no mesmo Node process.
 *
 * Cada job é UM destinatário de UMA campanha. Isso permite:
 * - Progresso granular (enviado/falhou por pessoa, não só por campanha)
 * - Reagendamento individual pro backlog do dia seguinte, se o teto diário
 *   bater no meio do envio (a campanha não perde o lugar na fila, só espera)
 */
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

    // Já processado, ou a campanha nunca devia ter chegado aqui (ex: cancelada
    // manualmente no banco) — não faz nada.
    if (!destinatario || destinatario.status !== 'pendente') return;
    if (destinatario.campanhaDisparo.status !== 'enviando') return;

    const template = destinatario.campanhaDisparo.templateMensagem;

    // Trava Anti-Ban: mesmo contador diário da cadência — o número não sabe
    // (nem deveria saber) se uma mensagem veio de campanha ou de cadência,
    // o teto protege a reputação do número como um todo.
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
            // Mídia é da CAMPANHA (midiaUrl), mas o TIPO vem do TEMPLATE
            // (midiaTipo) — é o template aprovado que define se o cabeçalho
            // é imagem/vídeo/documento, a campanha só fornece qual arquivo.
            midiaUrl: destinatario.campanhaDisparo.midiaUrl ?? undefined,
            midiaTipo: template.midiaTipo ?? undefined,
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

    // Se não sobrou nenhum destinatário pendente, a campanha terminou.
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
