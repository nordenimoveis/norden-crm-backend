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
      const mensagem = (err as Error).message;
      if (mensagem === 'SEM_PERMISSAO') {
        return reply.code(403).send({ message: 'Você só pode editar leads atribuídos a você' });
      }
      if (mensagem === 'LEAD_NAO_ENCONTRADO') {
        return reply.code(404).send({ message: 'Lead não encontrado' });
      }
      throw err;
    }
  });

  app.patch('/leads/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = atualizarStatusSchema.parse(request.body);

    try {
      const lead = await service.atualizarStatus(id, body, request.user);
      return reply.send(lead);
    } catch (err) {
      const mensagem = (err as Error).message;
      if (mensagem === 'SEM_PERMISSAO') {
        return reply.code(403).send({ message: 'Você só pode mover leads atribuídos a você' });
      }
      if (mensagem === 'LEAD_NAO_ENCONTRADO') {
        return reply.code(404).send({ message: 'Lead não encontrado' });
      }
      throw err;
    }
  });

  app.patch('/leads/:id/temperatura', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = atualizarTemperaturaSchema.parse(request.body);

    try {
      const lead = await service.atualizarTemperatura(id, body, request.user);
      return reply.send(lead);
    } catch (err) {
      const mensagem = (err as Error).message;
      if (mensagem === 'SEM_PERMISSAO') {
        return reply.code(403).send({ message: 'Você só pode alterar a temperatura de leads atribuídos a você' });
      }
      if (mensagem === 'LEAD_NAO_ENCONTRADO') {
        return reply.code(404).send({ message: 'Lead não encontrado' });
      }
      throw err;
    }
  });

  app.patch(
    '/leads/:id/atribuir',
    { preHandler: [requireRole('gestor', 'admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = atribuirCorretorSchema.parse(request.body);

      try {
        const lead = await service.atribuirCorretor(id, body);
        return reply.send(lead);
      } catch (err) {
        if ((err as Error).message === 'CORRETOR_INVALIDO') {
          return reply.code(400).send({ message: 'Corretor de destino inválido ou inativo' });
        }
        throw err;
      }
    }
  );
}
