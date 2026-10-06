import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as products from '../services/products.js';
import type { Product } from '../db/schema.js';

const view = (p: Product) => ({
  id: p.id,
  name: p.name,
  aliases: p.aliases,
  active: p.active,
  position: p.position,
});

const aliasesSchema = z.array(z.string().trim().min(1).max(80)).max(20).optional();

export default async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Catálogo de empreendimentos (todos os usuários logados — usado em filtros e detecção). */
  app.get('/products', async () => {
    return (await products.listProducts()).map(view);
  });

  app.post('/products', { preHandler: app.requireManager }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1).max(120), aliases: aliasesSchema }).parse(req.body);
    return reply.code(201).send(view(await products.createProduct(b)));
  });

  app.patch<{ Params: { id: string } }>('/products/:id', { preHandler: app.requireManager }, async (req) => {
    const b = z
      .object({ name: z.string().min(1).max(120).optional(), aliases: aliasesSchema, active: z.boolean().optional() })
      .parse(req.body);
    return view(await products.updateProduct(req.params.id, b));
  });

  app.delete<{ Params: { id: string } }>('/products/:id', { preHandler: app.requireManager }, async (req, reply) => {
    await products.deleteProduct(req.params.id);
    return reply.code(204).send();
  });
}
