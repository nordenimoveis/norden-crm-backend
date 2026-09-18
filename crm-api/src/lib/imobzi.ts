/**
 * Utilitários do webhook do Imobzi (sem dependências de banco, para facilitar testes).
 */
type Obj = Record<string, unknown>;

/** Procura o primeiro campo preenchido entre vários nomes possíveis, inclusive em objetos aninhados comuns. */
export function pick(payload: Obj, keys: string[]): string | null {
  const scopes: Obj[] = [payload];
  for (const k of ['lead', 'contact', 'contato', 'data', 'cliente', 'person', 'pessoa']) {
    const v = payload[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) scopes.push(v as Obj);
  }
  for (const scope of scopes) {
    for (const key of keys) {
      const v = scope[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
      if (Array.isArray(v) && v.length) {
        const first = v[0];
        if (typeof first === 'string') return first;
        if (first && typeof first === 'object') {
          const inner = (first as Obj).number ?? (first as Obj).value ?? (first as Obj).phone ?? (first as Obj).email;
          if (typeof inner === 'string') return inner;
        }
      }
    }
  }
  return null;
}

/**
 * Mapeamento tolerante do webhook do Imobzi.
 * O payload bruto fica salvo na linha do tempo do lead: se algum campo vier vazio,
 * confira lá o nome real e acrescente-o às listas abaixo.
 */
export function mapImobziPayload(p: Obj) {
  return {
    name: pick(p, ['name', 'nome', 'fullname', 'full_name', 'nome_completo']) ?? 'Lead do site',
    phone: pick(p, ['phone', 'telefone', 'celular', 'cellphone', 'mobile', 'whatsapp', 'phones', 'telefones']),
    email: pick(p, ['email', 'e-mail', 'mail', 'emails']),
    externalId: pick(p, ['lead_id', 'id', 'db_id', 'code', 'codigo']),
    interest: pick(p, ['property_code', 'codigo_imovel', 'property', 'imovel', 'property_title', 'interest']),
    notes: pick(p, ['message', 'mensagem', 'comments', 'observacao', 'observacoes']),
    campaign: pick(p, ['source', 'origem', 'media_source', 'campaign', 'utm_campaign']),
  };
}

