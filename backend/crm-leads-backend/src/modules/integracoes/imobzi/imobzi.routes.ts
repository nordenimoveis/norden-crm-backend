import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { ImobziIntegracaoService } from './imobzi.service';

const MENSAGENS_ERRO: Record<string, { status: number; message: string }> = {
  IMOBZI_NAO_CONFIGURADO: {
    status: 503,
    message: 'A integração com o Imobzi não está configurada no servidor (faltam IMOBZI_API_BASE_URL / IMOBZI_API_TOKEN)',
  },
  VOYAGE_NAO_CONFIGURADO: {
    status: 503,
    message: 'A geração de embeddings não está configurada no servidor (falta a chave da Voyage AI)',
  },
};

function tratarErro(err: unknown, reply: import('fastify').FastifyReply) {
  const mensagem = (err as Error).message;
  const erro = MENSAGENS_ERRO[mensagem];
  if (erro) return reply.code(erro.status).send({ message: erro.message });
  throw err;
}

export async function imobziIntegracaoRoutes(app: FastifyInstance) {
  const service = new ImobziIntegracaoService(app.prisma);

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);
    protectedRoutes.addHook('preHandler', requireRole('gestor', 'admin'));

    protectedRoutes.post('/api/imobzi/sync/imoveis', async (_request, reply) => {
      try {
        const resultado = await service.syncImoveis();
        return reply.send(resultado);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });

    protectedRoutes.post('/api/imobzi/sync/leads', async (_request, reply) => {
      try {
        const resultado = await service.syncLeads();
        return reply.send(resultado);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });
  });
}
