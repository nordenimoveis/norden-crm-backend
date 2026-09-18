import type { FastifyInstance } from 'fastify';
import { bus, type CrmEvent } from '../lib/events.js';
import type { AuthUser } from '../services/access.js';
import { isManager } from '../services/access.js';

/**
 * Tempo real via Server-Sent Events.
 * O EventSource do navegador não envia cabeçalhos, por isso o token vai em ?token=.
 * Corretor só recebe eventos dos próprios leads (inclusive quando um lead sai dele por transferência).
 */
export default async function eventRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>('/events', async (req, reply) => {
    let user: AuthUser;
    try {
      const p = app.jwt.verify<{ sub: string; role: AuthUser['role']; name: string }>(req.query.token ?? '');
      user = { id: p.sub, role: p.role, name: p.name };
    } catch {
      return reply.code(401).send({ error: 'Sessão inválida' });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: ready\ndata: {}\n\n`);

    const canSee = (e: CrmEvent) =>
      isManager(user) || e.brokerId === user.id || e.data?.previousBrokerId === user.id;

    const onEvent = (e: CrmEvent) => {
      if (!canSee(e)) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify({ leadId: e.leadId, brokerId: e.brokerId, ...e.data })}\n\n`);
    };
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);

    bus.on('event', onEvent);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', onEvent);
    });
  });
}
