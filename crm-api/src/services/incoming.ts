import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, type Lead } from '../db/schema.js';
import { bus } from '../lib/events.js';
import { normalizePhone } from '../lib/phone.js';
import { scheduleAiAnalysis } from './ai.js';
import { cancelPendingSteps } from './cadence.js';
import { cancelPendingTasks } from './tasks.js';
import { chatwoot, LABELS } from './chatwoot.js';
import { loadBroker } from './conversation.js';
import { ingestLead } from './leads.js';
import { logEvent } from './timeline.js';

export const TAG_ATENDIMENTO_HUMANO = 'Atendimento Humano';

/** Subconjunto do payload de webhook do Chatwoot que usamos. */
export interface ChatwootWebhook {
  event: string;
  id?: number;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  sender?: { id?: number; name?: string; phone_number?: string | null; type?: string };
  conversation?: {
    id: number;
    inbox_id?: number;
    meta?: { sender?: { id?: number; name?: string; phone_number?: string | null } };
    contact_inbox?: { contact_id?: number; source_id?: string };
  };
  inbox?: { id: number };
}

const isIncoming = (t: unknown) => t === 'incoming' || t === 0;

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };

export async function handleChatwootWebhook(p: ChatwootWebhook, log: Logger): Promise<{ handled: string }> {
  if (p.event !== 'message_created' || !p.conversation?.id) return { handled: 'ignorado' };

  const conversationId = p.conversation.id;
  const lead = await findLeadForConversation(p);

  if (!isIncoming(p.message_type)) {
    // Mensagem enviada (pelo CRM, nota da IA etc.): só avisa as telas abertas
    if (lead) bus.publish({ type: 'message.created', leadId: lead.id, brokerId: lead.brokerId, data: { messageId: p.id } });
    return { handled: 'saida' };
  }
  if (p.private) return { handled: 'ignorado' };

  const target = lead ?? (await createLeadFromInbound(p, log));
  if (!target) return { handled: 'sem-telefone' };

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    await cancelPendingSteps(tx, target.id, 'Cliente respondeu');
    await cancelPendingTasks(tx, target.id, 'Cliente respondeu');
    const tags = Array.from(new Set([...target.tags, TAG_ATENDIMENTO_HUMANO]));
    const stage = target.stage === 'NOVO_LEAD' || target.stage === 'LEAD_FRIO' ? 'AGUARDANDO_RESPOSTA' : target.stage;
    const [row] = await tx
      .update(leads)
      .set({ lastInboundAt: now, tags, stage, chatwootConversationId: conversationId, updatedAt: now })
      .where(eq(leads.id, target.id))
      .returning();
    await logEvent(tx, target.id, 'message.inbound', { messageId: p.id, preview: (p.content ?? '').slice(0, 200) });
    return row!;
  });

  chatwoot()
    .addLabels(conversationId, [LABELS.atendimentoHumano])
    .catch((err) => log.warn(`Não foi possível etiquetar a conversa ${conversationId}: ${String(err)}`));

  bus.publish({ type: 'message.created', leadId: updated.id, brokerId: updated.brokerId, data: { messageId: p.id, inbound: true } });
  bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId, data: { alert: 'aguardando_resposta' } });
  scheduleAiAnalysis(updated.id, log.warn);
  return { handled: 'entrada' };
}

async function findLeadForConversation(p: ChatwootWebhook): Promise<Lead | null> {
  const byConv = await db.select().from(leads).where(eq(leads.chatwootConversationId, p.conversation!.id));
  if (byConv[0]) return byConv[0];
  const phone = extractPhone(p);
  if (!phone) return null;
  const byPhone = await db.select().from(leads).where(eq(leads.phone, phone));
  return byPhone[0] ?? null;
}

function extractPhone(p: ChatwootWebhook): string | null {
  return normalizePhone(
    p.conversation?.meta?.sender?.phone_number ??
      (isIncoming(p.message_type) ? p.sender?.phone_number : null) ??
      p.conversation?.contact_inbox?.source_id ??
      null,
  );
}

/** Alguém chamou o número da Norden sem ter passado por campanha ou site: vira lead e entra na roleta. */
async function createLeadFromInbound(p: ChatwootWebhook, log: Logger): Promise<Lead | null> {
  const phone = extractPhone(p);
  if (!phone) {
    log.warn(`Mensagem recebida sem telefone identificável (conversa ${p.conversation?.id})`);
    return null;
  }
  const name = p.conversation?.meta?.sender?.name ?? p.sender?.name ?? 'Contato WhatsApp';
  const { lead, broker } = await ingestLead({ name, phone, source: 'WHATSAPP_DIRETO', skipCadence: true, raw: { conversationId: p.conversation?.id } });

  const contactId = p.conversation?.contact_inbox?.contact_id ?? p.conversation?.meta?.sender?.id ?? null;
  await db
    .update(leads)
    .set({ chatwootConversationId: p.conversation!.id, chatwootContactId: contactId })
    .where(eq(leads.id, lead.id));

  const assigned = broker ?? (await loadBroker(lead.brokerId));
  if (assigned?.chatwootAgentId) {
    await chatwoot()
      .assign(p.conversation!.id, assigned.chatwootAgentId)
      .catch((err) => log.warn(`Falha ao atribuir conversa no Chatwoot: ${String(err)}`));
  }
  const [fresh] = await db.select().from(leads).where(eq(leads.id, lead.id));
  return fresh ?? null;
}
