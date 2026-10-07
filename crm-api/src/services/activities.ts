import { and, asc, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leadActivities, leads, users, type ActivityType, type LeadActivity } from '../db/schema.js';
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

/** Agenda global do corretor (tela Atividades), com filtros estilo Pipedrive. */
export async function listAgenda(
  user: AuthUser,
  opts: { filter?: AgendaFilter; type?: ActivityType; brokerId?: string | null },
  now = new Date(),
): Promise<ActivityView[]> {
  const conds: (SQL | undefined)[] = [];
  const scope = leadScope(user);
  if (scope) conds.push(scope);
  if (opts.type) conds.push(eq(leadActivities.type, opts.type));
  if (opts.brokerId) conds.push(eq(leadActivities.brokerId, opts.brokerId));

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  switch (opts.filter) {
    case 'concluido':
      conds.push(eq(leadActivities.done, true));
      break;
    case 'vencido':
      conds.push(eq(leadActivities.done, false), isNotNull(leadActivities.dueAt), lt(leadActivities.dueAt, now));
      break;
    case 'hoje':
      conds.push(eq(leadActivities.done, false), isNotNull(leadActivities.dueAt), gte(leadActivities.dueAt, startOfDay), lt(leadActivities.dueAt, endOfDay));
      break;
    case 'para_fazer':
      conds.push(eq(leadActivities.done, false));
      break;
    default:
      break; // 'todas'
  }

  const rows = await db
    .select({ a: leadActivities, leadName: leads.name, brokerName: users.name })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .leftJoin(users, eq(users.id, leadActivities.brokerId))
    .where(and(...conds))
    .orderBy(asc(leadActivities.done), asc(leadActivities.dueAt), desc(leadActivities.createdAt))
    .limit(500);
  return rows.map((r) => view(r.a, { leadName: r.leadName, brokerName: r.brokerName }));
}

/** Contagem por filtro para as abas da tela Atividades. */
export async function agendaCounts(user: AuthUser, now = new Date()): Promise<{ para_fazer: number; vencido: number; hoje: number }> {
  const scope = leadScope(user);
  const base: SQL[] = [];
  if (scope) base.push(scope);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const c = (expr: SQL) => sql<number>`count(*) filter (where ${expr})`;
  const [row] = await db
    .select({
      para_fazer: c(sql`${leadActivities.done} = false`),
      vencido: c(sql`${leadActivities.done} = false and ${leadActivities.dueAt} is not null and ${leadActivities.dueAt} < ${now}`),
      hoje: c(sql`${leadActivities.done} = false and ${leadActivities.dueAt} >= ${startOfDay} and ${leadActivities.dueAt} < ${endOfDay}`),
    })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .where(base.length ? and(...base) : sql`true`);
  return { para_fazer: Number(row?.para_fazer ?? 0), vencido: Number(row?.vencido ?? 0), hoje: Number(row?.hoje ?? 0) };
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
