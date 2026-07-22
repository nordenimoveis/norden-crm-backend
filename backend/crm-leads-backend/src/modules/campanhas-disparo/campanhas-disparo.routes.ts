import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { CampanhasDisparoService } from './campanhas-disparo.service';
import {
  criarCampanhaDisparoSchema,
  atualizarCampanhaDisparoSchema,
  filtroPublicoSchema,
} from './campanhas-disparo.schema';

const MENSAGENS_ERRO: Record<string, { status: number; message: string }> = {
  TEMPLATE_NAO_ENCONTRADO: { status: 404, message: 'Template não encontrado' },
  TEMPLATE_NAO_APROVADO: {
    status: 400,
    message: 'Esse template ainda não foi aprovado pela Meta — não pode ser usado em disparo em massa',
  },
  PUBLICO_VAZIO: { status: 400, message: 'Nenhum lead encontrado com esse filtro' },
  CAMPANHA_NAO_ENCONTRADA: { status: 404, message: 'Campanha não encontrada' },
  CAMPANHA_NAO_EDITAVEL: { status: 400, message: 'Só é possível editar/apagar campanhas em rascunho' },
};

function tratarErro(err: unknown, reply: import('fastify').FastifyReply) {
  const mensagem = (err as Error).message;
  const erro = MENSAGENS_ERRO[mensagem];
  if (erro) return reply.code(erro.status).send({ message: erro.message });
  throw err;
}

export async function campanhasDisparoRoutes(app: FastifyInstance) {
  const service = new CampanhasDisparoService(app.prisma);

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);
    protectedRoutes.addHook('preHandler', requireRole('gestor', 'admin'));

    protectedRoutes.get('/api/campanhas-disparo', async (_request, reply) => {
      const campanhas = await service.listar();
      return reply.send(campanhas);
    });

    protectedRoutes.get('/api/campanhas-disparo/preview-publico', async (request, reply) => {
      const filtro = filtroPublicoSchema.parse(request.query);
      const total = await service.contarPublico(filtro);
      return reply.send({ total });
    });

    protectedRoutes.get('/api/campanhas-disparo/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const campanha = await service.buscarPorId(id);
      if (!campanha) return reply.code(404).send({ message: 'Campanha não encontrada' });
      return reply.send(campanha);
    });

    protectedRoutes.post('/api/campanhas-disparo', async (request, reply) => {
      const body = criarCampanhaDisparoSchema.parse(request.body);

      try {
        const campanha = await service.criar(body, request.user.sub);
        return reply.code(201).send(campanha);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });

    protectedRoutes.patch('/api/campanhas-disparo/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = atualizarCampanhaDisparoSchema.parse(request.body);

      try {
        const campanha = await service.atualizar(id, body);
        return reply.send(campanha);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });

    protectedRoutes.post('/api/campanhas-disparo/:id/marcar-pronta', async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const campanha = await service.marcarComoPronta(id);
        return reply.send(campanha);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });

    protectedRoutes.delete('/api/campanhas-disparo/:id', async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        await service.deletar(id);
        return reply.code(204).send();
      } catch (err) {
        return tratarErro(err, reply);
      }
    });
  });
}
