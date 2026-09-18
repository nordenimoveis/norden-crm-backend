import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as pipeline from '../services/pipeline.js';
import type { PipelineStage } from '../db/schema.js';

function view(s: PipelineStage) {
  return {
    id: s.id,
    key: s.key,
    label: s.label,
    position: s.position,
    systemRole: s.systemRole,
    isSystem: s.isSystem,
  };
}

export default async function pipelineRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Etapas do funil (todos os usuários logados — o Kanban precisa). */
  app.get('/pipeline/stages', async () => {
    return (await pipeline.listStages()).map(view);
  });

  app.post('/pipeline/stages', { preHandler: app.requireManager }, async (req, reply) => {
    const { label } = z.object({ label: z.string().min(1).max(40) }).parse(req.body);
    return reply.code(201).send(view(await pipeline.createStage(label)));
  });

  app.patch<{ Params: { id: string } }>('/pipeline/stages/:id', { preHandler: app.requireManager }, async (req) => {
    const { label } = z.object({ label: z.string().min(1).max(40) }).parse(req.body);
    return view(await pipeline.renameStage(req.params.id, label));
  });

  app.post('/pipeline/stages/reorder', { preHandler: app.requireManager }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
    return (await pipeline.reorderStages(ids)).map(view);
  });

  app.delete<{ Params: { id: string } }>('/pipeline/stages/:id', { preHandler: app.requireManager }, async (req, reply) => {
    await pipeline.deleteStage(req.params.id);
    return reply.code(204).send();
  });
}
