import { env } from '../config.js';

/**
 * Leitura dos templates de mensagem aprovados na Meta (WhatsApp Business API),
 * usados para preencher o catálogo de campanhas automaticamente — o mesmo caminho
 * da Graph API que já usamos para os leads e os templates da conversa.
 */

/** Um componente do template na Meta (HEADER, BODY, FOOTER, BUTTONS). */
interface MetaComponent {
  type: string;
  text?: string;
}

interface MetaTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  components?: MetaComponent[];
}

export interface ApprovedTemplate {
  name: string;
  language: string;
  category: string;
  /** Texto do corpo (BODY) com as variáveis já convertidas para os tokens do CRM. */
  preview: string;
  /** Fontes de cada variável, na ordem ({{lead_first_name}}, {{broker_first_name}}…). */
  paramSources: string[];
}

/**
 * Convenção fixa da Norden para as variáveis dos templates (ver CLAUDE.md):
 *   {{1}} = primeiro nome do cliente, {{2}} = primeiro nome do corretor,
 *   {{3}} = empreendimento. Variáveis além disso ficam como estão (o gestor edita).
 */
const VAR_TOKENS: Record<string, string> = {
  '1': '{{lead_first_name}}',
  '2': '{{broker_first_name}}',
  '3': '{{lead_interest}}',
};

/** Troca {{1}}/{{2}}/{{3}} pelos tokens do CRM e devolve o texto + as fontes na ordem. */
export function mapBodyVariables(body: string): { preview: string; paramSources: string[] } {
  const seen = new Set<string>();
  const paramSources: string[] = [];
  const preview = body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => {
    const token = VAR_TOKENS[n] ?? `{{${n}}}`;
    if (!seen.has(n)) {
      seen.add(n);
      paramSources.push(token);
    }
    return token;
  });
  return { preview, paramSources };
}

/** Extrai o texto do corpo (BODY) de um template da Meta. */
function bodyText(t: MetaTemplate): string {
  const body = (t.components ?? []).find((c) => c.type?.toUpperCase() === 'BODY');
  return body?.text ?? '';
}

/**
 * Lista todos os templates APROVADOS da WABA, já no formato do catálogo do CRM.
 * Segue a paginação da Graph API. `fetchImpl` é injetável para os testes.
 */
export async function fetchApprovedTemplates(fetchImpl: typeof fetch = fetch): Promise<ApprovedTemplate[]> {
  const e = env();
  const token = e.META_WABA_TOKEN || e.META_GRAPH_TOKEN;
  if (!e.META_WABA_ID || !token) {
    throw new Error('Sincronização de templates desligada: defina META_WABA_ID (e um token com whatsapp_business_management).');
  }

  const out: ApprovedTemplate[] = [];
  let url =
    `${e.META_GRAPH_BASE_URL}/${e.META_GRAPH_VERSION}/${encodeURIComponent(e.META_WABA_ID)}/message_templates` +
    `?fields=name,language,category,status,components&limit=100&access_token=${encodeURIComponent(token)}`;

  // No máximo 20 páginas (proteção contra laço infinito).
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetchImpl(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Graph API (message_templates) respondeu ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { data?: MetaTemplate[]; paging?: { next?: string } };
    for (const t of data.data ?? []) {
      if (t.status?.toUpperCase() !== 'APPROVED') continue;
      const body = bodyText(t);
      const { preview, paramSources } = mapBodyVariables(body);
      out.push({
        name: t.name,
        language: t.language,
        category: t.category,
        preview: preview || t.name,
        paramSources,
      });
    }
    url = data.paging?.next ?? '';
  }
  return out;
}
