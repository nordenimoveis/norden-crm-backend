import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, lossReasons, type LossReason } from '../db/schema.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';

export function listLossReasons(): Promise<LossReason[]> {
  return db.select().from(lossReasons).orderBy(asc(lossReasons.position), asc(lossReasons.createdAt));
}

/** Valida um motivo escolhido ao marcar a perda (precisa existir e estar ativo). */
export async function assertActiveLossReason(id: string): Promise<LossReason> {
  const [r] = await db.select().from(lossReasons).where(eq(lossReasons.id, id));
  if (!r || !r.active) throw badRequest('Motivo de perda inválido ou inativo');
  return r;
}

export async function createLossReason(label: string): Promise<LossReason> {
  const trimmed = label.trim();
  if (!trimmed) throw badRequest('Informe o motivo');
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${lossReasons.position}), 0)` })
    .from(lossReasons);
  const [row] = await db
    .insert(lossReasons)
    .values({ label: trimmed, position: Number(max) + 1 })
    .returning();
  return row!;
}

export async function updateLossReason(
  id: string,
  patch: { label?: string; active?: boolean },
): Promise<LossReason> {
  const set: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const trimmed = patch.label.trim();
    if (!trimmed) throw badRequest('Informe o motivo');
    set.label = trimmed;
  }
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) throw badRequest('Nada para atualizar');

  const [row] = await db.update(lossReasons).set(set).where(eq(lossReasons.id, id)).returning();
  if (!row) throw notFound('Motivo');
  return row;
}

/** Exclui um motivo. Se já estiver em uso, oriente a desativar (preserva o histórico). */
export async function deleteLossReason(id: string): Promise<void> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.lostReasonId, id));
  if (Number(n) > 0) {
    throw new HttpError(409, `Este motivo está em ${n} lead(s). Desative-o em vez de excluir.`);
  }
  const deleted = await db.delete(lossReasons).where(eq(lossReasons.id, id)).returning();
  if (deleted.length === 0) throw notFound('Motivo');
}
