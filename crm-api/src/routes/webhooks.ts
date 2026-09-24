import type { FastifyInstance } from 'fastify';
import { env } from '../config.js';
import { safeEqual } from '../plugins/auth.js';
import { handleChatwootWebhook, type ChatwootWebhook } from '../services/incoming.js';
import { ingestLead } from '../services/leads.js';
import { mapImobziPayload } from '../lib/imobzi.js';
import { cleanFormName, fetchFormName, fetchMetaLead, mapMetaLead } from '../lib/meta-leads.js';

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

  // Meta Lead Ads — verificação do webhook (GET). A Meta chama uma vez ao salvar a assinatura.
  app.get<{ Querystring: Record<string, string | undefined> }>('/webhooks/meta-leadgen', async (req, reply) => {
    const token = env().META_LEADGEN_TOKEN;
    const q = req.query;
    if (token && q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'], token)) {
      return reply.code(200).type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send();
  });

  // Meta Lead Ads — recebimento de leads (POST). Captura QUALQUER formulário da página.
  app.post<{ Querystring: { token?: string } }>('/webhooks/meta-leadgen', async (req, reply) => {
    const token = env().META_LEADGEN_TOKEN;
    if (!token || !safeEqual(req.query.token, token)) return reply.code(401).send();
    const body = (req.body ?? {}) as Obj;
    const entries = Array.isArray((body as Obj).entry) ? ((body as Obj).entry as Obj[]) : [];
    let created = 0;
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? (entry.changes as Obj[]) : [];
      for (const change of changes) {
        if (change?.field !== 'leadgen') continue;
        const value = (change.value ?? {}) as Obj;
        const leadgenId = value.leadgen_id;
        if (!leadgenId) continue;
        try {
          const lead = await fetchMetaLead(String(leadgenId));
          const mapped = mapMetaLead(lead);
          if (!mapped.phone && !mapped.email) {
            req.log.warn({ leadgenId }, 'Lead do Meta sem telefone/e-mail reconhecível');
            continue;
          }
          // Empreendimento: campo próprio do formulário ou, na falta, o nome do formulário.
          let interest = mapped.interest;
          if (!interest && mapped.formId) {
            interest = cleanFormName(await fetchFormName(mapped.formId));
          }
          const { created: isNew } = await ingestLead({
            name: mapped.name,
            phone: mapped.phone,
            email: mapped.email,
            source: 'META_ADS',
            externalId: mapped.externalId,
            campaign: mapped.campaign,
            interest,
            raw: lead as unknown as Record<string, unknown>,
          });
          if (isNew) created += 1;
        } catch (err) {
          // Não propaga: a Meta espera 200 rápido; o erro fica registrado para reprocessar depois.
          req.log.error({ err, leadgenId }, 'Falha ao processar lead do Meta');
        }
      }
    }
    return reply.code(200).send({ received: true, created });
  });
}
