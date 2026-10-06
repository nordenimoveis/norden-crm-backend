import { and, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaignRecipients, leads, type Lead } from '../db/schema.js';
import { bus } from '../lib/events.js';
import {
  type CtwaReferral,
  hasAdReferral,
  interestFromReferral,
  parseCtwaText,
  readReferral,
} from '../lib/ctwa.js';
import { normalizePhone } from '../lib/phone.js';
import { knownProducts, scanConversationForProduct } from './product-detect.js';
import { scheduleAiAnalysis } from './ai.js';
import { cancelPendingSteps } from './cadence.js';
import { cancelPendingTasks } from './tasks.js';
import { chatwoot, LABELS } from './chatwoot.js';
import { loadBroker } from './conversation.js';
import { ingestLead } from './leads.js';
import { notifyInbound } from './push.js';
import { logEvent } from './timeline.js';

export const TAG_ATENDIMENTO_HUMANO = 'Atendimento Humano';

/** Subconjunto do payload de webhook do Chatwoot que usamos. */
export interface ChatwootWebhook {
  event: string;
  id?: number;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  /** Atributos da mensagem (o referral do anúncio CTWA pode vir aqui). */
  content_attributes?: Record<string, unknown>;
  sender?: { id?: number; name?: string; phone_number?: string | null; type?: string };
  conversation?: {
    id: number;
    inbox_id?: number;
    meta?: { sender?: { id?: number; name?: string; phone_number?: string | null } };
    contact_inbox?: { contact_id?: number; source_id?: string };
    /** Atributos da conversa (o Chatwoot pode guardar o referral do anúncio aqui). */
    additional_attributes?: Record<string, unknown>;
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

  // Enriquecimento de origem/produto: só quando falta dado (lead sem produto ou
  // ainda marcado como WhatsApp direto), para não sobrescrever o que já é bom.
  const origin = (target.source === 'WHATSAPP_DIRETO' || !target.interest?.trim())
    ? await detectOrigin(p, conversationId, target, log)
    : null;

  const now = new Date();
  // Qual campanha esta resposta está respondendo (disparo mais recente antes dela).
  const respondingCampaignId = await findRespondingCampaign(target.id, now);
  const isInboxLead = target.source === 'BASE_ANTIGA';
  // Reengajamento: respondeu a um disparo DIFERENTE do último tratado e não está
  // ativo no funil → volta para "Novos" daquela campanha (nova oportunidade).
  const newDisparo = Boolean(respondingCampaignId && respondingCampaignId !== target.lastCampaignId);
  const reengage = isInboxLead && newDisparo && !target.inFunnel;
  // Reabrir um lead que estava Perdido quando reengaja por um disparo novo.
  const reopeningLost = reengage && target.lostAt !== null;

  const updated = await db.transaction(async (tx) => {
    await cancelPendingSteps(tx, target.id, 'Cliente respondeu');
    await cancelPendingTasks(tx, target.id, 'Cliente respondeu');
    const tags = Array.from(new Set([...target.tags, TAG_ATENDIMENTO_HUMANO]));
    const stage = reopeningLost || target.stage === 'NOVO_LEAD' || target.stage === 'LEAD_FRIO'
      ? 'AGUARDANDO_RESPOSTA'
      : target.stage;
    // Estado de triagem: reengajou → "Novo"; 1ª resposta da base → "Novo".
    const inboxPatch =
      reengage ? { inboxStatus: 'NOVO' as const }
      : isInboxLead && !target.inboxStatus ? { inboxStatus: 'NOVO' as const }
      : {};
    const [row] = await tx
      .update(leads)
      .set({
        lastInboundAt: now,
        tags,
        stage,
        chatwootConversationId: conversationId,
        ...(respondingCampaignId ? { lastCampaignId: respondingCampaignId } : {}),
        ...inboxPatch,
        ...(reopeningLost ? { lostAt: null, lostReasonId: null } : {}),
        ...(origin?.patch ?? {}),
        updatedAt: now,
      })
      .where(eq(leads.id, target.id))
      .returning();
    await logEvent(tx, target.id, 'message.inbound', { messageId: p.id, preview: (p.content ?? '').slice(0, 200) });
    if (reengage) await logEvent(tx, target.id, 'lead.reentry', { campaignId: respondingCampaignId, reopenedFromLost: reopeningLost });
    if (origin?.patch) await logEvent(tx, target.id, 'lead.enriched', origin.detail);
    return row!;
  });

  chatwoot()
    .addLabels(conversationId, [LABELS.atendimentoHumano])
    .catch((err) => log.warn(`Não foi possível etiquetar a conversa ${conversationId}: ${String(err)}`));

  bus.publish({ type: 'message.created', leadId: updated.id, brokerId: updated.brokerId, data: { messageId: p.id, inbound: true } });
  bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId, data: { alert: 'aguardando_resposta' } });
  // Notificação push (celular/desktop, mesmo com o CRM fechado) para o corretor + gestores.
  notifyInbound({ id: updated.id, name: updated.name, brokerId: updated.brokerId }).catch((err) =>
    log.warn(`Falha ao enviar notificação push (lead ${updated.id}): ${String(err)}`),
  );
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

