import { env } from '../src/config.js';
import { reengageMetaTemplates } from '../src/services/reengage.js';

/**
 * ATUALIZA (edita) os templates de retomada que JÁ existem na Meta, trocando o
 * corpo pelo texto atual do `reengage.ts`. Editar reaproveita o mesmo nome e
 * dispara uma nova aprovação — é o caminho certo quando o template já foi criado
 * antes (não dá para apagar e recriar: a Meta bloqueia o nome por ~4 semanas).
 *
 * Uso (dentro do contêiner da API):
 *   docker compose exec crm-api node dist/scripts/atualizar-templates-retomada.js
 *
 * Só edita quem está em status editável (APPROVED, REJECTED, PAUSED). Quem está
 * PENDING (em análise) é pulado — espere terminar a análise e rode de novo.
 * Quem ainda não existe é pulado — use o criar-templates-retomada.
 */

interface MetaRow {
  id: string;
  name: string;
  status?: string;
}

const EDITAVEL = new Set(['APPROVED', 'REJECTED', 'PAUSED']);

async function listExisting(base: string, version: string, waba: string, token: string): Promise<Map<string, MetaRow>> {
  const map = new Map<string, MetaRow>();
  let url =
    `${base}/${version}/${encodeURIComponent(waba)}/message_templates` +
    `?fields=id,name,status&limit=200&access_token=${encodeURIComponent(token)}`;
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Graph API (listar) respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const data = (await res.json()) as { data?: MetaRow[]; paging?: { next?: string } };
    for (const row of data.data ?? []) map.set(row.name, row);
    url = data.paging?.next ?? '';
  }
  return map;
}

async function main(): Promise<void> {
  const e = env();
  const token = e.META_WABA_TOKEN || e.META_GRAPH_TOKEN;
  if (!e.META_WABA_ID || !token) {
    console.error('Faltam META_WABA_ID e um token com whatsapp_business_management.');
    process.exit(1);
  }

  const existing = await listExisting(e.META_GRAPH_BASE_URL, e.META_GRAPH_VERSION, e.META_WABA_ID, token);
  const templates = reengageMetaTemplates();
  console.log(`Atualizando os corpos na WABA ${e.META_WABA_ID}…\n`);

  let editados = 0;
  let pulados = 0;
  for (const t of templates) {
    const row = existing.get(t.name);
    if (!row) {
      pulados++;
      console.log(`– ${t.name} — não existe ainda (use o criar).`);
      continue;
    }
    if (!EDITAVEL.has((row.status ?? '').toUpperCase())) {
      pulados++;
      console.log(`– ${t.name} — status ${row.status ?? '—'} (em análise); pulei, rode de novo depois.`);
      continue;
    }

    const url = `${e.META_GRAPH_BASE_URL}/${e.META_GRAPH_VERSION}/${row.id}?access_token=${encodeURIComponent(token)}`;
    const payload = {
      components: [
        {
          type: 'BODY',
          text: t.body,
          example: { body_text: [['Mariana', 'Pedro', t.sample]] },
        },
      ],
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; error_user_msg?: string } };
      if (res.ok && (data.success ?? true)) {
        editados++;
        console.log(`✓ ${t.name} — editado, voltou para aprovação.`);
      } else {
        pulados++;
        console.log(`✗ ${t.name} — ${data.error?.error_user_msg || data.error?.message || `HTTP ${res.status}`}`);
      }
    } catch (err) {
      pulados++;
      console.log(`✗ ${t.name} — falha de rede: ${String(err)}`);
    }
  }

  console.log(`\nResumo: ${editados} editado(s), ${pulados} pulado(s).`);
  console.log('Acompanhe a reaprovação com: node dist/scripts/checar-templates-retomada.js');
}

await main();
