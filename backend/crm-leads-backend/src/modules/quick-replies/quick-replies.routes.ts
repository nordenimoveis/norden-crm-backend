import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { QuickRepliesService } from './quick-replies.service';
import {
  criarQuickReplySchema,
  atualizarQuickReplySchema,
  buscarQuickReplyQuerySchema,
} from './quick-replies.schema';

export async function quickRepliesRoutes(app: FastifyInstance) {
  const service = new QuickRepliesService(app.prisma);

  app.addHook('preHandler', app.authenticate);

  // GET /api/quick-replies?busca=texto — usado pelo popover do "/" no chat
  app.get('/quick-replies', async (request, reply) => {
    const query = buscarQuickReplyQuerySchema.parse(request.query);
    const quickReplies = await service.listar(query, request.user);
    return reply.send(quickReplies);
  });

  app.post('/quick-replies', async (request, reply) => {
    const body = criarQuickReplySchema.parse(request.body);

    // Só gestor/admin pode criar um quick reply 'global'
    if (body.tipo === 'global' && request.user.papel === 'corretor') {
      return reply.code(403).send({ message: 'Apenas gestor/admin pode criar templates globais' });
    }

    const quickReply = await service.criar(body, request.user);
    return reply.code(201).send(quickReply);
  });

  app.patch('/quick-replies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = atualizarQuickReplySchema.parse(request.body);

    try {
      const quickReply = await service.atualizar(id, body, request.user);
      return reply.send(quickReply);
    } catch (err) {
      return tratarErro(err, reply);
    }
  });

  app.delete('/quick-replies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await service.deletar(id, request.user);
      return reply.code(204).send();
    } catch (err) {
      return tratarErro(err, reply);
    }
  });

  /**
   * POST /api/quick-replies/:id/enviar/:leadId — dispara o quick reply para
   * o lead, já com {{lead_name}} e {{broker_name}} substituídos.
   */
  app.post('/quick-replies/:id/enviar/:leadId', async (request, reply) => {
    const { id, leadId } = request.params as { id: string; leadId: string };

    try {
      const mensagem = await service.enviarParaLead(leadId, id, request.user);
      return reply.code(201).send(mensagem);
    } catch (err) {
      return tratarErro(err, reply);
    }
  });
}

function tratarErro(err: unknown, reply: any) {
  const mensagem = (err as Error).message;
  const mapa: Record<string, number> = {
    SEM_PERMISSAO: 403,
    QUICK_REPLY_NAO_ENCONTRADO: 404,
    LEAD_NAO_ENCONTRADO: 404,
  };

  if (mapa[mensagem]) {
    return reply.code(mapa[mensagem]).send({ message: mensagem });
  }

  throw err;
}
