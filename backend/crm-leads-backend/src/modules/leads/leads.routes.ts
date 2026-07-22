import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { LeadsService } from './leads.service';
import {
  criarLeadSchema,
  atualizarLeadSchema,
  atualizarStatusSchema,
  atribuirCorretorSchema,
  atualizarTemperaturaSchema,
  listarLeadsQuerySchema,
} from './leads.schema';

export async function leadsRoutes(app: FastifyInstance) {
  const service = new LeadsService(app.prisma);

  app.addHook('preHandler', app.authenticate);

  app.get('/leads', async (request, reply) => {
    const query = listarLeadsQuerySchema.parse(request.query);
    const resultado = await service.listar(query, request.user);
    return reply.send(resultado);
  });

  app.get('/leads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const lead = await service.buscarPorId(id, request.user);
      if (!lead) return reply.code(404).send({ message: 'Lead não encontrado' });
      return reply.send(lead);
    } catch (err) {
      if ((err as Error).message === 'SEM_PERMISSAO') {
        return reply.code(403).send({ message: 'Você não tem acesso a este lead' });
      }
      throw err;
    }
  });

  app.post('/leads', async (request, reply) => {
    const body = criarLeadSchema.parse(request.body);
    const lead = await service.criar(body);
    return reply.code(201).send(lead);
  });

  app.patch('/leads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = atualizarLeadSchema.parse(request.body);

    try {
      const lead = await service.atualizar(id, body, request.user);
      return reply.send(lead);
    } catch (err) {
      const mensagem = (err as
