import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as svc from '../services/campaigns.js';

const AudienceSchema = z.object({
  stages: z.array(z.string()).optional(),
  temperatures: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  brokerId: z.string().uuid().nullish(),
  includeOld: z.boolean().optional(),
});

export default async function campaignRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  // Campanhas e templates são só para gestores.
  app.addHook('preHandler', app.requireManager);

  /* ----- Catálogo de templates ----- */
  app.get('/campaign-templates', async () => {
    return (await svc.listTemplates()).map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      preview: t.preview,
      paramSources: t.paramSources,
      active: t.active,
    }));
  });

  app.post('/campaign-templates', async (req, reply) => {
    const b = z
      .object({
        name: z.string().min(1).max(80),
        preview: z.string().min(1).max(2000),
        paramSources: z.array(z.string().max(120)).max(10).optional(),
        language: z.string().max(10).optional(),
        category: z.string().max(30).optional(),
      })
      .parse(req.body);
    return reply.code(201).send(await svc.createTemplate(b));
  });

  app.patch<{ Params: { id: string } }>('/campaign-templates/:id', async (req) => {
    const b = z
      .object({
        name: z.string().min(1).max(80).optional(),
        preview: z.string().min(1).max(2000).optional(),
        paramSources: z.array(z.string().max(120)).max(10).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    return svc.updateTemplate(req.params.id, b);
  });

  app.delete<{ Params: { id: string } }>('/campaign-templates/:id', async (req, reply) => {
    await svc.deleteTemplate(req.params.id);
    return reply.code(204).send();
  });

  /* ----- Público ----- */
  app.post('/campaigns/preview-audience', async (req) => {
    const filters = AudienceSchema.parse(req.body);
    return { count: await svc.previewAudience(filters) };
  });

  /* ----- Campanhas ----- */
  app.get('/campaigns', async () => svc.listCampaigns());

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (req) => svc.getCampaign(req.params.id));

  app.post('/campaigns', async (req, reply) => {
    const b = z
      .object({ name: z.string().min(1).max(120), templateId: z.string().uuid(), filters: AudienceSchema })
      .parse(req.body);
    return reply.code(201).send(await svc.createCampaign(b, req.user.id));
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/launch', async (req) => {
    const { scheduledFor } = z.object({ scheduledFor: z.string().datetime().nullish() }).parse(req.body ?? {});
    return svc.launchCampaign(req.params.id, scheduledFor ? new Date(scheduledFor) : null);
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/cancel', async (req) => svc.cancelCampaign(req.params.id));

  app.delete<{ Params: { id: string } }>('/campaigns/:id', async (req, reply) => {
    await svc.deleteCampaign(req.params.id);
    return reply.code(204).send();
  });
}
