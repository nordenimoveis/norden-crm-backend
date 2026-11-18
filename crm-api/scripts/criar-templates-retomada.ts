import { env } from '../src/config.js';
import { reengageMetaTemplates } from '../src/services/reengage.js';

/**
 * Cria (ou reenvia para aprovação) os templates de RETOMADA na Meta, via Graph
 * API — o mesmo caminho que usamos para os demais templates. Os corpos vêm de
 * `src/services/reengage.ts`, então o que é criado na Meta é idêntico ao preview
 * do painel.
 *
 * Uso (dentro do contêiner da API, que já tem META_WABA_ID/META_WABA_TOKEN):
 *   docker compose exec crm-api node dist/scripts/criar-templates-retomada.js
 *
 * Idempotente na prática: se um template com o mesmo nome já existe, a Meta
 * recusa com um aviso e o script segue para os demais (não interrompe).
 *
 * Requer um token com a permissão `whatsapp_business_management`.
 */

interface MetaCreateResult {
  id?: string;
  status?: string;
  category?: string;
  error?: { message?: string; error_user_title?: string; error_user_msg?: string; code?: number };
}

async function main(): Promise<void> {
  const e = env();
  const token = e.META_WABA_TOKEN || e.META_GRAPH_TOKEN;
  if (!e.META_WABA_ID || !token) {
    console.error('Faltam META_WABA_ID e um token com whatsapp_business_management (META_WABA_TOKEN ou META_GRAPH_TOKEN).');
    process.exit(1);
  }

  const url =
    `${e.META_GRAPH_BASE_URL}/${e.META_GRAPH_VERSION}/${encodeURIComponent(e.META_WABA_ID)}/message_templates` +
    `?access_token=${encodeURIComponent(token)}`;

  const templates = reengageMetaTemplates();
  console.log(`Criando ${templates.length} templates de retomada na WABA ${e.META_WABA_ID}…\n`);

  let ok = 0;
  let falhou = 0;
  for (const t of templates) {
    const payload = {
      name: t.name,
      language: t.language,
      category: t.category,
      components: [
        {
          type: 'BODY',
          text: t.body,
          // A Meta exige um exemplo por variável, na ordem {{1}},{{2}},{{3}}.
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
      const data = (await res.json().catch(() => ({}))) as MetaCreateResult;
      if (res.ok && data.id) {
        ok++;
        console.log(`✓ ${t.name} — enviado (status: ${data.status ?? 'PENDING'}, id: ${data.id})`);
      } else {
        falhou++;
        const msg = data.error?.error_user_msg || data.error?.message || `HTTP ${res.status}`;
        console.log(`✗ ${t.name} — ${msg}`);
      }
    } catch (err) {
      falhou++;
      console.log(`✗ ${t.name} — falha de rede: ${String(err)}`);
    }
  }

  console.log(`\nResumo: ${ok} enviado(s), ${falhou} com aviso/erro.`);
  console.log('A aprovação é da Meta (alguns minutos a algumas horas). Acompanhe o status com o comando de checagem.');
}

await main();
