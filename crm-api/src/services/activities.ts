import { and, asc, desc, eq, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leadActivities, leads, leadTasks, users, type ActivityType, type LeadActivity } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { assertLeadAccess, leadScope, type AuthUser } from './access.js';
import { logEvent } from './timeline.js';

export interface ActivityView {
  id: string;
  leadId: string;
  leadName?: string;
  type: ActivityType;
  subject: string;
  notes: string | null;
  dueAt: string | null;
  durationMin: number | null;
  done: boolean;
  doneAt: string | null;
  brokerId: string | null;
  brokerName?: string | null;
  createdAt: string;
}

function view(a: LeadActivity, extra?: { leadName?: string; brokerName?: string | null }): ActivityView {
  return {
    id: a.id,
    leadId: a.leadId,
    leadName: extra?.leadName,
    type: a.type,
    subject: a.subject,
    notes: a.notes,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    durationMin: a.durationMin,
    done: a.done,
    doneAt: a.doneAt ? a.doneAt.toISOString() : null,
    brokerId: a.brokerId,
    brokerName: extra?.brokerName ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Carrega a atividade garantindo que o usuário pode ver o lead dela. */
async function loadActivityFor(user: AuthUser, id: string): Promise<{ activity: LeadActivity }> {
  const [activity] = await db.select().from(leadActivities).where(eq(leadActivities.id, id));
  if (!activity) throw notFound('Atividade');
  const [lead] = await db.select().from(leads).where(eq(leads.id, activity.leadId));
  if (!lead) throw notFound('Negócio');
  assertLeadAccess(user, lead);
  return { activity };
}

/** Atividades de um lead (pendentes primeiro por data; concluídas depois). */
export async function listForLead(user: AuthUser, leadId: string): Promise<ActivityView[]> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw notFound('Negócio');
  assertLeadAccess(user, lead);
  const rows = await db
    .select({ a: leadActivities, brokerName: users.name })
    .from(leadActivities)
    .leftJoin(users, eq(users.id, leadActivities.brokerId))
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(asc(leadActivities.done), asc(leadActivities.dueAt), desc(leadActivities.createdAt));
  return rows.map((r) => view(r.a, { brokerName: r.brokerName }));
}

export type AgendaFilter = 'todas' | 'para_fazer' | 'vencido' | 'hoje' | 'concluido';
export type AgendaSource = 'manual' | 'regua';

/** Item unificado da agenda: atividade manual OU ligação da régua (tarefa). */
export interface AgendaItem {
  source: 'activity' | 'task';
  id: string;
  leadId: string;
  leadName: string;
  type: ActivityType;
  subject: string;
  dueAt: string | null;
  done: boolean;
  doneAt: string | null;
  /** Para tarefas da régua concluídas: 'FEITA' | 'SEM_RESPOSTA'. */
  outcome: string | null;
  /** Veio da régua (automática) — não editável. */
  automatic: boolean;
  brokerName: string | null;
}

const ts = (d: Date | null | undefined) => (d ? d.getTime() : 0);

/**
 * Agenda global do corretor (tela Atividades), UNIFICADA: atividades manuais +
 * ligações da régua (lead_tasks). Mantém as duas fontes; só junta a visão.
 */
export async function listAgenda(
  user: AuthUser,
  opts: { filter?: AgendaFilter; type?: ActivityType; source?: AgendaSource; brokerId?: string | null },
  now = new Date(),
): Promise<AgendaItem[]> {
  const scope = leadScope(user);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const items: AgendaItem[] = [];

  // Atividades manuais (salvo quando o filtro é só "régua").
  if (opts.source !== 'regua') {
    const conds: SQL[] = [];
    if (scope) conds.push(scope);
    if (opts.type) conds.push(eq(leadActivities.type, opts.type));
    if (opts.brokerId) conds.push(eq(leadActivities.brokerId, opts.brokerId));
    const rows = await db
      .select({ a: leadActivities, leadName: leads.name, brokerName: users.name })
      .from(leadActivities)
      .innerJoin(leads, eq(leads.id, leadActivities.leadId))
      .leftJoin(users, eq(users.id, leadActivities.brokerId))
      .where(conds.length ? and(...conds) : sql`true`)
      .limit(500);
    for (const r of rows) {
      items.push({
        source: 'activity',
        id: r.a.id,
        leadId: r.a.leadId,
        leadName: r.leadName,
        type: r.a.type,
        subject: r.a.subject,
        dueAt: r.a.dueAt ? r.a.dueAt.toISOString() : null,
        done: r.a.done,
        doneAt: r.a.doneAt ? r.a.doneAt.toISOString() : null,
        outcome: null,
        automatic: false,
        brokerName: r.brokerName ?? null,
      });
    }
  }

  // Ligações da régua (lead_tasks) — só quando não filtra por outro tipo que não LIGACAO.
  if (opts.source !== 'manual' && (!opts.type || opts.type === 'LIGACAO')) {
    const conds: SQL[] = [ne(leadTasks.status, 'CANCELADA')];
    if (scope) conds.push(scope);
    if (opts.brokerId) conds.push(eq(leadTasks.brokerId, opts.brokerId));
    const rows = await db
      .select({ t: leadTasks, leadName: leads.name, brokerName: users.name })
      .from(leadTasks)
      .innerJoin(leads, eq(leads.id, leadTasks.leadId))
      .leftJoin(users, eq(users.id, leadTasks.brokerId))
      .where(and(...conds))
      .limit(500);
    for (const r of rows) {
      const done = r.t.status !== 'PENDENTE';
      items.push({
        source: 'task',
        id: r.t.id,
        leadId: r.t.leadId,
        leadName: r.leadName,
        type: 'LIGACAO',
        subject: r.t.title,
        dueAt: r.t.dueAt ? r.t.dueAt.toISOString() : null,
        done,
        doneAt: r.t.doneAt ? r.t.doneAt.toISOString() : null,
        outcome: done ? r.t.status : null,
        automatic: true,
        brokerName: r.brokerName ?? null,
      });
    }
  }

  // Filtro de situação aplicado ao conjunto unificado.
  const inToday = (iso: string | null) => iso !== null && ts(new Date(iso)) >= startOfDay.getTime() && ts(new Date(iso)) < endOfDay.getTime();
  const filtered = items.filter((it) => {
    switch (opts.filter) {
      case 'concluido':
        return it.done;
      case 'vencido':
        return !it.done && it.dueAt !== null && ts(new Date(it.dueAt)) < now.getTime();
      case 'hoje':
        return !it.done && inToday(it.dueAt);
      case 'para_fazer':
        return !it.done;
      default:
        return true; // todas
    }
  });

  filtered.sort((a, b) => {
    const d = Number(a.done) - Number(b.done); // pendentes primeiro
    if (d !== 0) return d;
    return (a.dueAt ? ts(new Date(a.dueAt)) : Infinity) - (b.dueAt ? ts(new Date(b.dueAt)) : Infinity);
  });
  return filtered.slice(0, 500);
}

/** Contagem por filtro (unificada) para as abas da tela Atividades. */
export async function agendaCounts(user: AuthUser, now = new Date()): Promise<{ para_fazer: number; vencido: number; hoje: number }> {
  const all = await listAgenda(user, { filter: 'todas' }, now);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  let para_fazer = 0, vencido = 0, hoje = 0;
  for (const it of all) {
    if (it.done) continue;
    para_fazer += 1;
    if (it.dueAt) {
      const t = ts(new Date(it.dueAt));
      if (t < now.getTime()) vencido += 1;
      if (t >= startOfDay.getTime() && t < endOfDay.getTime()) hoje += 1;
    }
  }
  return { para_fazer, vencido, hoje };
}

export async function createActivity(
  user: AuthUser,
  input: { leadId: string; type: ActivityType; subject: string; notes?: string | null; dueAt?: string | null; durationMin?: number | null; brokerId?: string | null },
): Promise<ActivityView> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
  if (!lead) throw notFound('Negócio');
  assertLeadAccess(user, lead);
  const [row] = await db
    .insert(leadActivities)
    .values({
      leadId: input.leadId,
      type: input.type,
      subject: input.subject.trim(),
      notes: input.notes?.trim() || null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      durationMin: input.durationMin ?? null,
      brokerId: input.brokerId ?? lead.brokerId ?? user.id,
      createdById: user.id,
    })
    .returning();
  await logEvent(db, input.leadId, 'activity.created', { id: row!.id, type: row!.type, subject: row!.subject, dueAt: input.dueAt ?? null }, user.id);
  return view(row!);
}

