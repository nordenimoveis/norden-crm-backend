/**
 * Captura de origem/produto de leads que chegam pelo WhatsApp (Click-to-WhatsApp
 * da Meta e mensagens diretas). Dois sinais:
 *
 *  1. `referral` da Meta (anúncio CTWA): o WhatsApp Cloud API anexa à 1ª mensagem
 *     um objeto com o anúncio de origem (headline/body/source_id/ctwa_clid). É a
 *     prova de que o lead veio de Meta Ads — e costuma trazer o empreendimento no
 *     título do anúncio.
 *  2. Texto pré-preenchido: muitos anúncios abrem o WhatsApp com um texto já
 *     escrito, às vezes com as perguntas do formulário em formato "Rótulo: valor".
 *
 * Tudo aqui é função pura (sem rede), para ser testável e determinística.
 */

/** Normaliza para comparação: minúsculas, sem acento, espaços colapsados. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Referral de anúncio da Meta, em formato tolerante (os nomes variam por fonte). */
export interface CtwaReferral {
  headline?: string | null;
  body?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  ctwaClid?: string | null;
}

export interface CtwaParsed {
  /** Empreendimento/produto detectado, se houver. */
  interest?: string;
  /** Pares "Rótulo: valor" achados no texto pré-preenchido (perguntas do form). */
  fields: { label: string; value: string }[];
  /** Indícios de que o texto é pré-preenchido de anúncio (rótulos ou produto conhecido). */
  looksLikeAd: boolean;
}

const INTEREST_LABEL = /(empreend|im[oó]vel|produto|interesse|unidade|projeto)/i;
const LINE_FIELD = /^\s*([\p{L}][\p{L}\s/()-]{1,40}?)\s*[:：]\s*(.+?)\s*$/u;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Acha, numa lista de produtos conhecidos, o primeiro citado no texto.
 * Casa por PALAVRA INTEIRA (evita "Terrá" bater com "terraço", "Rise" com "sunrise").
 */
export function matchKnownProduct(text: string, knownProducts: string[]): string | undefined {
  const hay = norm(text);
  for (const p of knownProducts) {
    const needle = norm(p);
    if (!needle) continue;
    const re = new RegExp(`\\b${escapeRegex(needle)}\\b`);
    if (re.test(hay)) return p;
  }
  return undefined;
}

/**
 * Lê o texto (pré-preenchido ou não) e extrai rótulos, produto e indício de anúncio.
 * `knownProducts` é a lista de empreendimentos da Norden (do catálogo/config).
 */
export function parseCtwaText(text: string | null | undefined, knownProducts: string[] = []): CtwaParsed {
  const fields: { label: string; value: string }[] = [];
  if (text) {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(LINE_FIELD);
      if (m && m[1] && m[2]) fields.push({ label: m[1].trim(), value: m[2].trim() });
    }
  }

  // 1) Produto a partir de um rótulo explícito ("Empreendimento: Origem Jurerê").
  let interest: string | undefined;
  const labeled = fields.find((f) => INTEREST_LABEL.test(f.label));
  if (labeled) interest = labeled.value;

  // 2) Senão, tenta casar com um produto conhecido mencionado em qualquer lugar.
  if (!interest && text) interest = matchKnownProduct(text, knownProducts);

  const looksLikeAd = fields.length >= 2 || Boolean(interest && knownProducts.length > 0 && matchKnownProduct(text ?? '', knownProducts));
  return { interest: interest?.slice(0, 140), fields, looksLikeAd };
}

/** Extrai o empreendimento do referral do anúncio (título > produto conhecido no título/corpo). */
export function interestFromReferral(ref: CtwaReferral | null | undefined, knownProducts: string[] = []): string | undefined {
  if (!ref) return undefined;
  const fromKnown = matchKnownProduct(`${ref.headline ?? ''} ${ref.body ?? ''}`, knownProducts);
  if (fromKnown) return fromKnown;
  const headline = (ref.headline ?? '').trim();
  return headline ? headline.slice(0, 140) : undefined;
}

/** Há referral de anúncio? (basta um identificador do anúncio). */
export function hasAdReferral(ref: CtwaReferral | null | undefined): ref is CtwaReferral {
  if (!ref) return false;
  return Boolean(ref.headline || ref.sourceId || ref.ctwaClid || ref.sourceUrl);
}

/**
 * Normaliza o referral a partir dos formatos que o Chatwoot/WhatsApp podem mandar
 * (na mensagem `content_attributes` ou na conversa `additional_attributes`).
 */
export function readReferral(source: Record<string, unknown> | null | undefined): CtwaReferral | null {
  if (!source || typeof source !== 'object') return null;
  // Procura um objeto de referral em chaves conhecidas, ou usa o próprio objeto.
  const candidate =
    (source.referral as Record<string, unknown>) ??
    (source.referer as Record<string, unknown>) ??
    (source.referrer as Record<string, unknown>) ??
    source;
  if (!candidate || typeof candidate !== 'object') return null;
  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = candidate[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  const ref: CtwaReferral = {
    headline: str('headline', 'ad_headline', 'title'),
    body: str('body', 'ad_body', 'description'),
    sourceId: str('source_id', 'sourceId', 'ad_id', 'source_ad_id'),
    sourceUrl: str('source_url', 'sourceUrl', 'url'),
    sourceType: str('source_type', 'sourceType', 'type'),
    ctwaClid: str('ctwa_clid', 'ctwaClid', 'click_id'),
  };
  return hasAdReferral(ref) ? ref : null;
}
