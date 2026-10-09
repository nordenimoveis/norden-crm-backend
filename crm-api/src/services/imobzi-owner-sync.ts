import { eq } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { leads, users } from '../db/schema.js';
import { bus } from '../lib/events.js';
import {
  dealContactEmail,
  dealContactPhone,
  dealOwnerEmail,
  fetchImobziDeals,
  type ImobziDeal,
} from '../lib/imobzi-api.js';
import { normalizePhone, phoneKey as toPhoneKey } from '../lib/phone.js';
import { logEvent } from './timeline.js';

export interface OwnerSyncDivergence {
  leadId: string;
  leadName: string;
  /** Corretor atual no nosso CRM (mantido — não sobrescrevemos). */
  atual: string | null;
  /** Corretor responsável no Imobzi (sugestão que NÃO foi aplicada). */
  imobzi: string;
}

export interface ImobziOwnerSyncResult {
  pages: number;
  deals: number;
  /** Negócios que casaram com um lead do nosso CRM. */
  matched: number;
  /** Leads que tiveram o corretor preenchido (estava vazio). */
  updated: number;
  /** Leads que já tinham o mesmo corretor do Imobzi. */
  alreadySet: number;
  /** Leads com corretor DIFERENTE do Imobzi — não sobrescritos (transferência manual). */
  divergent: number;
  /** Negócios sem lead correspondente no CRM. */
  noLead: number;
  /** Responsável do Imobzi sem usuário equivalente no CRM (e-mail não casou). */
  noUser: number;
  /** Negócios sem responsável definido no Imobzi. */
  noOwner: number;
  errors: number;
  done: boolean;
  /** Amostra de divergências para revisão manual. */
  divergences: OwnerSyncDivergence[];
  /** E-mails de responsáveis do Imobzi que não têm usuário no CRM (para você cadastrar). */
  unmatchedOwners: string[];
}

/** Localiza o lead do CRM correspondente ao contato do negócio (telefone, depois e-mail). */
async function findLead(deal: ImobziDeal) {
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

/**
 * Sincroniza o CORRETOR RESPONSÁVEL do negócio no Imobzi (`deal.user.email`) para o
 * `brokerId` do lead no nosso CRM. De-para por e-mail (com os usuários do CRM).
 *
 * Regra firme: **só preenche onde está vazio.** Se o lead já tem corretor — mesmo que
 * diferente do Imobzi — não sobrescreve (respeita transferências manuais); apenas
 * registra como divergência para você revisar.
 *
 * - `dryRun`: não grava nada, só relata o que faria (rode primeiro).
 * - `max`: limita quantos negócios processar (lotes/teste).
 */
export async function syncImobziOwners(opts: { dryRun?: boolean; max?: number } = {}): Promise<ImobziOwnerSyncResult> {
  if (!env().IMOBZI_API_SECRET) {
    throw new Error('Sincronização do Imobzi desligada: defina IMOBZI_API_SECRET.');
  }
  const dryRun = opts.dryRun ?? false;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const r: ImobziOwnerSyncResult = {
    pages: 0, deals: 0, matched: 0, updated: 0, alreadySet: 0, divergent: 0,
    noLead: 0, noUser: 0, noOwner: 0, errors: 0, done: false,
    divergences: [], unmatchedOwners: [],
  };

  // De-para: e-mail (minúsculas) -> usuário do CRM.
  const crmUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const byEmail = new Map(crmUsers.map((u) => [u.email.trim().toLowerCase(), u]));
  const unmatched = new Set<string>();
  const updatedLeads: Array<{ leadId: string; brokerId: string }> = [];

  let cursor: string | null = null;
  // Proteção contra laço infinito (1000 páginas de 50 = 50 mil negócios).
  for (let guard = 0; guard < 1000; guard++) {
    const page = await fetchImobziDeals(cursor);
    r.pages++;

    for (const deal of page.deals) {
      if (r.deals >= max) return r; // atingiu o lote; done=false (ainda há mais)
      r.deals++;

      try {
        const ownerEmail = dealOwnerEmail(deal);
        if (!ownerEmail) {
          r.noOwner++;
          continue;
        }
        const broker = byEmail.get(ownerEmail);
        if (!broker) {
          r.noUser++;
          unmatched.add(ownerEmail);
          continue;
        }
        const lead = await findLead(deal);
        if (!lead) {
          r.noLead++;
          continue;
        }
        r.matched++;

        if (lead.brokerId === broker.id) {
          r.alreadySet++;
          continue;
        }
        if (lead.brokerId) {
          // Já tem corretor diferente — NÃO sobrescreve; só registra para revisão.
          r.divergent++;
          if (r.divergences.length < 50) {
            const current = crmUsers.find((u) => u.id === lead.brokerId);
            r.divergences.push({ leadId: lead.id, leadName: lead.name, atual: current?.name ?? null, imobzi: broker.name });
          }
          continue;
        }

        // brokerId vazio -> preenche com o responsável do Imobzi.
        if (!dryRun) {
          await db.transaction(async (tx) => {
            await tx.update(leads).set({ brokerId: broker.id, updatedAt: new Date() }).where(eq(leads.id, lead.id));
            await logEvent(tx, lead.id, 'lead.assigned', { brokerId: broker.id, brokerName: broker.name, via: 'imobzi' });
          });
          updatedLeads.push({ leadId: lead.id, brokerId: broker.id });
        }
        r.updated++;
      } catch {
        r.errors++;
      }
    }

    cursor = page.cursor;
    if (!cursor) {
      r.done = true;
      break;
    }
  }

  r.unmatchedOwners = Array.from(unmatched);

  // Avisa o painel (Kanban/listas) sobre os leads que mudaram de corretor.
  for (const u of updatedLeads) bus.publish({ type: 'lead.updated', leadId: u.leadId, brokerId: u.brokerId });

  return r;
}