export async function updateActivity(
  user: AuthUser,
  id: string,
  patch: { type?: ActivityType; subject?: string; notes?: string | null; dueAt?: string | null; durationMin?: number | null; brokerId?: string | null },
): Promise<ActivityView> {
  const { activity } = await loadActivityFor(user, id);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.subject !== undefined) set.subject = patch.subject.trim();
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.durationMin !== undefined) set.durationMin = patch.durationMin;
  if (patch.brokerId !== undefined) set.brokerId = patch.brokerId;
  if (Object.keys(set).length === 1) throw new HttpError(400, 'Nada para atualizar');
  const [row] = await db.update(leadActivities).set(set).where(eq(leadActivities.id, id)).returning();
  await logEvent(db, activity.leadId, 'activity.updated', { id }, user.id);
  return view(row!);
}

export async function setActivityDone(user: AuthUser, id: string, done: boolean): Promise<ActivityView> {
  const { activity } = await loadActivityFor(user, id);
  const [row] = await db
    .update(leadActivities)
    .set({ done, doneAt: done ? new Date() : null, updatedAt: new Date() })
    .where(eq(leadActivities.id, id))
    .returning();
  if (done) await logEvent(db, activity.leadId, 'activity.done', { id, type: row!.type, subject: row!.subject }, user.id);
  return view(row!);
}

export async function deleteActivity(user: AuthUser, id: string): Promise<void> {
  const { activity } = await loadActivityFor(user, id);
  await db.delete(leadActivities).where(eq(leadActivities.id, id));
  await logEvent(db, activity.leadId, 'activity.deleted', { id }, user.id);
}

/** Próxima atividade pendente de um lead (para o selo no card). */
export async function nextActivityFor(leadId: string, now = new Date()): Promise<ActivityView | null> {
  void now;
  const [row] = await db
    .select()
    .from(leadActivities)
    .where(and(eq(leadActivities.leadId, leadId), eq(leadActivities.done, false), isNotNull(leadActivities.dueAt)))
    .orderBy(asc(leadActivities.dueAt))
    .limit(1);
  return row ? view(row) : null;
}