/** Janela para associar uma resposta a uma campanha (dias). */
const CAMPAIGN_REPLY_WINDOW_DAYS = 30;

/**
 * Acha a campanha que a resposta do cliente está respondendo: o disparo mais
 * recente enviado a este lead dentro da janela. Null = resposta direta (sem campanha).
 */
async function findRespondingCampaign(leadId: string, now: Date): Promise<string | null> {
  const floor = new Date(now.getTime() - CAMPAIGN_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ campaignId: campaignRecipients.campaignId })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.leadId, leadId),
        isNotNull(campaignRecipients.sentAt),
        gte(campaignRecipients.sentAt, floor),
        lte(campaignRecipients.sentAt, now),
      ),
    )
    .orderBy(desc(campaignRecipients.sentAt))
    .limit(1);
  return row?.campaignId ?? null;
}

/**
 * Detecta a origem/produto de uma mensagem de entrada. Procura o referral do
 * anúncio (na mensagem, na conversa, ou buscando a conversa no Chatwoot) e lê o
 * texto pré-preenchido. Devolve o patch a aplicar e um detalhe para a timeline.
 */
async function detectOrigin(
  p: ChatwootWebhook,
  conversationId: number,
  current: Lead,
  log: Logger,
): Promise<{ patch: Partial<Lead>; detail: Record<string, unknown> } | null> {
  const products = await knownProducts();

  // Referral do anúncio: 1º do payload; se não vier, busca a conversa no Chatwoot.
  let referral: CtwaReferral | null = readReferral(p.content_attributes) ?? readReferral(p.conversation?.additional_attributes);
  if (!referral) {
    try {
      const conv = await chatwoot().getConversation(conversationId);
      referral = readReferral(conv.additional_attributes) ?? readReferral(conv.custom_attributes);
    } catch (err) {
      log.warn(`Não foi possível ler atributos da conversa ${conversationId}: ${String(err)}`);
    }
  }

  const parsed = parseCtwaText(p.content, products);
  // Produto: referral do anúncio → mensagem atual → histórico da conversa.
  let interest = interestFromReferral(referral, products) ?? parsed.interest;
  if (!interest && !current.interest?.trim()) {
    interest = await scanConversationForProduct(conversationId, products);
  }

  const patch: Partial<Lead> = {};
  if (interest && !current.interest?.trim()) patch.interest = interest;
  if (hasAdReferral(referral) && current.source === 'WHATSAPP_DIRETO') {
    patch.source = 'META_ADS';
    if (!current.campaign?.trim()) patch.campaign = (referral.headline ?? 'Meta Ads').slice(0, 140);
  }
  if (Object.keys(patch).length === 0) return null;

  return {
    patch,
    detail: {
      interest: patch.interest,
      source: patch.source,
      campaign: patch.campaign,
      via: hasAdReferral(referral) ? 'referral' : 'texto',
      fields: parsed.fields.slice(0, 10),
    },
  };
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
