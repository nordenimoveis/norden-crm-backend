import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { leads } from '../db/schema.js';
import { bus } from '../lib/events.js';
import { HttpError } from '../lib/errors.js';
import { buildContext, renderTemplate } from '../lib/template.js';
import { TEMPLATE_PREVIEWS, cancelPendingSteps, templateName } from '../services/cadence.js';
import { chatwoot, type ChatwootMessage } from '../services/chatwoot.js';
import { brokerToken, ensureConversation, loadBroker } from '../services/conversation.js';
import { TAG_ATENDIMENTO_HUMANO } from '../services/incoming.js';
import { logEvent } from '../services/timeline.js';
import { loadLeadFor } from './leads.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Converte a mensagem do Chatwoot para o formato da tela (esconde dados internos). */
function toView(m: ChatwootMessage) {
  const type = m.message_type;
  const direction = type === 0 || type === 'incoming' ? 'in' : type === 2 || type === 'activity' ? 'system' : 'out';
  return {
    id: m.id,
    direction,
    private: m.private,
    text: m.content,
    at: new Date(m.created_at * 1000).toISOString(),
    senderName: direction === 'in' ? null : (m.sender?.name ?? null),
    status: m.status ?? null,
    attachments: (m.attachments ?? []).map((a) => ({ id: a.id, type: a.file_type, url: a.data_url, thumb: a.thumb_url })),
  };
}

export default async function conversationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Histórico do chat embutido. `before` = id da mensagem mais antiga já carregada (paginação). */
  app.get<{ Params: { id: string }; Querystring: { before?: string } }>('/leads/:id/messages', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    if (!lead.chatwootConversationId) {
      return { messages: [], canSendFreeText: false, windowExpiresAt: null };
    }
    const before = req.query.before ? Number(req.query.before) : undefined;
    const raw = await chatwoot().listMessages(lead.chatwootConversationId, { before });
    const windowExpiresAt = lead.lastInboundAt ? new Date(lead.lastInboundAt.getTime() + WINDOW_MS) : null;
    return {
      messages: raw.map(toView),
      canSendFreeText: Boolean(windowExpiresAt && windowExpiresAt > new Date()),
      windowExpiresAt,
    };
  });

  /**
   * Envia texto livre em nome do corretor.
   * Regra do WhatsApp: texto livre só dentro de 24h da última mensagem do cliente.
   */
  app.post<{ Params: { id: string } }>('/leads/:id/messages', async (req, reply) => {
    const { content } = z.object({ content: z.string().trim().min(1).max(4096) }).parse(req.body);
    const lead = await loadLeadFor(req, req.params.id);

    if (!lead.lastInboundAt || Date.now() - lead.lastInboundAt.getTime() > WINDOW_MS) {
      throw new HttpError(409, 'Fora da janela de 24h do WhatsApp: só é possível enviar um template aprovado.');
    }

    const broker = await loadBroker(lead.brokerId);
    const conversationId = await ensureConversation(lead, broker);
    // Gestor respondendo usa o token do sistema; corretor usa o próprio
    const token = req.user.id === broker?.id ? brokerToken(broker) : undefined;
    const msg = await chatwoot().sendText(conversationId, content, { token });

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      await cancelPendingSteps(tx, lead.id, 'Corretor assumiu a conversa');
      const stage = lead.stage === 'AGUARDANDO_RESPOSTA' || lead.stage === 'NOVO_LEAD' ? 'EM_ATENDIMENTO' : lead.stage;
      const tags = Array.from(new Set([...lead.tags, TAG_ATENDIMENTO_HUMANO]));
      const [row] = await tx.update(leads).set({ stage, tags, updatedAt: now }).where(eq(leads.id, lead.id)).returning();
      await logEvent(tx, lead.id, 'message.outbound', { messageId: msg.id }, req.user.id);
      return row!;
    });

    bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId });
    return reply.code(201).send(toView(msg));
  });

  /** Templates aprovados disponíveis para envio manual, com o texto já preenchido para o lead. */
  app.get<{ Params: { id: string } }>('/leads/:id/templates', async (req) => {
    const lead = await loadLeadFor(req, req.params.id);
    const broker = await loadBroker(lead.brokerId);
    const ctx = buildContext(lead, broker);
    return [1, 2, 3, 4].map((step) => ({
      step,
      name: templateName(step),
      preview: renderTemplate(TEMPLATE_PREVIEWS[step] ?? '', ctx),
    }));
  });

  /**
   * Envio manual de um template aprovado — funciona FORA da janela de 24h
   * (quando texto livre é bloqueado). Cancela a régua e move para "Em Atendimento".
   * Respeita CADENCE_SEND_ENABLED (modo simulado não envia de verdade).
   */
  app.post<{ Params: { id: string } }>('/leads/:id/template', async (req, reply) => {
    const { step } = z.object({ step: z.number().int().min(1).max(4) }).parse(req.body);
    const lead = await loadLeadFor(req, req.params.id);
    const broker = await loadBroker(lead.brokerId);
    const ctx = buildContext(lead, broker);
    const preview = renderTemplate(TEMPLATE_PREVIEWS[step] ?? '', ctx);
    const dryRun = !env().CADENCE_SEND_ENABLED;

    const conversationId = await ensureConversation(lead, broker);
    const token = req.user.id === broker?.id ? brokerToken(broker) : undefined;

    let view: unknown = { simulated: true, preview };
    if (!dryRun) {
      const msg = await chatwoot().sendTemplate(
        conversationId,
        { name: templateName(step), params: [ctx.lead_first_name ?? '', ctx.broker_first_name ?? ''] },
        preview,
        token,
      );
      view = toView(msg);
    }

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      await cancelPendingSteps(tx, lead.id, 'Corretor enviou template');
      const stage = lead.stage === 'AGUARDANDO_RESPOSTA' || lead.stage === 'NOVO_LEAD' ? 'EM_ATENDIMENTO' : lead.stage;
      const tags = Array.from(new Set([...lead.tags, TAG_ATENDIMENTO_HUMANO]));
      const [row] = await tx.update(leads).set({ stage, tags, updatedAt: now }).where(eq(leads.id, lead.id)).returning();
      await logEvent(tx, lead.id, dryRun ? 'template.simulated' : 'template.sent', { step, name: templateName(step) }, req.user.id);
      return row!;
    });

    bus.publish({ type: 'lead.updated', leadId: updated.id, brokerId: updated.brokerId });
    return reply.code(201).send(view);
  });

  /** Nota interna (não vai para o cliente). */
  app.post<{ Params: { id: string } }>('/leads/:id/notes', async (req, reply) => {
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);
    const lead = await loadLeadFor(req, req.params.id);
    const broker = await loadBroker(lead.brokerId);
    const conversationId = await ensureConversation(lead, broker);
    const token = req.user.id === broker?.id ? brokerToken(broker) : undefined;
    const msg = await chatwoot().sendText(conversationId, content, { token, private: true });
    await logEvent(db, lead.id, 'note.created', { messageId: msg.id }, req.user.id);
    return reply.code(201).send(toView(msg));
  });
}
