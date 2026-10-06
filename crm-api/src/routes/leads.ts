import { and, count, desc, eq, ilike, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { cadenceSteps, campaigns, inboxStatus as inboxStatusEnum, leadEvents, leadSource, leads, leadTemperature, users, type Lead } from '../db/schema.js';
import { bus } from '../lib/events.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertLeadAccess, isManager, leadScope } from '../services/access.js';
import { cancelPendingSteps } from '../services/cadence.js';
import { cancelPendingTasks } from '../services/tasks.js';
import { chatwoot } from '../services/chatwoot.js';
import { ingestLead } from '../services/leads.js';
import { assertActiveLossReason } from '../services/loss-reasons.js';
import { STAGE_ROLE, assertStageKey, stageKeyByRole } from '../services/pipeline.js';
import { pickNextBroker } from '../services/roleta.js';
import { logEvent } from '../services/timeline.js';

const ListQuery = z.object({
  stage: z.string().optional(),
  temperature: z.enum(leadTemperature.enumValues).optional(),
  source: z.enum(leadSource.enumValues).optional(),
  brokerId: z.string().uuid().optional(),
  /** Nome da campanha do Meta Ads (origem do lead). */
  campaign: z.string().optional(),
  /** Filtra por uma etiqueta (ex.: "Proprietário", "Base Antiga"). */
  tag: z.string().optional(),
  /** Filtra pelo empreendimento/produto de interesse. */
  interest: z.string().optional(),
  /** Filtra pelo motivo de perda (na etapa Perdido). */
  lossReasonId: z.string().uuid().optional(),
  /** Só leads que já responderam (têm mensagem de entrada). */
  responded: z.coerce.boolean().optional(),
  /** Filtra pela campanha que a última resposta está respondendo (caixa por campanha). */
  respondingCampaignId: z.string().uuid().optional(),
  /** 'none' = respostas diretas (sem campanha associada). */
  respondingCampaign: z.enum(['none']).optional(),
  /** Estado de triagem na caixa "Responderam". */
  inboxStatus: z.enum(inboxStatusEnum.enumValues).optional(),
  q: z.string().trim().min(2).optional(),
  includeOld: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

const CreateLead = z.object({
  name: z.string().min(2),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  interest: z.string().optional(),
  notes: z.string().optional(),
  /** Só gestores escolhem o corretor; sem isso, passa pela roleta. */
  brokerId: z.string().uuid().optional(),
  startCadence: z.boolean().default(false),
});

/** Uma linha da importação em massa da base antiga. */
const ImportRow = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  interest: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const ImportBody = z.object({
  rows: z.array(ImportRow).min(1, 'Envie ao menos uma linha').max(5000, 'No máximo 5000 linhas por importação'),
});

const UpdateLead = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().nullable().optional(),
  stage: z.string().optional(),
  temperature: z.enum(leadTemperature.enumValues).optional(),
  interest: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  /** Obrigatório ao mover para uma etapa de papel LOST (Perdido). */
  lossReasonId: z.string().uuid().nullable().optional(),
});

/** Campos seguros para a tela (sem IDs internos desnecessários). */
function view(l: Lead & { brokerName?: string | null; lastCampaignName?: string | null }) {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    source: l.source,
    stage: l.stage,
    temperature: l.temperature,
    brokerId: l.brokerId,
    brokerName: l.brokerName ?? null,
    lostReasonId: l.lostReasonId,
    lostAt: l.lostAt,
    tags: l.tags,
    campaign: l.campaign,
    lastCampaignId: l.lastCampaignId,
    lastCampaignName: l.lastCampaignName ?? null,
    inFunnel: l.inFunnel,
    inboxStatus: l.inboxStatus,
    interest: l.interest,
    notes: l.notes,
    hasConversation: Boolean(l.chatwootConversationId),
    lastInboundAt: l.lastInboundAt,
    lastReadAt: l.lastReadAt,
    aiSummary: l.aiSummary,
    aiSuggestedTemperature: l.aiSuggestedTemperature,
    aiUpdatedAt: l.aiUpdatedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

async function loadLeadFor(req: { user: import('../services/access.js').AuthUser }, id: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) throw notFound('Lead');
  assertLeadAccess(req.user, lead);
  return lead;
}

export default async function leadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Kanban: lista leads visíveis ao usuário (o front agrupa por etapa). */
  app.get('/leads', async (req) => {
    const q = ListQuery.parse(req.query);
    const conds: (SQL | undefined)[] = [leadScope(req.user)];
    if (q.stage) conds.push(eq(leads.stage, q.stage));
    if (q.temperature) conds.push(eq(leads.temperature, q.temperature));
    if (q.source) conds.push(eq(leads.source, q.source));
    if (q.campaign) conds.push(eq(leads.campaign, q.campaign));
    if (q.tag) conds.push(sql`${q.tag} = ANY(${leads.tags})`);
    if (q.interest) conds.push(eq(leads.interest, q.interest));
    if (q.lossReasonId) conds.push(eq(leads.lostReasonId, q.lossReasonId));
    if (q.responded) conds.push(isNotNull(leads.lastInboundAt));
    if (q.respondingCampaignId) conds.push(eq(leads.lastCampaignId, q.respondingCampaignId));
    if (q.respondingCampaign === 'none') conds.push(sql`${leads.lastCampaignId} is null`);
    // 'NOVO' inclui quem respondeu antes do recurso (inbox_status null) e nunca mostra perdido.
    if (q.inboxStatus === 'NOVO') conds.push(sql`(${leads.inboxStatus} = 'NOVO' or ${leads.inboxStatus} is null) and ${leads.lostAt} is null`);
    else if (q.inboxStatus) conds.push(eq(leads.inboxStatus, q.inboxStatus));
    if (q.brokerId && isManager(req.user)) conds.push(eq(leads.brokerId, q.brokerId));
    // Kanban mostra só o funil ativo; "Base Antiga" (includeOld) ou filtro por origem liberam o resto.
    if (!q.includeOld && !q.source) conds.push(eq(leads.inFunnel, true));
    if (q.q) conds.push(or(ilike(leads.name, `%${q.q}%`), ilike(leads.phone, `%${q.q.replace(/\D/g, '') || q.q}%`), ilike(leads.email, `%${q.q}%`)));

    const rows = await db
      .select({ lead: leads, brokerName: users.name, lastCampaignName: campaigns.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.brokerId))
      .leftJoin(campaigns, eq(campaigns.id, leads.lastCampaignId))
      .where(and(...conds))
      .orderBy(desc(leads.updatedAt))
      .limit(q.limit);
    return rows.map((r) => view({ ...r.lead, brokerName: r.brokerName, lastCampaignName: r.lastCampaignName }));
  });

  /**
   * Listas por campanha do Meta Ads: cada campanha de origem com a contagem de
   * leads. Respeita o isolamento (corretor só vê as suas). Serve para filtrar o
   * funil e para montar o público de um disparo por campanha de origem.
   */
  app.get('/lead-campaigns', async (req) => {
    const scope = leadScope(req.user);
    const conds = [isNotNull(leads.campaign), ne(leads.campaign, '')];
    if (scope) conds.push(scope);
    const rows = await db
      .select({ campaign: leads.campaign, total: count() })
      .from(leads)
      .where(and(...conds))
      .groupBy(leads.campaign)
      .orderBy(desc(count()));
    return rows.map((r) => ({ campaign: r.campaign ?? '', total: Number(r.total) }));
  });

  /**
   * Empreendimentos/produtos distintos (de leads.interest) com contagem, para o
   * filtro por produto do funil. Respeita o isolamento por corretor.
   */
  app.get('/leads/interests', async (req) => {
    const scope = leadScope(req.user);
    const conds = [isNotNull(leads.interest), ne(leads.interest, '')];
    if (scope) conds.push(scope);
    const rows = await db
      .select({ interest: leads.interest, total: count() })
      .from(leads)
      .where(and(...conds))
      .groupBy(leads.interest)
      .orderBy(desc(count()));
    return rows.map((r) => ({ interest: r.interest ?? '', total: Number(r.total) }));
  });

  /**
   * Caixa "Responderam": quantos leads da Base Antiga (campanha) já responderam
   * e ainda não foram para o funil. Alimenta o contador do menu.
   */
  app.get('/leads/inbox-count', async (req) => {
    const scope = leadScope(req.user);
    const conds = [
      eq(leads.source, 'BASE_ANTIGA'),
      isNotNull(leads.lastInboundAt),
      // só os ainda não triados ("Novos"); null = respondeu antes do recurso; nunca perdido
      sql`(${leads.inboxStatus} = 'NOVO' or ${leads.inboxStatus} is null) and ${leads.lostAt} is null`,
      // não lido = respondeu depois da última leitura (ou nunca foi lido)
      sql`(${leads.lastReadAt} is null or ${leads.lastInboundAt} > ${leads.lastReadAt})`,
    ];
    if (scope) conds.push(scope);
    const [{ total }] = await db.select({ total: count() }).from(leads).where(and(...conds));
    return { count: Number(total) };
  });

  /**
   * Resumo por estado de triagem (Novos/Acompanhando/Sem interesse/Qualificados)
   * dentro do filtro de campanha atual. Alimenta o segmento de status da caixa.
   */
  app.get('/leads/inbox-status-summary', async (req) => {
    const q = z
      .object({ respondingCampaignId: z.string().uuid().optional(), respondingCampaign: z.enum(['none']).optional() })
      .parse(req.query);
    const scope = leadScope(req.user);
    const conds = [eq(leads.source, 'BASE_ANTIGA'), isNotNull(leads.lastInboundAt)];
    if (scope) conds.push(scope);
    if (q.respondingCampaignId) conds.push(eq(leads.lastCampaignId, q.respondingCampaignId));
    if (q.respondingCampaign === 'none') conds.push(sql`${leads.lastCampaignId} is null`);
    const c = (expr: ReturnType<typeof sql>) => sql<number>`count(*) filter (where ${expr})`;
    const [row] = await db
      .select({
        novos: c(sql`(${leads.inboxStatus} = 'NOVO' or ${leads.inboxStatus} is null) and ${leads.lostAt} is null`),
        acompanhando: c(sql`${leads.inboxStatus} = 'ACOMPANHANDO'`),
        semInteresse: c(sql`${leads.inboxStatus} = 'SEM_INTERESSE'`),
        qualificados: c(sql`${leads.inboxStatus} = 'QUALIFICADO'`),
      })
      .from(leads)
      .where(and(...conds));
    return {
      NOVO: Number(row?.novos ?? 0),
      ACOMPANHANDO: Number(row?.acompanhando ?? 0),
      SEM_INTERESSE: Number(row?.semInteresse ?? 0),
      QUALIFICADO: Number(row?.qualificados ?? 0),
    };
  });

  /**
   * Seletor da caixa "Responderam": agrupa os leads de campanha que responderam
   * pela campanha que a resposta está respondendo (lastCampaignId). Null vira o
   * balde "Sem campanha". Cada item traz total e quantos ainda não lidos.
   */
  app.get('/leads/responded-campaigns', async (req) => {
    const scope = leadScope(req.user);
    const conds = [eq(leads.source, 'BASE_ANTIGA'), isNotNull(leads.lastInboundAt)];
    if (scope) conds.push(scope);
    const unreadExpr = sql<number>`count(*) filter (where ${leads.lastReadAt} is null or ${leads.lastInboundAt} > ${leads.lastReadAt})`;
    const rows = await db
      .select({
        campaignId: leads.lastCampaignId,
        campaignName: campaigns.name,
        total: count(),
        unread: unreadExpr,
      })
      .from(leads)
      .leftJoin(campaigns, eq(campaigns.id, leads.lastCampaignId))
      .where(and(...conds))
      .groupBy(leads.lastCampaignId, campaigns.name)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? null,
      total: Number(r.total),
      unread: Number(r.unread),
    }));
  });

  /** Marca a conversa do lead como lida (controle persistente de "não lido"). */
  app.post<{ Params: { id: string } }>('/leads/:id/read', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    await db.update(leads).set({ lastReadAt: new Date() }).where(eq(leads.id, lead.id));
    return { ok: true };
  });

  /**
   * "Trazer para o funil": tira o lead da Base Antiga e o coloca no funil ativo,
   * atribuindo um corretor pela roleta (se ainda não tiver). Mantém a etiqueta de
   * origem. Usado na triagem dos leads de campanha que responderam.
   */
  app.post<{ Params: { id: string } }>('/leads/:id/promote', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      let brokerId = lead.brokerId;
      if (!brokerId) {
        const broker = await pickNextBroker(tx);
        brokerId = broker?.id ?? null;
      }
      // Entra no funil ativo SEM perder a origem real (fica como QUALIFICADO na caixa).
      const [row] = await tx
        .update(leads)
        .set({ inFunnel: true, inboxStatus: 'QUALIFICADO', brokerId, updatedAt: now })
        .where(eq(leads.id, lead.id))
        .returning();
      await logEvent(tx, lead.id, 'lead.promoted', { brokerId }, req.user.id);
      return row!;
    });
    const [broker] = updated.brokerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, updated.brokerId)) : [];
    bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId });
    return view({ ...updated, brokerName: broker?.name });
  });

  /**
   * "Sem interesse" (triagem): descarta o lead da caixa marcando como Perdido com
   * motivo. Sai do fluxo ativo mas permanece na base para campanhas futuras.
   */
  app.post<{ Params: { id: string } }>('/leads/:id/discard', async (req) => {
    const { lossReasonId } = z.object({ lossReasonId: z.string().uuid() }).parse(req.body);
    const lead = await loadLeadFor(req, req.params.id);
    await assertActiveLossReason(lossReasonId);
    const lostKey = await stageKeyByRole(STAGE_ROLE.LOST);
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      await cancelPendingSteps(tx, lead.id, 'Lead sem interesse (triagem)');
      await cancelPendingTasks(tx, lead.id, 'Lead sem interesse (triagem)');
      const [row] = await tx
        .update(leads)
        .set({ inboxStatus: 'SEM_INTERESSE', stage: lostKey, lostReasonId: lossReasonId, lostAt: now, updatedAt: now })
        .where(eq(leads.id, lead.id))
        .returning();
      await logEvent(tx, lead.id, 'lead.updated', { inboxStatus: 'SEM_INTERESSE', lossReasonId }, req.user.id);
      return row!;
    });
    bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId });
    return view(updated);
  });

  /** "Acompanhando" (triagem): sai de "Novos" sem desfecho, fica em acompanhamento. */
  app.post<{ Params: { id: string } }>('/leads/:id/follow', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    const [row] = await db
      .update(leads)
      .set({ inboxStatus: 'ACOMPANHANDO', updatedAt: new Date() })
      .where(eq(leads.id, lead.id))
      .returning();
    await logEvent(db, lead.id, 'lead.updated', { inboxStatus: 'ACOMPANHANDO' }, req.user.id);
    bus.publish({ type: 'lead.updated', leadId: row!.id, brokerId: row!.brokerId });
    return view(row!);
  });

  app.get<{ Params: { id: string } }>('/leads/:id', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    const [broker] = lead.brokerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, lead.brokerId)) : [];
    const [events, cadence] = await Promise.all([
      db.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)).orderBy(desc(leadEvents.createdAt)).limit(100),
      db.select().from(cadenceSteps).where(eq(cadenceSteps.leadId, lead.id)).orderBy(cadenceSteps.step),
    ]);
    return {
      lead: view({ ...lead, brokerName: broker?.name }),
      cadence: cadence.map((c) => ({ step: c.step, status: c.status, scheduledFor: c.scheduledFor, sentAt: c.sentAt, lastError: c.lastError })),
      events: events.map((e) => ({ id: e.id, type: e.type, payload: e.payload, createdAt: e.createdAt })),
    };
  });

  app.post('/leads', async (req, reply) => {
    const b = CreateLead.parse(req.body);
    if (!b.phone && !b.email) throw badRequest('Informe telefone ou e-mail');
    // Corretor que cadastra um lead fica com ele; gestor pode escolher ou usar a roleta
    const brokerId = isManager(req.user) ? b.brokerId : req.user.id;
    const { lead, created } = await ingestLead({
      name: b.name,
      phone: b.phone,
      email: b.email,
      interest: b.interest,
      notes: b.notes,
      source: 'MANUAL',
      brokerId,
      skipCadence: !b.startCadence,
      raw: { createdBy: req.user.id },
    });
    if (!created) {
      assertLeadAccess(req.user, lead);
      return reply.code(200).send({ lead: view(lead), duplicate: true });
    }
    return reply.code(201).send({ lead: view(lead), duplicate: false });
  });

  /**
   * Importação em massa da base antiga (só gestores). Grava cada linha com a
   * origem BASE_ANTIGA (etiqueta "Base Antiga", sem roleta e sem cadência) e
   * devolve um resumo com criados, duplicados e as linhas com erro.
   */
  app.post('/leads/import', { preHandler: app.requireManager }, async (req) => {
    const b = ImportBody.parse(req.body);
    let created = 0;
    let duplicate = 0;
    const errors: { row: number; name: string; message: string }[] = [];

    for (let i = 0; i < b.rows.length; i++) {
      const r = b.rows[i]!;
      const email = r.email && /.+@.+\..+/.test(r.email) ? r.email : null;
      try {
        const { created: isNew } = await ingestLead({
          name: r.name,
          phone: r.phone || null,
          email,
          interest: r.interest || null,
          notes: r.notes || null,
          source: 'BASE_ANTIGA',
          raw: { importedBy: req.user.id },
        });
        if (isNew) created += 1;
        else duplicate += 1;
      } catch (err) {
        errors.push({ row: i + 1, name: r.name, message: err instanceof Error ? err.message : 'Erro ao importar' });
      }
    }

    return { total: b.rows.length, created, duplicate, errors };
  });

  /** Edição rápida (etapa, temperatura etc.) direto do card. */
  app.patch<{ Params: { id: string } }>('/leads/:id', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    const b = UpdateLead.parse(req.body);
    const now = new Date();

    // Campos diretos; a lógica de etapa/perda entra depois.
    const set: Record<string, unknown> = { updatedAt: now };
    for (const k of ['name', 'email', 'stage', 'temperature', 'interest', 'notes', 'tags'] as const) {
      if (b[k] !== undefined) set[k] = b[k];
    }

    // A etapa de destino precisa existir; descobrimos o papel de sistema dela.
    let targetRole: string | null = null;
    if (b.stage) targetRole = (await assertStageKey(b.stage)).systemRole;

    const becomingLost = targetRole === STAGE_ROLE.LOST;
    const leavingLost = Boolean(b.stage) && lead.lostAt !== null && !becomingLost;

    if (becomingLost) {
      // Perda exige motivo (o já gravado serve se não vier outro).
      const reasonId = b.lossReasonId ?? lead.lostReasonId;
      if (!reasonId) throw badRequest('Informe o motivo da perda');
      await assertActiveLossReason(reasonId);
      set.lostReasonId = reasonId;
      set.lostAt = now;
      // Mantém a triagem em sincronia: perdido = "Sem interesse" na caixa.
      if (lead.inboxStatus) set.inboxStatus = 'SEM_INTERESSE';
    } else if (leavingLost) {
      // Saindo de "Perdido": recupera o lead (limpa motivo e data).
      set.lostReasonId = null;
      set.lostAt = null;
      // Reabre na triagem como "Novo" (se era um lead da caixa).
      if (lead.inboxStatus === 'SEM_INTERESSE') set.inboxStatus = 'NOVO';
    } else if (b.lossReasonId !== undefined && lead.lostAt !== null) {
      // Ajuste do motivo sem trocar de etapa.
      if (b.lossReasonId) await assertActiveLossReason(b.lossReasonId);
      set.lostReasonId = b.lossReasonId;
    }

    // A régua para ao sair de "Novo Lead" manualmente ou ao marcar como perdido.
    const cancelCadence =
      becomingLost || (b.stage !== undefined && b.stage !== 'NOVO_LEAD' && lead.stage === 'NOVO_LEAD');

    const updated = await db.transaction(async (tx) => {
      if (cancelCadence) {
        const reason = becomingLost ? 'Lead marcado como perdido' : `Etapa alterada manualmente para ${b.stage}`;
        await cancelPendingSteps(tx, lead.id, reason);
        await cancelPendingTasks(tx, lead.id, reason);
      }
      const [row] = await tx.update(leads).set(set).where(eq(leads.id, lead.id)).returning();
      const changes = Object.fromEntries(
        Object.entries(set)
          .filter(([k]) => k !== 'updatedAt')
          .map(([k, v]) => [k, { from: (lead as Record<string, unknown>)[k], to: v }]),
      );
      await logEvent(tx, lead.id, 'lead.updated', changes, req.user.id);
      return row!;
    });

    bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId });
    return view(updated);
  });

  /** Transferência entre corretores: só gestores. */
  app.post<{ Params: { id: string } }>('/leads/:id/transfer', { preHandler: app.requireManager }, async (req) => {
    const { brokerId } = z.object({ brokerId: z.string().uuid() }).parse(req.body);
    const [lead] = await db.select().from(leads).where(eq(leads.id, req.params.id));
    if (!lead) throw notFound('Lead');
    const [broker] = await db.select().from(users).where(and(eq(users.id, brokerId), eq(users.active, true)));
    if (!broker) throw badRequest('Corretor inválido ou inativo');

    const [updated] = await db.update(leads).set({ brokerId, updatedAt: new Date() }).where(eq(leads.id, lead.id)).returning();
    await logEvent(db, lead.id, 'lead.transferred', { from: lead.brokerId, to: brokerId, toName: broker.name }, req.user.id);

    if (lead.chatwootConversationId && broker.chatwootAgentId) {
      await chatwoot()
        .assign(lead.chatwootConversationId, broker.chatwootAgentId)
        .catch((err) => req.log.warn({ err }, 'Falha ao reatribuir conversa no Chatwoot'));
    }
    bus.publish({ type: 'lead.assigned', leadId: lead.id, brokerId, data: { previousBrokerId: lead.brokerId } });
    return view({ ...updated!, brokerName: broker.name });
  });

  /** Aceita a temperatura sugerida pela IA com um clique. */
  app.post<{ Params: { id: string } }>('/leads/:id/accept-ai-temperature', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    if (!lead.aiSuggestedTemperature) throw badRequest('Não há sugestão da IA para este lead');
    const [updated] = await db
      .update(leads)
      .set({ temperature: lead.aiSuggestedTemperature, updatedAt: new Date() })
      .where(eq(leads.id, lead.id))
      .returning();
    await logEvent(db, lead.id, 'lead.updated', { temperature: { from: lead.temperature, to: lead.aiSuggestedTemperature }, via: 'ia' }, req.user.id);
    bus.publish({ type: 'lead.updated', leadId: lead.id, brokerId: lead.brokerId });
    return view(updated!);
  });
}

export { loadLeadFor };
