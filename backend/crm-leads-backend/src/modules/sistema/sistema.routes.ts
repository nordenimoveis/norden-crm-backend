import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { env } from '@/config/env';
import { obterLimiteDiario, definirLimiteDiario, contarEnviosDeHoje } from '@/lib/limite-diario';
import { definirLimiteDiarioSchema } from './sistema.schema';

/**
 * Módulo de Configurações (Fase 10) — restrito a 'admin' (não gestor), por
 * lidar com segurança operacional do disparo de WhatsApp e visibilidade de
 * quais integrações estão configuradas.
 */
export async function sistemaRoutes(app: FastifyInstance) {
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);
    protectedRoutes.addHook('preHandler', requireRole('admin'));

    protectedRoutes.get('/api/sistema/limite-diario', async (_request, reply) => {
      const [limite, enviadosHoje] = await Promise.all([obterLimiteDiario(), contarEnviosDeHoje()]);
      return reply.send({ limite, enviadosHoje });
    });

    protectedRoutes.patch('/api/sistema/limite-diario', async (request, reply) => {
      const { limite } = definirLimiteDiarioSchema.parse(request.body);
      await definirLimiteDiario(limite);
      return reply.send({ limite });
    });

    /**
     * Status das integrações — SÓ booleanos (configurado/não configurado),
     * nunca os valores reais dos tokens/secrets. Editar os valores de verdade
     * continua sendo responsabilidade do .env / secrets manager do provedor
     * de hospedagem (Railway/Render), não desta tela.
     */
    protectedRoutes.get('/api/sistema/status-integracoes', async (_request, reply) => {
      return reply.send({
        whatsapp: {
          configurado: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
        },
        metaAds: {
          configurado: Boolean(env.META_APP_SECRET && env.META_VERIFY_TOKEN && env.META_PAGE_ACCESS_TOKEN),
        },
        imobzi: {
          configurado: Boolean(env.IMOBZI_API_TOKEN && env.IMOBZI_WEBHOOK_TOKEN),
        },
        pusher: {
          configurado: Boolean(env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET),
        },
      });
    });
  });
}
