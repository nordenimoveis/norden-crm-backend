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
import { iaRoutes } from '@/modules/ia/ia.routes';
// À medida que os demais módulos forem construídos, registre aqui:
// import { cadenciasRoutes } from '@/modules/cadencias/cadencias.routes';
// import { campanhasRoutes } from '@/modules/campanhas/campanhas.routes';
// import { imoveisRoutes } from '@/modules/imoveis/imoveis.routes';

export function buildApp() {
  const app = Fastify({
    logger: {
      transport: { target: 'pino-pretty' },
    },
  });

  app.register(sensible);
  app.register(cors, { origin: env.FRONTEND_URL ?? true });
  // Upload de planilhas — limite de 10MB cobre bem milhares de linhas
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.register(prismaPlugin);
  app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(leadsRoutes, { prefix: '/api' });
  app.register(usuariosRoutes, { prefix: '/api' });
  app.register(metaAdsRoutes); // sem prefixo /api — a URL do webhook deve ser previsível para configurar no Meta
  app.register(whatsappRoutes); // idem — já define seus próprios caminhos internamente
  app.register(realtimeRoutes); // idem — /api/pusher/auth já definido internamente
  app.register(imobziRoutes); // idem — webhook ativo + importação da base legada
  app.register(quickRepliesRoutes, { prefix: '/api' });
  app.register(importacaoRoutes, { prefix: '/api' });
  app.register(campanhasDisparoRoutes); // já define seus próprios caminhos (/api/campanhas-disparo/...) internamente
  app.register(templatesMensagemRoutes); // idem — /api/templates-mensagem/...
  app.register(sistemaRoutes);
  app.register(iaRoutes); // já define seus próprios caminhos (/api/sistema/...) internamente
  // app.register(cadenciasRoutes, { prefix: '/api' });
  // app.register(campanhasRoutes, { prefix: '/api' });
  // app.register(imoveisRoutes, { prefix: '/api' });

  return app;
}
