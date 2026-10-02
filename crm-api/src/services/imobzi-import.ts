import { eq } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { leads } from '../db/schema.js';
import {
  contactEmail,
  contactName,
  contactPhone,
  fetchImobziContacts,
  isOwner,
} from '../lib/imobzi-api.js';
import { ingestLead } from './leads.js';

/** Tag aplicada aos contatos que são proprietários/locadores. */
export const TAG_PROPRIETARIO = 'Proprietário';

export interface ImobziImportResult {
  pages: number;
  scanned: number;
  created: number;
  duplicate: number;
  semContato: number;
  owners: number;
  errors: number;
  done: boolean;
}

/**
 * Importa os Contatos do Imobzi como leads "Base Antiga" (sem régua, sem roleta,
 * fora do Kanban por padrão). Deduplica por telefone (via ingestLead). Repetível:
 * rodar de novo só traz os novos. Proprietários recebem a tag "Proprietário".
 *
 * - `dryRun`: não grava nada, só conta (útil para ver o total antes).
 * - `max`: limita quantos contatos processar (para importar em lotes).
 */
export async function importImobziContacts(opts: { max?: number; dryRun?: boolean } = {}): Promise<ImobziImportResult> {
  if (!env().IMOBZI_API_SECRET) {
    throw new Error('Importação do Imobzi desligada: defina IMOBZI_API_SECRET.');
  }
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const dryRun = opts.dryRun ?? false;
  const r: ImobziImportResult = { pages: 0, scanned: 0, created: 0, duplicate: 0, semContato: 0, owners: 0, errors: 0, done: false };

  let cursor: string | null = null;
  // Proteção contra laço infinito (1000 páginas cobrem dezenas de milhares de contatos).
  for (let guard = 0; guard < 1000; guard++) {
    const page = await fetchImobziContacts(cursor);
    r.pages++;

    for (const c of page.contacts) {
      if (r.scanned >= max) return r; // atingiu o lote; done=false (ainda há mais)
      r.scanned++;

      const phone = contactPhone(c);
      const email = contactEmail(c);
      if (!phone && !email) {
        r.semContato++;
        continue;
      }
      const owner = isOwner(c);
      if (dryRun) {
        if (owner) r.owners++;
        continue;
      }

      try {
        const { lead, created } = await ingestLead({
          name: contactName(c),
          phone,
          email,
          source: 'BASE_ANTIGA',
          externalId: c.contact_id != null ? String(c.contact_id) : c.code != null ? String(c.code) : null,
          campaign: c.media_source ?? undefined,
          notes: c.media_source ? `Importado do Imobzi · origem: ${c.media_source}` : 'Importado do Imobzi',
          skipCadence: true,
        });
        if (created) r.created++;
        else r.duplicate++;

        if (created && owner) {
          r.owners++;
          const tags = Array.from(new Set([...(lead.tags ?? []), TAG_PROPRIETARIO]));
          await db.update(leads).set({ tags }).where(eq(leads.id, lead.id));
        }
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

  return r;
}
