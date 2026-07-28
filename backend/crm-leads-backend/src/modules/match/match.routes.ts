import { FastifyInstance } from 'fastify';
import { MatchService } from './match.service';

const MENSAGENS_ERRO: Record<string, { status: number; message: string }> = {
  LEAD_NAO_ENCONTRADO: { status: 404, message: 'Lead não encontrado' },
  PERFIL_INCOMPLETO: {
    status: 400,
    message: 'Preencha o perfil de busca ou a descrição semântica do lead antes de gerar o match',
  },
  VOYAGE_NAO_CONFIGURADO: {
    status: 503,
    message: 'A geração de embeddings não está configurada no servidor (falta a chave da Voyage AI)',
  },
};

export async function matchRoutes(app: FastifyInstance) {
  const service = new MatchService(app.prisma);

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    protectedRoutes.get('/api/leads/:id/match-imoveis', async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const matches = await service.buscarMatches(id);
        return reply.send(matches);
      } catch (err) {
        const mensagem = (err as Error).message;
        const erro = MENSAGENS_ERRO[mensagem];
        if (erro) return reply.code(erro.status).send({ message: erro.message });
        throw err;
      }
    });
  });
}
