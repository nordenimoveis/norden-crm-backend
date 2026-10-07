import { env } from '../config.js';
import { cleanFormName, listFormLeads, listLeadForms, mapMetaLead } from '../lib/meta-leads.js';
import { ingestLead } from './leads.js';

export interface MetaPollResult {
  forms: number;
  scanned: number;
  created: number;
  duplicate: number;
  errors: number;
}

/**
 * Coletor de leads do Meta: puxa os leads NOVOS dos formulários da Página e os
 * ingere no CRM. Não depende do webhook da Meta (que exige App Review/Advanced
 * Access) — usa o token da Página, que já lê os leads. Roda periodicamente
 * (n8n ou cron) chamando POST /internal/meta/poll.
 *
 * - Só considera leads criados dentro da janela `META_POLL_LOOKBACK_MIN` (evita
 *   reprocessar a base antiga). A deduplicação por telefone cobre sobreposições.
 * - Empreendimento: campo do formulário ou, na falta, o nome do formulário.
 */
export async function runMetaPoll(now = new Date(), fetchImpl: typeof fetch = fetch, lookbackMin?: number): Promise<MetaPollResult> {
  const e = env();
  const result: MetaPollResult = { forms: 0, scanned: 0, created: 0, duplicate: 0, errors: 0 };
  if (!e.META_PAGE_ID || !e.META_GRAPH_TOKEN) return result; // recurso desligado

  const lookback = lookbackMin && lookbackMin > 0 ? lookbackMin : e.META_POLL_LOOKBACK_MIN;
  const cutoff = now.getTime() - lookback * 60_000;
  const forms = await listLeadForms(fetchImpl);

  for (const form of forms) {
    result.forms += 1;
    let leads;
    try {
      leads = await listFormLeads(form.id, 25, fetchImpl);
    } catch {
      result.errors += 1;
      continue;
    }

    for (const leadObj of leads) {
      // Os leads vêm do mais novo para o mais antigo: ao cruzar a janela, o resto é antigo.
      const created = leadObj.created_time ? Date.parse(leadObj.created_time) : NaN;
      if (!Number.isNaN(created) && created < cutoff) break;
      result.scanned += 1;

      try {
        const mapped = mapMetaLead(leadObj);
        if (!mapped.phone && !mapped.email) continue;
        const interest = mapped.interest || cleanFormName(form.name);
        const { created: isNew } = await ingestLead({
          name: mapped.name,
          phone: mapped.phone,
          email: mapped.email,
          source: 'META_ADS',
          externalId: mapped.externalId,
          campaign: mapped.campaign,
          interest,
          raw: leadObj as unknown as Record<string, unknown>,
        });
        if (isNew) result.created += 1;
        else result.duplicate += 1;
      } catch {
        result.errors += 1;
      }
    }
  }

  return result;
}

let running = false;
let timer: NodeJS.Timeout | undefined;

/**
 * Agendador INTERNO do coletor: roda runMetaPoll periodicamente dentro do próprio
 * processo da API. Mais robusto que cron/n8n externo (sobe junto com o contêiner,
 * não depende de PATH nem de workflow configurado). Evita execuções sobrepostas.
 */
export function startMetaPollScheduler(log: { info: (m: string) => void; warn: (m: string) => void }): void {
  const e = env();
  if (!e.META_PAGE_ID || !e.META_GRAPH_TOKEN || e.META_POLL_INTERVAL_MIN <= 0) {
    log.info('Coletor do Meta: agendador interno desligado (sem META_PAGE_ID/token ou intervalo 0).');
    return;
  }

  const tick = async () => {
    if (running) return; // não sobrepõe execuções
    running = true;
    try {
      const r = await runMetaPoll();
      if (r.created > 0 || r.errors > 0) log.info(`Coletor do Meta: ${JSON.stringify(r)}`);
    } catch (err) {
      log.warn(`Coletor do Meta falhou: ${String(err)}`);
    } finally {
      running = false;
    }
  };

  const intervalMs = e.META_POLL_INTERVAL_MIN * 60_000;
  timer = setInterval(tick, intervalMs);
  timer.unref?.(); // não segura o processo no shutdown
  setTimeout(tick, 30_000); // primeira passada ~30s após subir
  log.info(`Coletor do Meta: agendador interno a cada ${e.META_POLL_INTERVAL_MIN} min (janela ${e.META_POLL_LOOKBACK_MIN} min).`);
}

/** Para o agendador (usado no shutdown/testes). */
export function stopMetaPollScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
