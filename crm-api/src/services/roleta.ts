import { and, asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { users, type User } from '../db/schema.js';

/**
 * Roleta (round-robin): escolhe o corretor ativo que recebeu lead há mais tempo.
 * O FOR UPDATE garante que dois leads simultâneos não caiam na mesma escolha.
 * Deve ser chamada dentro de uma transação.
 */
export async function pickNextBroker(tx: Tx): Promise<User | null> {
  const [broker] = await tx
    .select()
    .from(users)
    .where(and(eq(users.active, true), eq(users.inRotation, true)))
    .orderBy(sql`${users.lastAssignedAt} asc nulls first`, asc(users.createdAt))
    .limit(1)
    .for('update');

  if (!broker) return null;

  await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, broker.id));
  return broker;
}
