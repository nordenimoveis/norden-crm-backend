import { env } from '../config.js';

/** Um campo do formulário do Meta: { name, values }. */
export interface MetaFieldDatum {
  name: string;
  values: string[];
}

/** Lead retornado pela Graph API. */
export interface MetaLead {
  id: string;
  created_time?: string;
  field_data?: MetaFieldDatum[];
  form_id?: string;
  campaign_name?: string;
  ad_name?: string;
}

/**
 * Busca os dados completos de um lead na Graph API.
 * `fetchImpl` é injetável para os testes (padrão: fetch global).
 */
export async function fetchMetaLead(leadgenId: string, fetchImpl: typeof fetch = fetch): Promise<MetaLead> {
  const { META_GRAPH_BASE_URL, META_GRAPH_VERSION, META_GRAPH_TOKEN } = env();
  const fields = 'id,created_time,field_data,form_id,campaign_name,ad_name';
  const url =
    `${META_GRAPH_BASE_URL}/${META_GRAPH_VERSION}/${encodeURIComponent(leadgenId)}` +
    `?fields=${fields}&access_token=${encodeURIComponent(META_GRAPH_TOKEN)}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph API respondeu ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as MetaLead;
}

/** Busca o nome do formulário do Meta (usado como "empreendimento" quando não há campo próprio). */
export async function fetchFormName(formId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const { META_GRAPH_BASE_URL, META_GRAPH_VERSION, META_GRAPH_TOKEN } = env();
  const url =
    `${META_GRAPH_BASE_URL}/${META_GRAPH_VERSION}/${encodeURIComponent(formId)}` +
    `?fields=name&access_token=${encodeURIComponent(META_GRAPH_TOKEN)}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    return data.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Extrai o nome do empreendimento a partir do nome do formulário.
 * Ex.: "Form - Montblanc - 22/07/26 [CP]" → "Montblanc"; "Terra Jurerê" → "Terra Jurerê".
 * Para melhor resultado, nomeie os formulários pelo empreendimento (ex.: "Montblanc").
 */
export function cleanFormName(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  s = s.replace(/^(form(ul[aá]rio)?|lead)\s*[-–|:]\s*/i, ''); // tira prefixo "Form - "
  s = s.split(/\s*[-–|]\s*/)[0] ?? s; // corta data/etiqueta após separador
  s = s.replace(/\[[^\]]*\]/g, '').trim(); // remove "[CP]" e afins
  if (!s || s.length > 60) return undefined;
  return s;
}

/** Aliases tolerantes para os nomes dos campos do formulário (o gestor pode nomear como quiser). */
const FIELD_ALIASES = {
  name: ['full_name', 'name', 'nome', 'nome_completo'],
  first: ['first_name', 'primeiro_nome'],
  last: ['last_name', 'sobrenome'],
  phone: ['phone_number', 'phone', 'telefone', 'celular', 'whatsapp', 'whatsapp_number'],
  email: ['email', 'e-mail', 'e_mail'],
  product: ['empreendimento', 'imovel', 'imóvel', 'produto', 'interesse', 'unidade', 'projeto'],
};

function pick(fd: MetaFieldDatum[], names: string[]): string | undefined {
  for (const f of fd) {
    const key = (f.name ?? '').toLowerCase();
    if (names.includes(key)) {
      const v = f.values?.[0];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return undefined;
}

/** Converte o lead cru da Meta no formato aceito pela porta de entrada (`ingestLead`). */
export function mapMetaLead(lead: MetaLead): {
  name: string;
  phone?: string;
  email?: string;
  campaign?: string;
  /** Empreendimento vindo de um campo do formulário (se houver). */
  interest?: string;
  /** ID do formulário, para buscar o nome quando não há campo de empreendimento. */
  formId?: string;
  externalId: string;
} {
  const fd = lead.field_data ?? [];
  let name = pick(fd, FIELD_ALIASES.name);
  if (!name) {
    const first = pick(fd, FIELD_ALIASES.first);
    const last = pick(fd, FIELD_ALIASES.last);
    name = [first, last].filter(Boolean).join(' ') || 'Sem nome';
  }
  return {
    name,
    phone: pick(fd, FIELD_ALIASES.phone),
    email: pick(fd, FIELD_ALIASES.email),
    campaign: lead.campaign_name?.trim() || undefined,
    interest: pick(fd, FIELD_ALIASES.product),
    formId: lead.form_id,
    externalId: lead.id,
  };
}
