import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import { closeDb } from '../src/db/client.js';
import { ingestLead } from '../src/services/leads.js';
import { mapImobziPayload } from '../src/lib/imobzi.js';

/**
 * Importa a base antiga exportada do Imobzi (CSV).
 * Os leads entram com a etiqueta "Base Antiga": sem roleta e sem cadência.
 * Uso: node dist/scripts/import-imobzi.js /caminho/contatos.csv
 * Aceita cabeçalhos como nome/name, telefone/celular/phone, email.
 */
const file = process.argv[2];
if (!file) {
  console.error('Informe o caminho do CSV.');
  process.exit(1);
}

const content = readFileSync(file, 'utf8');
const delimiter = content.split('\n')[0]?.includes(';') ? ';' : ',';
const rows = parse(content, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), delimiter, skip_empty_lines: true, bom: true }) as Record<string, string>[];

let created = 0;
let duplicated = 0;
let skipped = 0;
for (const row of rows) {
  const m = mapImobziPayload(row);
  if (!m.phone && !m.email) {
    skipped++;
    continue;
  }
  try {
    const r = await ingestLead({ ...m, source: 'BASE_ANTIGA', campaign: null, raw: row });
    r.created ? created++ : duplicated++;
  } catch (err) {
    skipped++;
    console.warn(`Linha ignorada (${m.name}): ${String(err)}`);
  }
}
console.log(`Importação concluída: ${created} novos, ${duplicated} já existentes, ${skipped} ignorados (de ${rows.length}).`);
await closeDb();
