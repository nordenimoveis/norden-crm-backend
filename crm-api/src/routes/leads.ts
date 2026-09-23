import { and, desc, eq, ilike, ne, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { cadenceSteps, leadEvents, leadSource, leads, leadTemperature, users, type Lead } from '../db/schema.js';
import { bus } from '../lib/events.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertLeadAccess, isManager, leadScope } from '../services/access.js';
import { cancelPendingSteps } from '../services/cadence.js';
import { cancelPendingTasks } from '../services/tasks.js';
import { chatwoot } from '../services/chatwoot.js';
import { ingestLead } from '../services/leads.js';
import { assertActiveLossReason } from '../services/loss-reasons.js';
import { STAGE_ROLE, assertStageKey } from '../services/pipeline.js';
import { logEvent } from '../services/timeline.js';

const ListQuery = z.object({
  stage: z.string().optional(),
  temperature: z.enum(leadTemperature.enumValues).optional(),
  source: z.enum(leadSource.enumValues).optional(),
  brokerId: z.string().uuid().optional(),
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
function view(l: Lead & { brokerName?: string | null }) {
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
    interest: l.interest,
    notes: l.notes,
    hasConversation: Boolean(l.chatwootConversationId),
    lastInboundAt: l.lastInboundAt,
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
    if (q.brokerId && isManager(req.user)) conds.push(eq(leads.brokerId, q.brokerId));
    if (!q.includeOld && q.source !== 'BASE_ANTIGA') conds.push(ne(leads.source, 'BASE_ANTIGA'));
    if (q.q) conds.push(or(ilike(leads.name, `%${q.q}%`), ilike(leads.phone, `%${q.q.replace(/\D/g, '') || q.q}%`), ilike(leads.email, `%${q.q}%`)));

    const rows = await db
      .select({ lead: leads, brokerName: users.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.brokerId))
      .where(and(...conds))
      .orderBy(desc(leads.updatedAt))
      .limit(q.limit);
    return rows.map((r) => view({ ...r.lead, brokerName: r.brokerName }));
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
    } else if (leavingLost) {
      // Saindo de "Perdido": recupera o lead (limpa motivo e data).
      set.lostReasonId = null;
      set.lostAt = null;
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
