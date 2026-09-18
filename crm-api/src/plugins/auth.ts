import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config.js';
import type { UserRole } from '../db/schema.js';
import type { AuthUser } from '../services/access.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: UserRole; name: string };
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireManager: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireInternal: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default fp(async (app: FastifyInstance) => {
  await app.register(fastifyJwt, {
    secret: env().JWT_SECRET,
    sign: { expiresIn: '12h' },
    formatUser: (p) => ({ id: p.sub, role: p.role, name: p.name }),
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Sessão inválida ou expirada' });
    }
  });

  app.decorate('requireManager', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'DONO' && req.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Apenas gestores' });
    }
  });

  app.decorate('requireInternal', async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['x-internal-key'];
    if (!safeEqual(typeof key === 'string' ? key : undefined, env().INTERNAL_API_KEY)) {
      return reply.code(401).send({ error: 'Chave interna inválida' });
    }
  });
});
