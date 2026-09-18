import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { quickReplies } from '../db/schema.js';
import { forbidden, notFound } from '../lib/errors.js';
import { buildContext, renderTemplate } from '../lib/template.js';
import { isManager } from '../services/access.js';
import { loadBroker } from '../services/conversation.js';
import { loadLeadFor } from './leads.js';

const Body = z.object({
  /** Atalho digitado após "/" no chat, ex.: "visita" → /visita */
  shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,30}$/, 'Use letras, números, - ou _ (2 a 30)'),
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(1).max(2000),
  /** Só gestores criam respostas globais. */
  global: z.boolean().default(false),
});

export default async function quickReplyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Globais + pessoais do usuário. Variáveis: {{lead_name}}, {{lead_first_name}}, {{broker_name}}, {{broker_first_name}}, {{lead_interest}} */
  app.get('/quick-replies', async (req) => {
    const rows = await db
      .select()
      .from(quickReplies)
      .where(or(isNull(quickReplies.ownerId), eq(quickReplies.ownerId, req.user.id)))
      .orderBy(asc(quickReplies.shortcut));
    return rows.map((r) => ({ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body, global: r.ownerId === null }));
  });

  app.post('/quick-replies', async (req, reply) => {
    const b = Body.parse(req.body);
    if (b.global && !isManager(req.user)) throw forbidden();
    const [row] = await db
      .insert(quickReplies)
      .values({ shortcut: b.shortcut, title: b.title, body: b.body, ownerId: b.global ? null : req.user.id })
      .returning();
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/quick-replies/:id', async (req) => {
    const b = Body.omit({ global: true }).partial().parse(req.body);
    const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, req.params.id));
    if (!row) throw notFound('Resposta rápida');
    const canEdit = row.ownerId === req.user.id || (row.ownerId === null && isManager(req.user));
    if (!canEdit) throw forbidden();
    const [updated] = await db.update(quickReplies).set({ ...b, updatedAt: new Date() }).where(eq(quickReplies.id, row.id)).returning();
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/quick-replies/:id', async (req, reply) => {
    const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, req.params.id));
    if (!row) throw notFound('Resposta rápida');
    const canEdit = row.ownerId === req.user.id || (row.ownerId === null && isManager(req.user));
    if (!canEdit) throw forbidden();
    await db.delete(quickReplies).where(and(eq(quickReplies.id, row.id)));
    return reply.code(204).send();
  });

  /** Devolve o texto com as variáveis preenchidas para um lead específico. */
  app.post<{ Params: { id: string } }>('/quick-replies/:id/render', async (req) => {
    const { leadId } = z.object({ leadId: z.string().uuid() }).parse(req.body);
    const [row] = await db
      .select()
      .from(quickReplies)
      .where(and(eq(quickReplies.id, req.params.id), or(isNull(quickReplies.ownerId), eq(quickReplies.ownerId, req.user.id))));
    if (!row) throw notFound('Resposta rápida');
    const lead = await loadLeadFor(req, leadId);
    const broker = await loadBroker(lead.brokerId);
    return { text: renderTemplate(row.body, buildContext(lead, broker)) };
  });
}
