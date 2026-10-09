import { eq } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { leads, users, type Lead } from '../db/schema.js';
import { bus } from '../lib/events.js';
import {
  dealContactEmail,
  dealContactPhone,
  dealOwnerEmail,
  dealTimestamp,
  fetchImobziDeals,
  type ImobziDeal,
} from '../lib/imobzi-api.js';
import { normalizePhone, phoneKey as toPhoneKey } from '../lib/phone.js';
import { logEvent } from './timeline.js';

export interface OwnerSyncChange {
  leadId: string;
  leadName: string;
  /** Corretor atual no nosso CRM. */
  atual: string | null;
  /** Corretor responsável no Imobzi (negócio mais recente). */
  imobzi: string;
}

export interface ImobziOwnerSyncResult {
  pages: number;
  /** Negócios lidos do Imobzi. */
  deals: number;
  /** Leads distintos do CRM que casaram com algum negócio. */
  leads: number;
  /** Leads com vários negócios no Imobzi (usamos o mais recente). */
  multiDeal: number;
  /** Leads que estavam SEM corretor e foram preenchidos. */
  filled: number;
  /** Leads que tinham corretor DIFERENTE e foram realinhados (só no modo espelhar). */
  reassigned: number;
  /** Leads que já estavam com o corretor certo. */
  alreadySet: number;
  /** Leads com corretor diferente que NÃO foram alterados (modo preencher-vazio). */
  divergent: number;
  /** Negócios sem lead correspondente no CRM. */
  noLead: number;
  /** Responsável do Imobzi sem usuário no CRM (e-mail não casou). */
  noUser: number;
  /** Negócios sem responsável definido no Imobzi. */
  noOwner: number;
  errors: number;
  done: boolean;
  /** Se true, realinhou quem já tinha corretor; se false, só preencheu vazios. */
  overwrite: boolean;
  /** Amostra de leads realinhados (modo espelhar). */
  reassignments: OwnerSyncChange[];
  /** Amostra de divergências mantidas (modo preencher-vazio). */
  divergences: OwnerSyncChange[];
  /** E-mails de responsáveis do Imobzi sem usuário no CRM (para você cadastrar). */
  unmatchedOwners: string[];
}

/** Localiza o lead do CRM correspondente ao contato do negócio (telefone, depois e-mail). */
async function findLead(deal: ImobziDeal): Promise<Lead | undefined> {
  const pkey = toPhoneKey(normalizePhone(dealContactPhone(deal)));
  if (pkey) {
    const [byPhone] = await db.select().from(leads).where(eq(leads.phoneKey, pkey)).limit(1);
    if (byPhone) return byPhone;
  }
  const email = dealContactEmail(deal);
  if (email) {
    const [byEmail] = await db.select().from(leads).where(eq(leads.email, email)).limit(1);
    if (byEmail) return byEmail;
  }
  return undefined;
}

interface Candidate {
  lead: Lead;
  brokerId: string;
  brokerName: string;
  ts: number; // data do negócio escolhido (para "mais recente vence")
  deals: number; // quantos negócios casaram com este lead
}

/**
 * Sincroniza o CORRETOR RESPONSÁVEL do Imobzi para o `brokerId` do lead no CRM.
 * De-para por e-mail (`deal.user.email` ↔ `users.email`); casa o lead pelo telefone
 * (chave canônica, resolve o 9º dígito) e, na falta, pelo e-mail.
 *
 * Quando um lead tem VÁRIOS negócios no Imobzi, usa o **mais recente** (data da
 * etapa, com fallback na data de criação) como o responsável atual.
 *
 * - `overwrite: false` (padrão): **só preenche onde está vazio**; respeita quem já
 *   tem corretor (registra divergências sem alterar).
 * - `overwrite: true` ("espelhar o Imobzi"): **realinha também** quem já tem corretor
 *   diferente, para a distribuição do CRM bater exatamente com a do Imobzi.
 * - `dryRun: true`: não grava nada, só relata o que faria (rode primeiro).
 * - `max`: limita quantos negócios processar (lotes/teste).
 */
