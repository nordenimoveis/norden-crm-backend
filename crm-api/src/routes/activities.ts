import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activityType } from '../db/schema.js';
import { isManager } from '../services/access.js';
import {
  agendaCounts,
  createActivity,
  deleteActivity,
  listAgenda,
  listForLead,
  setActivityDone,
  updateActivity,
} from '../services/activities.js';

const CreateBody = z.object({
  leadId: z.string().uuid(),
  type: z.enum(activityType.enumValues),
  subject: z.string().trim().min(1).max(140),
  notes: z.string().trim().max(2000).optional(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  durationMin: z.number().int().min(0).max(1440).nullish(),
  brokerId: z.string().uuid().nullish(),
});

const UpdateBody = z.object({
  type: z.enum(activityType.enumValues).optional(),
  subject: z.string().trim().min(1).max(140).optional(),
  notes: z.string().trim().max(2000).nullish(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  durationMin: z.number().int().min(0).max(1440).nullish(),
  brokerId: z.string().uuid().nullish(),
});

const AgendaQuery = z.object({
  filter: z.enum(['todas', 'para_fazer', 'vencido', 'hoje', 'concluido']).default('para_fazer'),
  type: z.enum(activityType.enumValues).optional(),
  brokerId: z.string().uuid().optional(),
});

export default async function activityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Agenda do corretor (tela Atividades). Corretor vê as suas; gestor vê todas. */
  app.get('/activities', async (req) => {
    const q = AgendaQuery.parse(req.query);
    const brokerId = isManager(req.user) ? q.brokerId : undefined;
    return listAgenda(req.user, { filter: q.filter, type: q.type, brokerId });
  });

  /** Contadores das abas (para fazer / vencido / hoje). */
  app.get('/activities/counts', async (req) => agendaCounts(req.user));

  /** Atividades de um negócio (lead). */
  app.get<{ Params: { leadId: string } }>('/leads/:leadId/activities', async (req) =>
    listForLead(req.user, req.params.leadId),
  );

  app.post('/activities', async (req, reply) => {
    const b = CreateBody.parse(req.body);
    return reply.code(201).send(await createActivity(req.user, b));
  });

  app.patch<{ Params: { id: string } }>('/activities/:id', async (req) => {
    const b = UpdateBody.parse(req.body);
    return updateActivity(req.user, req.params.id, b);
  });

  /** Marca como concluída (ou reabre). */
  app.post<{ Params: { id: string } }>('/activities/:id/done', async (req) => {
    const { done } = z.object({ done: z.boolean().default(true) }).parse(req.body ?? {});
    return setActivityDone(req.user, req.params.id, done);
  });

  app.delete<{ Params: { id: string } }>('/activities/:id', async (req, reply) => {
    await deleteActivity(req.user, req.params.id);
    return reply.code(204).send();
  });
}
