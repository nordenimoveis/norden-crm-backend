import { env } from '../src/config.js';
import { reengageMetaTemplates } from '../src/services/reengage.js';

/**
 * Mostra o status de aprovação (na Meta) dos templates de retomada.
 *
 * Uso (dentro do contêiner da API):
 *   docker compose exec crm-api node dist/scripts/checar-templates-retomada.js
 *
 * Status possíveis da Meta: APPROVED, PENDING, REJECTED, PAUSED, DISABLED.
 */

interface MetaTemplateRow {
  name: string;
  status?: string;
  category?: string;
}

async function main(): Promise<void> {
  const e = env();
  const token = e.META_WABA_TOKEN || e.META_GRAPH_TOKEN;
  if (!e.META_WABA_ID || !token) {
    console.error('Faltam META_WABA_ID e um token (META_WABA_TOKEN ou META_GRAPH_TOKEN).');
    process.exit(1);
  }

  const wanted = new Set(reengageMetaTemplates().map((t) => t.name));
  const found = new Map<string, string>();

  let url =
    `${e.META_GRAPH_BASE_URL}/${e.META_GRAPH_VERSION}/${encodeURIComponent(e.META_WABA_ID)}/message_templates` +
    `?fields=name,status,category&limit=200&access_token=${encodeURIComponent(token)}`;

  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Graph API respondeu ${res.status}: ${text.slice(0, 300)}`);
      process.exit(1);
    }
    const data = (await res.json()) as { data?: MetaTemplateRow[]; paging?: { next?: string } };
    for (const row of data.data ?? []) {
      if (wanted.has(row.name)) found.set(row.name, row.status ?? '—');
    }
    url = data.paging?.next ?? '';
  }

  console.log('Status dos templates de retomada na Meta:\n');
  for (const name of wanted) {
    const status = found.get(name);
    const marca = status === 'APPROVED' ? '✓' : status ? '…' : '✗';
    console.log(`${marca} ${name.padEnd(28)} ${status ?? 'não encontrado (ainda não criado)'}`);
  }
  const todosAprovados = [...wanted].every((n) => found.get(n) === 'APPROVED');
  console.log(todosAprovados ? '\nTodos aprovados — já pode usar no "Retomar contato".' : '\nAinda há templates não aprovados. Rode de novo mais tarde.');
}

await main();
