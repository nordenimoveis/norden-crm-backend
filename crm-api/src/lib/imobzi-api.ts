import { env } from '../config.js';

/**
 * Cliente da API REST do Imobzi para a importação em massa de Contatos.
 * Auth por header `X-Imobzi-Secret`. A lista `/v1/contacts` já traz nome,
 * telefones, email e tags — então não é preciso buscar o detalhe de cada um.
 */

export interface ImobziPhone {
  number?: string | null;
  number_plain?: string | null;
  type?: string | null;
}

export interface ImobziContact {
  contact_id?: number | string | null;
  code?: string | number | null;
  name?: string | null;
  fullname?: string | null;
  email?: string | null;
  emails?: string[] | null;
  phones?: ImobziPhone[] | null;
  contact_type?: string | null;
  media_source?: string | null;
  tags?: string[] | null;
}

export interface ImobziContactsPage {
  contacts: ImobziContact[];
  cursor: string | null;
  count: string | null;
}

/** Busca uma página de contatos. `cursor` nulo = primeira página. */
export async function fetchImobziContacts(cursor: string | null, fetchImpl: typeof fetch = fetch): Promise<ImobziContactsPage> {
  const { IMOBZI_API_BASE_URL, IMOBZI_API_SECRET } = env();
  const base = IMOBZI_API_BASE_URL.replace(/\/$/, '');
  const url = `${base}/v1/contacts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  const res = await fetchImpl(url, {
    headers: { 'X-Imobzi-Secret': IMOBZI_API_SECRET },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Imobzi (contacts) respondeu ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { contacts?: ImobziContact[]; cursor?: string | null; count?: string | null };
  return { contacts: data.contacts ?? [], cursor: data.cursor ?? null, count: data.count ?? null };
}

const PLACEHOLDER_NAME = /^(n[aã]o\s*informado|naoinformado|sem\s*nome|n\/?a|-+)$/i;

/** Nome do contato, tratando os "Não informado" do Imobzi. */
export function contactName(c: ImobziContact): string {
  const n = (c.fullname || c.name || '').trim();
  if (!n || PLACEHOLDER_NAME.test(n)) return 'Contato Imobzi';
  return n;
}

/** Telefone do contato (prefere o celular; só os dígitos quando possível). */
export function contactPhone(c: ImobziContact): string | null {
  const list = c.phones ?? [];
  const mobile = list.find((p) => (p.type ?? '').toLowerCase() === 'mobile') ?? list[0];
  return (mobile?.number_plain || mobile?.number || '').trim() || null;
}

export function contactEmail(c: ImobziContact): string | null {
  return (c.email || (c.emails && c.emails[0]) || '').trim() || null;
}

/** É proprietário/locador (também compra) — a partir das tags do Imobzi. */
export function isOwner(c: ImobziContact): boolean {
  return (c.tags ?? []).some((t) => /propriet|owner|locador|landlord/i.test(t));
}

/* ------------------------------------------------------------------ */
/* Negócios (deals) — funil do Imobzi                                  */
/* ------------------------------------------------------------------ */

/** Responsável (corretor) de um negócio no Imobzi. A chave de-para é o e-mail. */
export interface ImobziDealUser {
  name?: string | null;
  email?: string | null;
  db_id?: string | null;
}

/** Contato vinculado a um negócio (traz telefone e e-mail para casar com o nosso lead). */
export interface ImobziDealContact {
  name?: string | null;
  db_id?: string | null;
  code?: string | number | null;
  phone?: ImobziPhone | null;
  phones?: ImobziPhone[] | null;
  /** No negócio, o e-mail vem como lista. */
  email?: string[] | string | null;
}

export interface ImobziDeal {
  db_id?: string | null;
  code?: string | number | null;
  title?: string | null;
  status?: string | null;
  stage_name?: string | null;
  contact?: ImobziDealContact | null;
  /** Responsável atual do negócio no Imobzi. */
  user?: ImobziDealUser | null;
}

export interface ImobziDealsPage {
  deals: ImobziDeal[];
  cursor: string | null;
  count: string | null;
}

/**
 * Busca uma página de negócios (lista plana, paginada por `cursor`).
 * Usa `/v1/deals/search` (a lista plana); `/v1/deals` vem agrupada por etapa.
 */
export async function fetchImobziDeals(cursor: string | null, fetchImpl: typeof fetch = fetch): Promise<ImobziDealsPage> {
  const { IMOBZI_API_BASE_URL, IMOBZI_API_SECRET } = env();
  const base = IMOBZI_API_BASE_URL.replace(/\/$/, '');
  const url = `${base}/v1/deals/search${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  const res = await fetchImpl(url, {
    headers: { 'X-Imobzi-Secret': IMOBZI_API_SECRET },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Imobzi (deals) respondeu ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { deals?: ImobziDeal[]; cursor?: string | null; count?: string | null };
  return { deals: data.deals ?? [], cursor: data.cursor ?? null, count: data.count ?? null };
}

/** E-mail do responsável do negócio (em minúsculas) — chave de-para com os usuários do CRM. */
export function dealOwnerEmail(d: ImobziDeal): string | null {
  return (d.user?.email || '').trim().toLowerCase() || null;
}

/** Telefone do contato do negócio (prefere o celular; só os dígitos quando possível). */
export function dealContactPhone(d: ImobziDeal): string | null {
  const c = d.contact;
  if (!c) return null;
  const list = [c.phone, ...(c.phones ?? [])].filter(Boolean) as ImobziPhone[];
  const mobile = list.find((p) => (p.type ?? '').toLowerCase() === 'mobile') ?? list[0];
  return (mobile?.number_plain || mobile?.number || '').trim() || null;
}

/** E-mail do contato do negócio (o primeiro válido). */
export function dealContactEmail(d: ImobziDeal): string | null {
  const e = d.contact?.email;
  const first = Array.isArray(e) ? e[0] : e;
  return (first || '').trim().toLowerCase() || null;
}
