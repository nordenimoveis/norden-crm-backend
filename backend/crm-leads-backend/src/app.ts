import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { env } from '@/config/env';
import { prismaPlugin } from '@/plugins/prisma';
import { authPlugin } from '@/plugins/auth';
import { leadsRoutes } from '@/modules/leads/leads.routes';
import { usuariosRoutes } from '@/modules/usuarios/usuarios.routes';
import { metaAdsRoutes } from '@/modules/meta-ads/meta-ads.routes';
import { whatsappRoutes } from '@/modules/whatsapp/whatsapp.routes';
import { realtimeRoutes } from '@/modules/realtime/realtime.routes';
import { imobziRoutes } from '@/modules/imobzi/imobzi.routes';
import { quickRepliesRoutes } from '@/modules/quick-replies/quick-replies.routes';
import { importacaoRoutes } from '@/modules/importacao/importacao.routes';
import { campanhasDisparoRoutes } from '@/modules/campanhas-disparo/campanhas-disparo.routes';
import { templatesMensagemRoutes } from '@/modules/templates-mensagem/templates-mensagem.routes';
import { sistemaRoutes } from '@/modules/sistema/sistema.routes';

export function buildApp() {
  const app = Fastify({
    logger: {
      transport: { target: 'pino-pretty' },
    },
  });

  app.register(sensible);
  app.register(cors, { origin: env.FRONTEND_URL ?? true });
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.register(prismaPlugin);
  app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(leadsRoutes, { prefix: '/api' });
  app.register(usuariosRoutes, { prefix: '/api' });
  app.register(metaAdsRoutes);
  app.register(whatsappRoutes);
  app.register(realtimeRoutes);
  app.register(imobziRoutes);
  app.register(quickRepliesRoutes, { prefix: '/api' });
  app.register(importacaoRoutes, { prefix: '/api' });
  app.register(campanhasDisparoRoutes);
  app.register(templatesMensagemRoutes);
  app.register(sistemaRoutes);

  return app;
}
// trigger redeploy
