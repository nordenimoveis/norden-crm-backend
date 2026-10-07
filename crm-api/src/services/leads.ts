import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, users, type Lead, type LeadSource, type User } from '../db/schema.js';
import { bus } from '../lib/events.js';
import { badRequest } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { firstStepTime, scheduleStep } from './cadence.js';
import { pickNextBroker } from './roleta.js';
import { logEvent } from './timeline.js';

export const TAG_BASE_ANTIGA = 'Base Antiga';

export interface IngestInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  source: LeadSource;
  externalId?: string | null;
  campaign?: string | null;
  interest?: string | null;
  notes?: string | null;
  /** Força um corretor específico (cadastro manual pelo gestor). */
  brokerId?: string | null;
  /** Não agenda a cadência (ex.: o próprio cliente já iniciou a conversa). */
  skipCadence?: boolean;
  /** Dados brutos da origem, guardados na linha do tempo para auditoria. */
  raw?: Record<string, unknown>;
}

export interface IngestResult {
  lead: Lead;
  created: boolean;
  broker: User | null;
}

/**
 * Porta de entrada única de leads (Meta Ads, Instagram, site/Imobzi, manual, base antiga).
 * - Deduplica por telefone e, na falta dele, por origem + ID externo.
 * - Base antiga: só grava com a etiqueta "Base Antiga" (sem roleta e sem cadência).
 * - Demais origens: roleta + agenda o passo 1 da cadência (se houver telefone).
 */
export async function ingestLead(input: IngestInput): Promise<IngestResult> {
  const name = input.name.trim() || 'Sem nome';
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  if (!phone && !email) throw badRequest('Lead precisa de telefone ou e-mail');

  const result = await db.transaction(async (tx): Promise<IngestResult> => {
    const existing = phone
      ? (await tx.select().from(leads).where(eq(leads.phone, phone)).for('update'))[0]
      : input.externalId
        ? (await tx.select().from(leads).where(and(eq(leads.source, input.source), eq(leads.externalId, input.externalId))).for('update'))[0]
        : undefined;

    if (existing) {
      const patch: Partial<Lead> = { updatedAt: new Date() };
      if (!existing.email && email) patch.email = email;

      // Re-entrada ATIVA (Meta/site/manual): um contato que já existe mas está
      // fora do funil (base antiga, perdido, frio) e volta por um anúncio/form
      // vira OPORTUNIDADE NOVA — entra no funil, com corretor e cadência.
      const active = input.source !== 'BASE_ANTIGA';
      const promote = active && !existing.inFunnel;
      let broker: User | null = null;

      if (promote) {
        patch.inFunnel = true;
        patch.source = input.source;
        patch.stage = 'NOVO_LEAD';
        patch.inboxStatus = null; // deixa de ser item de triagem da caixa
        if (input.interest) patch.interest = input.interest; // produto do form atual
        if (input.campaign) patch.campaign = input.campaign;
        if (existing.lostAt) {
          patch.lostAt = null; // reabre se estava perdido
          patch.lostReasonId = null;
        }
        if (!existing.brokerId) {
          broker = await pickNextBroker(tx);
          patch.brokerId = broker?.id ?? null;
        }
      } else {
        // Já está no funil (ou é import de base): só completa o que falta.
        if (!existing.interest && input.interest) patch.interest = input.interest;
        if (!existing.campaign && input.campaign) patch.campaign = input.campaign;
        if (existing.stage === 'LEAD_FRIO' && active) patch.stage = 'NOVO_LEAD';
      }

      const [updated] = await tx.update(leads).set(patch).where(eq(leads.id, existing.id)).returning();
      await logEvent(tx, existing.id, 'lead.reentry', {
        source: input.source,
        campaign: input.campaign,
        interest: input.interest,
        promoted: promote,
        raw: input.raw ?? {},
      });
      if (promote) {
        await logEvent(tx, existing.id, 'lead.assigned', {
          brokerId: patch.brokerId ?? existing.brokerId ?? null,
          brokerName: broker?.name ?? null,
          via: 'roleta',
        });
        if (phone && !input.skipCadence) await scheduleStep(tx, existing.id, 1, firstStepTime(new Date()));
      }
      return { lead: updated!, created: false, broker };
    }

    if (input.source === 'BASE_ANTIGA') {
      const [lead] = await tx
        .insert(leads)
        .values({ name, phone, email, source: 'BASE_ANTIGA', externalId: input.externalId, campaign: input.campaign, interest: input.interest, notes: input.notes, tags: [TAG_BASE_ANTIGA] })
        .returning();
      await logEvent(tx, lead!.id, 'lead.created', { source: 'BASE_ANTIGA', raw: input.raw ?? {} });
      return { lead: lead!, created: true, broker: null };
    }

    let broker: User | null = null;
    if (input.brokerId) {
      broker = (await tx.select().from(users).where(eq(users.id, input.brokerId)))[0] ?? null;
      if (!broker) throw badRequest('Corretor informado não existe');
    } else {
      broker = await pickNextBroker(tx);
    }

    const [lead] = await tx
      .insert(leads)
      .values({
        name,
        phone,
        email,
        source: input.source,
        externalId: input.externalId,
        campaign: input.campaign,
        interest: input.interest,
        notes: input.notes,
        brokerId: broker?.id ?? null,
        inFunnel: true, // origem ativa (Meta/site/WhatsApp/manual) entra no funil
      })
      .returning();

    await logEvent(tx, lead!.id, 'lead.created', { source: input.source, campaign: input.campaign, raw: input.raw ?? {} });
    await logEvent(tx, lead!.id, 'lead.assigned', { brokerId: broker?.id ?? null, brokerName: broker?.name ?? null, via: input.brokerId ? 'manual' : 'roleta' });

    if (phone && !input.skipCadence) await scheduleStep(tx, lead!.id, 1, firstStepTime(new Date()));

    return { lead: lead!, created: true, broker };
  });

  bus.publish({
    type: result.created ? 'lead.created' : 'lead.updated',
    leadId: result.lead.id,
    brokerId: result.lead.brokerId,
    data: result.created ? undefined : { reentry: true },
  });
  return result;
}
