import { FastifyInstance } from 'fastify';
import { pusher, CANAL_KANBAN } from '@/lib/pusher';

/**
 * O Pusher exige que canais privados (prefixo "private-") sejam autorizados
 * pelo backend antes do front-end conseguir assinar. O client Next.js chama
 * este endpoint automaticamente (via `authEndpoint` na config do pusher-js),
 * passando o socket_id e o nome do canal que está tentando assinar.
 *
 * Aqui aplicamos o mesmo RBAC do resto da API:
 * - 'private-kanban': todo usuário autenticado pode assinar (o filtro de
 *   quais leads aparecem já acontece no GET /leads, então o corretor só
 *   vai ter no cache os leads dele mesmo recebendo eventos de todos).
 * - 'private-lead-{id}': só quem pode ver aquele lead (dono ou gestor/admin).
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    protectedRoutes.post('/api/pusher/auth', async (request, reply) => {
      const body = request.body as { socket_id: string; channel_name: string };
      const { socket_id: socketId, channel_name: channelName } = body;

      if (channelName === CANAL_KANBAN) {
        const auth = pusher.authorizeChannel(socketId, channelName);
        return reply.send(auth);
      }

      const match = channelName.match(/^private-lead-(.+)$/);
      if (match) {
        const leadId = match[1];

        if (request.user.papel === 'corretor') {
          const lead = await app.prisma.lead.findUnique({ where: { id: leadId } });
          if (!lead || lead.corretorId !== request.user.sub) {
            return reply.code(403).send({ message: 'Sem acesso a este canal' });
          }
        }

        const auth = pusher.authorizeChannel(socketId, channelName);
        return reply.send(auth);
      }

      return reply.code(403).send({ message: 'Canal desconhecido' });
    });
  });
}
