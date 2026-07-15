import { FastifyInstance } from 'fastify';
import { env } from '@/config/env';
import { requireRole } from '@/plugins/auth';
import { ImobziService } from './imobzi.service';

export async function imobziRoutes(app: FastifyInstance) {
  const service = new ImobziService(app.prisma);

  /**
   * ROTA 1 — Webhook ATIVO: o Imobzi chama esse endpoint quando o evento
   * `lead_created` acontece (novo lead pelo formulário do site).
   *
   * Autenticação: NÃO é um header customizado — é o header `Authorization`
   * padrão, comparado ao valor que você define no campo `authorization` ao
   * cadastrar o webhook no Imobzi (painel: Administrador > Integrações >
   * Webhooks, ou via POST /v1/webhooks da API deles). O Imobzi reenvia esse
   * mesmo valor em toda chamada, e é isso que autentica a origem.
   *
   * Regra de negócio: round-robin + Passo 1 da cadência disparam AQUI,
   * de forma síncrona dentro do processamento do webhook.
   */
  app.post('/webhooks/imobzi/novo-lead', async (request, reply) => {
    const autorizacaoRecebida = request.headers['authorization'];

    if (autorizacaoRecebida !== env.IMOBZI_WEBHOOK_TOKEN) {
      return reply.code(401).send({ message: 'Token inválido' });
    }

    try {
      const lead = await service.processarWebhookNovoLead(request.body);
      return reply.code(201).send(lead);
    } catch (err) {
      if ((err as Error).message === 'LEAD_SEM_TELEFONE') {
        // Não é um erro fatal — só não dá pra iniciar cadência de WhatsApp
        // sem telefone. Responde 200 para o Imobzi não ficar reenviando.
        request.log.warn('Lead do Imobzi recebido sem telefone — ignorado');
        return reply.code(200).send({ recebido: true, ignorado: true });
      }
      throw err;
    }
  });

  // Endpoints autenticados (uso interno) para a importação da base legada
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    /**
     * ROTA 2 — Importação PASSIVA da base antiga. Restrita a gestor/admin.
     * Para "milhares de clientes", prefira `npm run sync:imobzi` (script de
     * linha de comando), que não fica preso ao tempo de vida de uma
     * requisição HTTP.
     */
    protectedRoutes.post(
      '/api/imobzi/importar-legado',
      { preHandler: [requireRole('gestor', 'admin')] },
      async (_request, reply) => {
        const resumo = await service.sincronizarBaseLegada();
        return reply.send(resumo);
      }
    );
  });
}
