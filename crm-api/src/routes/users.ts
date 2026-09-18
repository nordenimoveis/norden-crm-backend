import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userRole, users, type User } from '../db/schema.js';
import { encrypt } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';

const CreateUser = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10, 'Senha precisa ter ao menos 10 caracteres'),
  role: z.enum(userRole.enumValues).default('CORRETOR'),
  inRotation: z.boolean().optional(),
  chatwootAgentId: z.number().int().positive().nullable().optional(),
  chatwootToken: z.string().min(10).nullable().optional(),
});

const UpdateUser = CreateUser.partial().extend({ active: z.boolean().optional() });

/** Nunca devolve hash de senha nem token do Chatwoot. */
function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    inRotation: u.inRotation,
    lastAssignedAt: u.lastAssignedAt,
    chatwootAgentId: u.chatwootAgentId,
    chatwootConfigured: Boolean(u.chatwootAgentId && u.chatwootTokenEnc),
  };
}

export default async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Lista enxuta de corretores (para filtros e transferência). Qualquer usuário logado pode ver nomes. */
  app.get('/brokers', async () => {
    const rows = await db.select().from(users).where(eq(users.active, true)).orderBy(asc(users.name));
    return rows.map((u) => ({ id: u.id, name: u.name, role: u.role }));
  });

  app.get('/users', { preHandler: app.requireManager }, async () => {
    const rows = await db.select().from(users).orderBy(asc(users.name));
    return rows.map(publicUser);
  });

  app.post('/users', { preHandler: app.requireManager }, async (req, reply) => {
    const b = CreateUser.parse(req.body);
    const [u] = await db
      .insert(users)
      .values({
        name: b.name,
        email: b.email.toLowerCase(),
        passwordHash: await bcrypt.hash(b.password, 12),
        role: b.role,
        inRotation: b.inRotation ?? b.role === 'CORRETOR',
        chatwootAgentId: b.chatwootAgentId ?? null,
        chatwootTokenEnc: b.chatwootToken ? encrypt(b.chatwootToken) : null,
      })
      .returning();
    return reply.code(201).send(publicUser(u!));
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: app.requireManager }, async (req) => {
    const b = UpdateUser.parse(req.body);
    const patch: Partial<User> = { updatedAt: new Date() };
    if (b.name !== undefined) patch.name = b.name;
    if (b.email !== undefined) patch.email = b.email.toLowerCase();
    if (b.password !== undefined) patch.passwordHash = await bcrypt.hash(b.password, 12);
    if (b.role !== undefined) patch.role = b.role;
    if (b.active !== undefined) patch.active = b.active;
    if (b.inRotation !== undefined) patch.inRotation = b.inRotation;
    if (b.chatwootAgentId !== undefined) patch.chatwootAgentId = b.chatwootAgentId;
    if (b.chatwootToken !== undefined) patch.chatwootTokenEnc = b.chatwootToken ? encrypt(b.chatwootToken) : null;

    const [u] = await db.update(users).set(patch).where(eq(users.id, req.params.id)).returning();
    if (!u) throw notFound('Usuário');
    return publicUser(u);
  });
}
