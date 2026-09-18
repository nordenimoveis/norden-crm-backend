import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { cadenceSteps, leads, users } from '../db/schema.js';

export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireManager);

  /** Visão geral para o dono: funil, origem, corretores e saúde da cadência. */
  app.get('/reports/summary', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const recent = and(gte(leads.createdAt, since), sql`${leads.source} <> 'BASE_ANTIGA'`);

    const [byStage, bySource, byBroker, byTemperature, cadence] = await Promise.all([
      db.select({ stage: leads.stage, total: count() }).from(leads).where(recent).groupBy(leads.stage),
      db.select({ source: leads.source, total: count() }).from(leads).where(recent).groupBy(leads.source),
      db
        .select({
          brokerId: users.id,
          broker: users.name,
          total: count(),
          responded: sql<number>`count(${leads.lastInboundAt})::int`,
          closed: sql<number>`count(*) filter (where ${leads.stage} = 'NEGOCIO_FECHADO')::int`,
        })
        .from(leads)
        .innerJoin(users, eq(users.id, leads.brokerId))
        .where(recent)
        .groupBy(users.id, users.name),
      db.select({ temperature: leads.temperature, total: count() }).from(leads).where(recent).groupBy(leads.temperature),
      db
        .select({ status: cadenceSteps.status, total: count() })
        .from(cadenceSteps)
        .where(gte(cadenceSteps.createdAt, since))
        .groupBy(cadenceSteps.status),
    ]);

    return { periodDays: days, byStage, bySource, byBroker, byTemperature, cadence };
  });
}
