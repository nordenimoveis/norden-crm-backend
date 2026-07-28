import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { IaService } from './ia.service';
import { ingerirUrlSchema, simularPerguntaSchema } from './ia.schema';

const MENSAGENS_ERRO: Record<string, { status: number; message: string }> = {
  CONTEUDO_VAZIO: {
    status: 400,
    message: 'Não foi possível extrair texto desse documento/URL — confira se não é uma imagem escaneada sem texto selecionável',
  },
  VOYAGE_NAO_CONFIGURADO: {
    status: 503,
    message: 'A geração de embeddings não está configurada no servidor (falta a chave da Voyage AI)',
  },
  ANTHROPIC_NAO_CONFIGURADO: {
    status: 503,
    message: 'A geração de resposta por IA não está configurada no servidor (falta a chave da Anthropic)',
  },
};

function tratarErro(err: unknown, reply: import('fastify').FastifyReply) {
  const mensagem = (err as Error).message;
  const erro = MENSAGENS_ERRO[mensagem];
  if (erro) return reply.code(erro.status).send({ message: erro.message });
  throw err;
}

export async function iaRoutes(app: FastifyInstance) {
  const service = new IaService(app.prisma);

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);
    // Base de conhecimento é sensível (define o que a IA "sabe" e pode
    // acabar mandando pros clientes sem revisão) — só gestor/admin mexe.
    protectedRoutes.addHook('preHandler', requireRole('gestor', 'admin'));

    protectedRoutes.get('/api/ia/documentos', async (_request, reply) => {
      const documentos = await service.listarDocumentos();
      return reply.send(documentos);
    });

    protectedRoutes.post('/api/ia/documentos/upload', async (request, reply) => {
      const arquivo = await request.file();

      if (!arquivo) {
        return reply.code(400).send({ message: 'Nenhum arquivo enviado' });
      }

      const { titulo } = request.query as { titulo?: string };

      try {
        const buffer = await arquivo.toBuffer();
        const documento = await service.ingerirDocumento({
          titulo: titulo || arquivo.filename,
          origem: 'pdf',
          bufferPdf: buffer,
        });
        return reply.code(201).send(documento);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });

    protectedRoutes.post('/api/ia/documentos/url', async (request, reply) => {
      const body = ingerirUrlSchema.parse(request.body);

      try {
        const documento = await service.ingerirDocumento({
          titulo: body.titulo,
          origem: 'url',
          url: body.url,
        });
        return reply.code(201).send(documento);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });

    protectedRoutes.delete('/api/ia/documentos/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      await service.deletarDocumento(id);
      return reply.code(204).send();
    });

    /**
     * Simulador (Playground) — mesma busca semântica + geração do
     * atendimento de verdade, mas NUNCA toca em nenhum lead nem manda
     * mensagem no WhatsApp. Devolve as fontes usadas, pro admin validar
     * se o chunking dos documentos está bom antes de confiar na IA com
     * clientes reais.
     */
    protectedRoutes.post('/api/ia/simular', async (request, reply) => {
      const body = simularPerguntaSchema.parse(request.body);

      try {
        const resultado = await service.simular(body.pergunta);
        return reply.send(resultado);
      } catch (err) {
        return tratarErro(err, reply);
      }
    });
  });
}
