import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { leadTemperature } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { applyAiResult } from '../services/ai.js';
import { runDueSteps } from '../services/cadence.js';
import { runDueCampaigns } from '../services/campaigns.js';
import { ingestLead } from '../services/leads.js';
import { runMetaPoll } from '../services/meta-poll.js';

const IngestBody = z.object({
  name: z.string().default(''),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  source: z.enum(['META_ADS', 'INSTAGRAM', 'SITE']),
  externalId: z.string().nullish(),
  campaign: z.string().nullish(),
  interest: z.string().nullish(),
  notes: z.string().nullish(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

const AiBody = z.object({
  leadId: z.string().uuid(),
  summary: z.string().min(1).max(2000),
  suggestedTemperature: z.enum(leadTemperature.enumValues).catch('NAO_AVALIADO'),
  draftReply: z.string().max(4000).default(''),
});

/** Rotas chamadas apenas pelo n8n (cabeçalho x-internal-key). */
export default async function internalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireInternal);

  app.post('/internal/leads/ingest', async (req, reply) => {
    const b = IngestBody.parse(req.body);
    const { lead, created } = await ingestLead(b);
    return reply.code(created ? 201 : 200).send({ id: lead.id, created, brokerId: lead.brokerId });
  });

  app.post('/internal/cadence/run', async () => runDueSteps());

  app.post('/internal/campaigns/run', async () => runDueCampaigns());

  /** Coletor de leads do Meta (puxa leads novos dos formulários, sem depender do webhook). */
  app.post('/internal/meta/poll', async () => runMetaPoll());

  app.post('/internal/ai/result', async (req) => {
    const b = AiBody.parse(req.body);
    const lead = await applyAiResult(b);
    if (!lead) throw notFound('Lead');
    return { ok: true };
  });
}
