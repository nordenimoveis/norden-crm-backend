import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@/config/env';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; papel: 'gestor' | 'corretor' | 'admin' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ message: 'Token inválido ou ausente' });
    }
  });
});

/**
 * Middleware auxiliar para restringir rotas por papel (ex: só 'gestor' pode acessar).
 * Uso: { preHandler: [app.authenticate, requireRole('gestor')] }
 */
export function requireRole(...papeis: Array<'gestor' | 'corretor' | 'admin'>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { papel } = request.user;
    if (!papeis.includes(papel)) {
      reply.code(403).send({ message: 'Você não tem permissão para acessar este recurso' });
    }
  };
}