export async function syncImobziOwners(
  opts: { dryRun?: boolean; max?: number; overwrite?: boolean } = {},
): Promise<ImobziOwnerSyncResult> {
  if (!env().IMOBZI_API_SECRET) {
    throw new Error('Sincronização do Imobzi desligada: defina IMOBZI_API_SECRET.');
  }
  const dryRun = opts.dryRun ?? false;
  const overwrite = opts.overwrite ?? false;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const r: ImobziOwnerSyncResult = {
    pages: 0, deals: 0, leads: 0, multiDeal: 0, filled: 0, reassigned: 0, alreadySet: 0,
    divergent: 0, noLead: 0, noUser: 0, noOwner: 0, errors: 0, done: false, overwrite,
    reassignments: [], divergences: [], unmatchedOwners: [],
  };

  // De-para: e-mail (minúsculas) -> usuário do CRM.
  const crmUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const byEmail = new Map(crmUsers.map((u) => [u.email.trim().toLowerCase(), u]));
  const nameById = new Map(crmUsers.map((u) => [u.id, u.name]));
  const unmatched = new Set<string>();

  // 1) Varre os negócios e escolhe, por lead, o responsável do negócio MAIS RECENTE.
  const chosen = new Map<string, Candidate>();
  let cursor: string | null = null;
  let stop = false;
  for (let guard = 0; guard < 1000 && !stop; guard++) {
    const page = await fetchImobziDeals(cursor);
    r.pages++;

    for (const deal of page.deals) {
      if (r.deals >= max) { stop = true; break; }
      r.deals++;

      try {
        const ownerEmail = dealOwnerEmail(deal);
        if (!ownerEmail) { r.noOwner++; continue; }
        const broker = byEmail.get(ownerEmail);
        if (!broker) { r.noUser++; unmatched.add(ownerEmail); continue; }
        const lead = await findLead(deal);
        if (!lead) { r.noLead++; continue; }

        const ts = dealTimestamp(deal);
        const prev = chosen.get(lead.id);
        if (!prev) {
          chosen.set(lead.id, { lead, brokerId: broker.id, brokerName: broker.name, ts, deals: 1 });
        } else {
          prev.deals += 1;
          if (ts >= prev.ts) { prev.brokerId = broker.id; prev.brokerName = broker.name; prev.ts = ts; }
        }
      } catch {
        r.errors++;
      }
    }

    cursor = page.cursor;
    if (!cursor) { r.done = true; break; }
  }

  r.leads = chosen.size;

  // 2) Aplica o responsável escolhido a cada lead.
  const updated: Array<{ leadId: string; brokerId: string }> = [];
  for (const c of chosen.values()) {
    if (c.deals > 1) r.multiDeal++;
    const { lead, brokerId, brokerName } = c;

    if (lead.brokerId === brokerId) { r.alreadySet++; continue; }

    const atual = lead.brokerId ? nameById.get(lead.brokerId) ?? null : null;

    if (!lead.brokerId) {
      // Vazio -> preenche sempre.
      if (!dryRun) {
        await db.transaction(async (tx) => {
          await tx.update(leads).set({ brokerId, updatedAt: new Date() }).where(eq(leads.id, lead.id));
          await logEvent(tx, lead.id, 'lead.assigned', { brokerId, brokerName, via: 'imobzi' });
        });
        updated.push({ leadId: lead.id, brokerId });
      }
      r.filled++;
      continue;
    }

    // Já tem corretor diferente.
    if (!overwrite) {
      r.divergent++;
      if (r.divergences.length < 100) r.divergences.push({ leadId: lead.id, leadName: lead.name, atual, imobzi: brokerName });
      continue;
    }

    // Modo espelhar: realinha para bater com o Imobzi.
    if (!dryRun) {
      await db.transaction(async (tx) => {
        await tx.update(leads).set({ brokerId, updatedAt: new Date() }).where(eq(leads.id, lead.id));
        await logEvent(tx, lead.id, 'lead.transferred', { fromBrokerId: lead.brokerId, toBrokerId: brokerId, brokerName, via: 'imobzi' });
      });
      updated.push({ leadId: lead.id, brokerId });
    }
    r.reassigned++;
    if (r.reassignments.length < 100) r.reassignments.push({ leadId: lead.id, leadName: lead.name, atual, imobzi: brokerName });
  }

  r.unmatchedOwners = Array.from(unmatched);

  // Avisa o painel (Kanban/listas) sobre os leads que mudaram de corretor.
  for (const u of updated) bus.publish({ type: 'lead.updated', leadId: u.leadId, brokerId: u.brokerId });

  return r;
}
