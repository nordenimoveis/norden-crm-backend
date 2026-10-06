import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { leads } from '../db/schema.js';
import { matchKnownProduct } from '../lib/ctwa.js';
import { chatwoot } from './chatwoot.js';
import { knownProductNames } from './products.js';
import { logEvent } from './timeline.js';

/**
 * Empreendimentos conhecidos para detectar o produto: o catálogo de produtos
 * (nome + apelidos) somado à lista de CTWA_PRODUCTS do .env (fallback).
 */
export async function knownProducts(): Promise<string[]> {
  const fromEnv = env()
    .CTWA_PRODUCTS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let fromCatalog: string[] = [];
  try {
    fromCatalog = await knownProductNames();
  } catch {
    // catálogo indisponível: segue só com o env
  }
  return Array.from(new Set([...fromCatalog, ...fromEnv]));
}

const isIncoming = (t: unknown) => t === 0 || t === 'incoming';

/**
 * Varre o histórico da conversa procurando o empreendimento citado pelo cliente
 * (em qualquer mensagem de entrada, não só a última). Usa o catálogo de produtos.
 */
export async function scanConversationForProduct(
  conversationId: number,
  products: string[],
): Promise<string | undefined> {
  if (products.length === 0) return undefined;
  let msgs;
  try {
    msgs = await chatwoot().listMessages(conversationId);
  } catch {
    return undefined;
  }
  const text = msgs
    .filter((m) => !m.private && m.content && isIncoming(m.message_type))
    .map((m) => m.content)
    .join('\n');
  return matchKnownProduct(text, products);
}

/**
 * Reconhece o empreendimento nas conversas de leads já existentes que ainda não
 * têm produto: lê o histórico no Chatwoot e, achando um produto do catálogo,
 * grava em leads.interest. Não toca em leads que já têm produto. Só gestor.
 */
export async function rescanProducts(limit = 500): Promise<{ scanned: number; tagged: number }> {
  const products = await knownProducts();
  if (products.length === 0) return { scanned: 0, tagged: 0 };

  const rows = await db
    .select({ id: leads.id, conversationId: leads.chatwootConversationId })
    .from(leads)
    .where(
      and(
        isNotNull(leads.chatwootConversationId),
        or(sql`${leads.interest} is null`, eq(leads.interest, '')),
      ),
    )
    .limit(limit);

  let tagged = 0;
  for (const row of rows) {
    if (!row.conversationId) continue;
    const found = await scanConversationForProduct(row.conversationId, products);
    if (!found) continue;
    await db.update(leads).set({ interest: found, updatedAt: new Date() }).where(eq(leads.id, row.id));
    await logEvent(db, row.id, 'lead.enriched', { interest: found, via: 'rescan' });
    tagged += 1;
  }
  return { scanned: rows.length, tagged };
}
