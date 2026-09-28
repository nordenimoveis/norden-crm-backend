import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  pushEnabled,
  removeSubscription,
  saveSubscription,
  sendTestNotification,
  vapidPublicKey,
} from '../services/push.js';

const SubscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const UnsubscribeBody = z.object({ endpoint: z.string().url() });

/**
 * Web Push: o navegador se inscreve aqui e o CRM passa a poder avisar o usuário
 * no celular/desktop mesmo fechado. A chave pública VAPID é pública por design
 * (vai para o navegador); a privada nunca sai do servidor.
 */
export default async function pushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Chave pública VAPID + se o recurso está ligado no servidor. */
  app.get('/push/public-key', async () => ({
    enabled: pushEnabled(),
    key: pushEnabled() ? vapidPublicKey() : null,
  }));

  /** Registra o dispositivo atual para receber notificações. */
  app.post('/push/subscribe', async (req, reply) => {
    const sub = SubscribeBody.parse(req.body);
    const ua = req.headers['user-agent'] ?? null;
    await saveSubscription(req.user.id, sub, ua);
    return reply.code(201).send({ ok: true });
  });

  /** Cancela a inscrição do dispositivo atual. */
  app.post('/push/unsubscribe', async (req) => {
    const { endpoint } = UnsubscribeBody.parse(req.body);
    await removeSubscription(endpoint);
    return { ok: true };
  });

  /** Dispara uma notificação de teste para os dispositivos do próprio usuário. */
  app.post('/push/test', async (req) => {
    return sendTestNotification(req.user);
  });
}
