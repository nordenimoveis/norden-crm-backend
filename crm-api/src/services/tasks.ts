import { and, eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { leadTasks, leads, users, type Lead, type LeadTask, type TaskStatus } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { bus } from '../lib/events.js';
import { assertLeadAccess, leadScope, type AuthUser } from './access.js';
import { logEvent } from './timeline.js';

/** Primeiro nome, para o título curto da tarefa. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Cria uma tarefa de ligação para o corretor dono do lead. Chamada pela régua
 * quando o cliente não respondeu (passos de canal CALL). Emite evento em tempo
 * real para a lista de tarefas e o contador aparecerem na hora.
 */
export async function createCallTask(
  tx: Tx,
  lead: Pick<Lead, 'id' | 'name' | 'brokerId'>,
  cadenceStep: number,
  now: Date,
): Promise<LeadTask> {
  const [task] = await tx
    .insert(leadTasks)
    .values({
      leadId: lead.id,
      brokerId: lead.brokerId,
      type: 'CALL',
      title: `Ligar para ${firstName(lead.name)}`,
      dueAt: now,
      cadenceStep,
    })
    .returning();
  await logEvent(tx, lead.id, 'task.created', { taskId: task!.id, type: 'CALL', cadenceStep });
  return task!;
}

/** Cancela as tarefas ainda pendentes de um lead (cliente respondeu, saiu da régua etc.). */
export async function cancelPendingTasks(tx: Tx, leadId: string, reason: string): Promise<number> {
  const cancelled = await tx
    .update(leadTasks)
    .set({ status: 'CANCELADA', note: reason })
    .where(and(eq(leadTasks.leadId, leadId), eq(leadTasks.status, 'PENDENTE')))
    .returning({ id: leadTasks.id });
  return cancelled.length;
}

export interface TaskView {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadInterest: string | null;
  brokerId: string | null;
  brokerName: string | null;
  type: string;
  status: TaskStatus;
  title: string;
  dueAt: Date;
  note: string | null;
  doneAt: Date | null;
  createdAt: Date;
}

/** Lista tarefas visíveis ao usuário (corretor vê só as suas; gestor vê todas). */
export async function listTasks(user: AuthUser, status: TaskStatus = 'PENDENTE'): Promise<TaskView[]> {
  const conds = [eq(leadTasks.status, status)];
  const scope = leadScope(user); // corretor: só os próprios leads
  if (scope) conds.push(scope);

  const rows = await db
    .select({
      task: leadTasks,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadInterest: leads.interest,
      brokerName: users.name,
    })
    .from(leadTasks)
    .innerJoin(leads, eq(leads.id, leadTasks.leadId))
    .leftJoin(users, eq(users.id, leadTasks.brokerId))
    .where(and(...conds))
    .orderBy(leadTasks.dueAt)
    .limit(500);

  return rows.map((r) => ({
    id: r.task.id,
    leadId: r.task.leadId,
    leadName: r.leadName,
    leadPhone: r.leadPhone,
    leadInterest: r.leadInterest,
    brokerId: r.task.brokerId,
    brokerName: r.brokerName ?? null,
    type: r.task.type,
    status: r.task.status,
    title: r.task.title,
    dueAt: r.task.dueAt,
    note: r.task.note,
    doneAt: r.task.doneAt,
    createdAt: r.task.createdAt,
  }));
}

/** Conclui uma tarefa: FEITA (falou com o cliente) ou SEM_RESPOSTA (não atendeu). */
export async function completeTask(
  user: AuthUser,
  taskId: string,
  status: Extract<TaskStatus, 'FEITA' | 'SEM_RESPOSTA'>,
  note?: string,
): Promise<LeadTask> {
  const [task] = await db.select().from(leadTasks).where(eq(leadTasks.id, taskId));
  if (!task) throw notFound('Tarefa');
  const [lead] = await db.select({ brokerId: leads.brokerId }).from(leads).where(eq(leads.id, task.leadId));
  if (!lead) throw notFound('Lead');
  assertLeadAccess(user, lead);
  if (task.status !== 'PENDENTE') throw badRequest('Tarefa já concluída');

  const now = new Date();
  const [updated] = await db
    .update(leadTasks)
    .set({ status, note: note?.trim() || task.note, doneAt: now, doneById: user.id })
    .where(eq(leadTasks.id, taskId))
    .returning();
  await logEvent(db, task.leadId, 'task.done', { taskId, status, note: note?.trim() || null }, user.id);
  bus.publish({ type: 'task.updated', leadId: task.leadId, brokerId: task.brokerId, data: { taskId, status } });
  return updated!;
}
