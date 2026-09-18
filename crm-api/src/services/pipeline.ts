import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, pipelineStages, type PipelineStage } from '../db/schema.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';

/**
 * Papéis de sistema das etapas. Carregam comportamento no código (por isso a
 * CHAVE dessas etapas é fixa) e a etapa não pode ser excluída — só renomeada.
 *  - NEW: entrada, onde a régua começa (NOVO_LEAD)
 *  - AWAITING: cliente respondeu, aguardando o corretor (AGUARDANDO_RESPOSTA)
 *  - ACTIVE: em atendimento após enviar mensagem (EM_ATENDIMENTO)
 *  - WON: negócio fechado (NEGOCIO_FECHADO)
 *  - COLD: standby ao fim da cadência (LEAD_FRIO)
 *  - LOST: perdido, com motivo; mantém o lead na base (PERDIDO)
 */
export const STAGE_ROLE = {
  NEW: 'NEW',
  AWAITING: 'AWAITING',
  ACTIVE: 'ACTIVE',
  WON: 'WON',
  COLD: 'COLD',
  LOST: 'LOST',
} as const;

export function listStages(): Promise<PipelineStage[]> {
  return db.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
}

export async function getStageByKey(key: string): Promise<PipelineStage | undefined> {
  const [s] = await db.select().from(pipelineStages).where(eq(pipelineStages.key, key));
  return s;
}

/** Garante que a etapa existe; devolve a linha (com o papel de sistema). */
export async function assertStageKey(key: string): Promise<PipelineStage> {
  const s = await getStageByKey(key);
  if (!s) throw badRequest(`Etapa inválida: ${key}`);
  return s;
}

/** Gera uma chave estável a partir do nome (maiúsculas, sem acento). */
function slugKey(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return base || 'ETAPA';
}

export async function createStage(label: string): Promise<PipelineStage> {
  const trimmed = label.trim();
  if (!trimmed) throw badRequest('Informe o nome da etapa');

  const existing = new Set((await db.select({ k: pipelineStages.key }).from(pipelineStages)).map((r) => r.k));
  let key = slugKey(trimmed);
  if (existing.has(key)) {
    let i = 2;
    while (existing.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${pipelineStages.position}), 0)` })
    .from(pipelineStages);
  const [row] = await db
    .insert(pipelineStages)
    .values({ key, label: trimmed, position: Number(max) + 1, isSystem: false })
    .returning();
  return row!;
}

export async function renameStage(id: string, label: string): Promise<PipelineStage> {
  const trimmed = label.trim();
  if (!trimmed) throw badRequest('Informe o nome da etapa');
  const [row] = await db
    .update(pipelineStages)
    .set({ label: trimmed, updatedAt: new Date() })
    .where(eq(pipelineStages.id, id))
    .returning();
  if (!row) throw notFound('Etapa');
  return row;
}

/** Reordena as etapas: `ids` é a nova ordem completa. */
export async function reorderStages(ids: string[]): Promise<PipelineStage[]> {
  const all = await listStages();
  const same = ids.length === all.length && all.every((s) => ids.includes(s.id));
  if (!same) throw badRequest('A ordenação precisa conter todas as etapas, sem repetição.');
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(pipelineStages)
        .set({ position: i + 1, updatedAt: new Date() })
        .where(eq(pipelineStages.id, ids[i]!));
    }
  });
  return listStages();
}

export async function deleteStage(id: string): Promise<void> {
  const [s] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, id));
  if (!s) throw notFound('Etapa');
  if (s.isSystem) {
    throw badRequest('Etapas de sistema não podem ser excluídas — só renomeadas ou reordenadas.');
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.stage, s.key));
  if (Number(n) > 0) {
    throw new HttpError(409, `Existem ${n} lead(s) nesta etapa. Mova-os antes de excluir.`);
  }
  await db.delete(pipelineStages).where(eq(pipelineStages.id, id));
}
