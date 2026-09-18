import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { env } from './config.js';
import { closeDb, db } from './db/client.js';
import { HttpError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import campaignRoutes from './routes/campaigns.js';
import conversationRoutes from './routes/conversations.js';
import eventRoutes from './routes/events.js';
import internalRoutes from './routes/internal.js';
import leadRoutes from './routes/leads.js';
import lossReasonRoutes from './routes/loss-reasons.js';
import pipelineRoutes from './routes/pipeline.js';
import quickReplyRoutes from './routes/quick-replies.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import webhookRoutes from './routes/webhooks.js';
import { ChatwootError } from './services/chatwoot.js';

export async function buildServer() {
  const e = env();
  const app = Fastify({
    logger: {
      level: e.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers["x-internal-key"]', 'req.query.token'],
    },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: e.CORS_ORIGINS ? e.CORS_ORIGINS.split(',').map((s) => s.trim()) : false,
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof ChatwootError) {
      req.log.error({ err }, 'Erro na API do Chatwoot');
      return reply.code(502).send({ error: 'Falha na comunicação com o WhatsApp. Tente novamente.' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'Erro inesperado');
    return reply.code(status).send({ error: status >= 500 ? 'Erro interno' : (err as Error).message });
  });

  app.get('/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(leadRoutes);
  await app.register(pipelineRoutes);
  await app.register(lossReasonRoutes);
  await app.register(campaignRoutes);
  await app.register(conversationRoutes);
  await app.register(quickReplyRoutes);
  await app.register(reportRoutes);
  await app.register(eventRoutes);
  await app.register(internalRoutes);
  await app.register(webhookRoutes);

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  const shutdown = async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await app.listen({ host: '0.0.0.0', port: env().PORT });
}
