import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, users, type Lead, type User } from '../db/schema.js';
import { decrypt } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { chatwoot } from './chatwoot.js';

/** Token do corretor no Chatwoot (para as mensagens saírem no nome dele). Sem token, usa o do sistema. */
export function brokerToken(broker: Pick<User, 'chatwootTokenEnc'> | null | undefined): string | undefined {
  if (!broker?.chatwootTokenEnc) return undefined;
  return decrypt(broker.chatwootTokenEnc);
}

/**
 * Garante que o lead tenha contato e conversa no Chatwoot, atribuída ao corretor.
 * Idempotente: se já existir, só devolve o ID.
 */
export async function ensureConversation(lead: Lead, broker: User | null): Promise<number> {
  if (lead.chatwootConversationId) return lead.chatwootConversationId;
  if (!lead.phone) throw badRequest('Lead sem telefone não pode receber mensagens no WhatsApp');

  const cw = chatwoot();
  const contactId =
    lead.chatwootContactId ??
    (await cw.findOrCreateContact({ name: lead.name, phone: lead.phone, email: lead.email })).id;

  const conversation = await cw.createConversation({
    contactId,
    phone: lead.phone,
    assigneeId: broker?.chatwootAgentId ?? null,
  });

  await db
    .update(leads)
    .set({ chatwootContactId: contactId, chatwootConversationId: conversation.id, updatedAt: new Date() })
    .where(eq(leads.id, lead.id));

  return conversation.id;
}

export async function loadBroker(brokerId: string | null): Promise<User | null> {
  if (!brokerId) return null;
  const [b] = await db.select().from(users).where(eq(users.id, brokerId));
  return b ?? null;
}
