import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { ImoveisService } from './imoveis.service';
import { criarImovelSchema, atualizarImovelSchema } from './imoveis.schema';

const MENSAGENS_ERRO: Record<string, { status: number; message: string }> = {
  CONTEUDO_VAZIO: {
    status: 400,
    message: 'Não foi possível extrair texto desse documento/URL — confira se não é uma imagem escaneada sem texto selecionável',
  },
  FALHA_AO_INTERPRETAR_RESPOSTA_IA: {
    status: 502,
    message: 'A IA não conseguiu estruturar os dados desse documento — tente preencher manualmente',
  },
  VOYAGE_NAO_CONFIGURADO: {
    status: 503,
    message: 'A geração de embeddings não está configurada no servidor (falta a chave da Voyage AI)',
  },
  ANTHROPIC_NAO_CONFIGURADO: {
    status: 503,
    message: 'A extração por IA não está configurada no servidor (falta a chave da Anthropic)',
  },
  IMOBZI_NAO_CONFIGURADO: {
    status: 503,
    message: 'A integração com o Imobzi não está configurada no servidor (faltam IMOBZI_API_BASE_URL / IMOBZI_API_TOKEN)',
  },
};

function tratarErro(err: unknown, reply: import('fastify').FastifyReply) {
  const mensagem = (err as Error).message;
  const erro = MENSAGENS_ERRO[mensagem];
  if (erro) return reply.code(erro.status).send({ message: erro.message });
  throw err;
}

export async function imoveisRoutes(app: FastifyInstance) {
  const service = new ImoveisService(app.prisma);

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    protectedRoutes.get('/api/imoveis', async (request, reply) => {
      const { incluirInativos } = request.query as { incluirInativos?: string };
      const imoveis = await service.listar(incluirInativos === 'true');
      return reply.send(imoveis);
    });

    protectedRoutes.get('/api/imoveis/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const imovel = await service.buscarPorId(id);
      if (!imovel) return reply.code(404).send({ message: 'Imóvel não encontrado' });
      return reply.send(imovel);
    });

    protectedRoutes.register(async (adminRoutes) => {
      adminRoutes.addHook('preHandler', requireRole('gestor', 'admin'));

      adminRoutes.post('/api/imoveis', async (request, reply) => {
        const body = criarImovelSchema.parse(request.body);
        const imovel = await service.criar(body);
        return reply.code(201).send(imovel);
      });

      adminRoutes.patch('/api/imoveis/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = atualizarImovelSchema.parse(request.body);
        const imovel = await service.atualizar(id, body);
        return reply.send(imovel);
      });

      adminRoutes.delete('/api/imoveis/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        await service.deletar(id);
        return reply.code(204).send();
      });

      adminRoutes.post('/api/imoveis/extrair-pdf', async (request, reply) => {
        const arquivo = await request.file();
        if (!arquivo) return reply.code(400).send({ message: 'Nenhum arquivo enviado' });

        try {
          const buffer = await arquivo.toBuffer();
          const dados = await service.extrairDadosDeDocumento({ origem: 'pdf', bufferPdf: buffer });
          return reply.send(dados);
        } catch (err) {
          return tratarErro(err, reply);
        }
      });

      adminRoutes.post('/api/imoveis/extrair-url', async (request, reply) => {
        const { url } = request.body as { url?: string };
        if (!url) return reply.code(400).send({ message: 'URL é obrigatória' });

        try {
          const dados = await service.extrairDadosDeDocumento({ origem: 'url', url });
          return reply.send(dados);
        } catch (err) {
          return tratarErro(err, reply);
        }
      });

      /**
       * Sincronização unidirecional Imobzi -> catálogo. Síncrona de
       * propósito (o front mostra loading enquanto espera) — se o catálogo
       * crescer muito, vale considerar mover pra uma fila em background no
       * futuro, mas pro volume de uma imobiliária boutique isso é suficiente.
       */
      adminRoutes.post('/api/imoveis/sincronizar-imobzi', async (_request, reply) => {
        try {
          const resultado = await service.sincronizarComImobzi();
          return reply.send(resultado);
        } catch (err) {
          return tratarErro(err, reply);
        }
      });
    });
  });
}
