import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as reasons from '../services/loss-reasons.js';
import type { LossReason } from '../db/schema.js';

const view = (r: LossReason) => ({ id: r.id, label: r.label, position: r.position, active: r.active });

export default async function lossReasonRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Motivos de perda (todos os usuários logados — o painel/Kanban usa ao marcar perda). */
  app.get('/loss-reasons', async () => {
    return (await reasons.listLossReasons()).map(view);
  });

  app.post('/loss-reasons', { preHandler: app.requireManager }, async (req, reply) => {
    const { label } = z.object({ label: z.string().min(1).max(60) }).parse(req.body);
    return reply.code(201).send(view(await reasons.createLossReason(label)));
  });

  app.patch<{ Params: { id: string } }>('/loss-reasons/:id', { preHandler: app.requireManager }, async (req) => {
    const b = z.object({ label: z.string().min(1).max(60).optional(), active: z.boolean().optional() }).parse(req.body);
    return view(await reasons.updateLossReason(req.params.id, b));
  });

  app.delete<{ Params: { id: string } }>('/loss-reasons/:id', { preHandler: app.requireManager }, async (req, reply) => {
    await reasons.deleteLossReason(req.params.id);
    return reply.code(204).send();
  });
}
