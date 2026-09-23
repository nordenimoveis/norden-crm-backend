import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taskStatus } from '../db/schema.js';
import { completeTask, listTasks } from '../services/tasks.js';

const ListQuery = z.object({
  status: z.enum(taskStatus.enumValues).default('PENDENTE'),
});

const DoneBody = z.object({
  status: z.enum(['FEITA', 'SEM_RESPOSTA']),
  note: z.string().trim().max(1000).optional(),
});

/** Tarefas do corretor (hoje: ligações sugeridas pela régua). */
export default async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Lista as tarefas visíveis (corretor vê só as suas; gestor vê todas). */
  app.get('/tasks', async (req) => {
    const { status } = ListQuery.parse(req.query);
    return listTasks(req.user, status);
  });

  /** Conclui uma tarefa: "Falei com o cliente" (FEITA) ou "Não atendeu" (SEM_RESPOSTA). */
  app.post<{ Params: { id: string } }>('/tasks/:id/done', async (req) => {
    const b = DoneBody.parse(req.body);
    const task = await completeTask(req.user, req.params.id, b.status, b.note);
    return { id: task.id, status: task.status, doneAt: task.doneAt };
  });
}
