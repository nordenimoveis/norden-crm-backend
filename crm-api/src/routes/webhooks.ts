import type { FastifyInstance } from 'fastify';
import { env } from '../config.js';
import { safeEqual } from '../plugins/auth.js';
import { handleChatwootWebhook, type ChatwootWebhook } from '../services/incoming.js';
import { ingestLead } from '../services/leads.js';
import { mapImobziPayload } from '../lib/imobzi.js';

type Obj = Record<string, unknown>;

export default async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Querystring: { token?: string } }>('/webhooks/chatwoot', async (req, reply) => {
    if (!safeEqual(req.query.token, env().CHATWOOT_WEBHOOK_TOKEN)) return reply.code(401).send();
    const result = await handleChatwootWebhook(req.body as ChatwootWebhook, {
      info: (m) => req.log.info(m),
      warn: (m) => req.log.warn(m),
      error: (m) => req.log.error(m),
    });
    return result;
  });

  app.post<{ Querystring: { token?: string } }>('/webhooks/imobzi', async (req, reply) => {
    if (!safeEqual(req.query.token, env().IMOBZI_WEBHOOK_TOKEN)) return reply.code(401).send();
    const body = (req.body ?? {}) as Obj;
    const mapped = mapImobziPayload(body);
    if (!mapped.phone && !mapped.email) {
      req.log.warn({ body }, 'Webhook do Imobzi sem telefone/e-mail reconhecível');
      return reply.code(202).send({ accepted: false, reason: 'sem contato' });
    }
    const { lead, created } = await ingestLead({ ...mapped, source: 'SITE', raw: body });
    return reply.code(created ? 201 : 200).send({ id: lead.id, created });
  });
}
