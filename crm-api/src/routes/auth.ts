import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const body = LoginBody.parse(req.body);
      const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase()));
      const ok = user && user.active && (await bcrypt.compare(body.password, user.passwordHash));
      if (!ok) return reply.code(401).send({ error: 'E-mail ou senha inválidos' });

      const token = app.jwt.sign({ sub: user.id, role: user.role, name: user.name });
      return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    },
  );

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (!user) return { user: null };
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });
}
