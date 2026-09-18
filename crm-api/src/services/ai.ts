import { eq } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { leads, type Lead, type LeadTemperature } from '../db/schema.js';
import { bus } from '../lib/events.js';
import { chatwoot } from './chatwoot.js';
import { loadBroker } from './conversation.js';
import { logEvent } from './timeline.js';

/**
 * Camada do Claude. O CRM envia o contexto ao n8n; o n8n chama a API da Anthropic
 * e devolve o resultado em POST /internal/ai/result. A resposta NUNCA é enviada ao cliente
 * automaticamente: vira nota privada e sugestão para o corretor revisar.
 */

const DEBOUNCE_MS = 30_000;
const timers = new Map<string, NodeJS.Timeout>();

/** Agrupa rajadas de mensagens do cliente numa única análise. */
export function scheduleAiAnalysis(leadId: string, log: (msg: string) => void = () => undefined) {
  if (!env().N8N_AI_WEBHOOK_URL) return;
  clearTimeout(timers.get(leadId));
  timers.set(
    leadId,
    setTimeout(() => {
      timers.delete(leadId);
      forwardToAi(leadId).catch((err) => log(`IA: falha ao analisar lead ${leadId}: ${String(err)}`));
    }, DEBOUNCE_MS),
  );
}

async function forwardToAi(leadId: string) {
  const url = env().N8N_AI_WEBHOOK_URL;
  if (!url) return;
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead?.chatwootConversationId) return;

  const broker = await loadBroker(lead.brokerId);
  const raw = await chatwoot().listMessages(lead.chatwootConversationId);
  const messages = raw
    .filter((m) => !m.private && m.content && (m.message_type === 0 || m.message_type === 1 || m.message_type === 'incoming' || m.message_type === 'outgoing'))
    .slice(-20)
    .map((m) => ({
      from: m.message_type === 0 || m.message_type === 'incoming' ? 'cliente' : 'corretor',
      text: m.content,
      at: new Date(m.created_at * 1000).toISOString(),
    }));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leadId: lead.id,
      lead: { name: lead.name, interest: lead.interest, source: lead.source, stage: lead.stage, temperature: lead.temperature },
      broker: { name: broker?.name ?? 'Equipe Norden' },
      messages,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`n8n respondeu ${res.status}`);
}

export interface AiResult {
  leadId: string;
  summary: string;
  suggestedTemperature: LeadTemperature;
  draftReply: string;
}

export async function applyAiResult(r: AiResult): Promise<Lead | null> {
  const [lead] = await db
    .update(leads)
    .set({ aiSummary: r.summary, aiSuggestedTemperature: r.suggestedTemperature, aiUpdatedAt: new Date() })
    .where(eq(leads.id, r.leadId))
    .returning();
  if (!lead) return null;

  await logEvent(db, lead.id, 'ai.suggestion', { summary: r.summary, suggestedTemperature: r.suggestedTemperature, draftReply: r.draftReply });

  if (lead.chatwootConversationId) {
    const note = `🤖 Assistente Norden\n\nResumo: ${r.summary}\nTemperatura sugerida: ${r.suggestedTemperature}\n\nSugestão de resposta:\n${r.draftReply}`;
    await chatwoot().sendText(lead.chatwootConversationId, note, { private: true }).catch(() => undefined);
  }

  bus.publish({
    type: 'ai.suggestion',
    leadId: lead.id,
    brokerId: lead.brokerId,
    data: { summary: r.summary, suggestedTemperature: r.suggestedTemperature, draftReply: r.draftReply },
  });
  return lead;
}
