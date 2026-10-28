import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ingestLead } from '../services/leads.js';

/**
 * Rotas PÚBLICAS (sem autenticação) para captura de leads do site:
 * o formulário "antes do WhatsApp" e as landing pages (ex.: WAVE) chamam aqui.
 *
 * Proteções: honeypot (campo escondido), limite por janela e a deduplicação por
 * telefone do próprio `ingestLead` (reenvios não criam duplicados).
 */
const LeadBody = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(8).max(32),
  interest: z.string().trim().max(160).optional(),
  campaign: z.string().trim().max(140).optional(),
  /** URL da página de origem (só para auditoria na linha do tempo). */
  page: z.string().trim().max(400).optional(),
  /** Honeypot: se vier preenchido, é bot — fingimos sucesso e não criamos nada. */
  website: z.string().max(200).optional(),
});

export default async function publicRoutes(app: FastifyInstance) {
  app.post(
    '/public/leads',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const b = LeadBody.parse(req.body);

      // Bot preencheu o honeypot → responde ok sem criar lead.
      if (b.website && b.website.trim()) return reply.send({ ok: true });

      const { created } = await ingestLead({
        name: b.name,
        phone: b.phone,
        source: 'SITE',
        campaign: b.campaign || 'Site',
        interest: b.interest || undefined,
        // O cliente segue direto para o WhatsApp da imobiliária; não dispara a régua
        // (senão o número do CRM mandaria templates em paralelo ao atendimento).
        skipCadence: true,
        raw: { via: 'public-form', page: b.page ?? null },
      });

      return reply.code(created ? 201 : 200).send({ ok: true });
    },
  );
}
