/**
 * Normaliza telefones brasileiros para dígitos com DDI 55.
 * Aceita "(48) 99999-8888", "+55 48 99999-8888", "048999998888" etc.
 * Retorna null se não parecer um telefone válido.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const international = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  digits = digits.replace(/^0+/, '');

  // Sem "+", 10 ou 11 dígitos = número nacional (DDD + número)
  if (!international && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;

  // Números estrangeiros com DDI são aceitos se tiverem tamanho plausível
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

/**
 * Chave canônica para DEDUPLICAÇÃO (não para envio). Resolve a variação do 9º
 * dígito dos celulares brasileiros: 55 + DDD + 9XXXXXXXX e 55 + DDD + XXXXXXXX
 * (mesmo número, com e sem o 9) passam a ter a MESMA chave. Mantém o `phone`
 * original intacto para o envio pelo WhatsApp.
 */
export function phoneKey(normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  // 55 (DDI) + 2 (DDD) + 9 (celular com o 9) => remove o 9 para casar com a forma sem ele.
  if (normalized.length === 13 && normalized.startsWith('55') && normalized[4] === '9') {
    return normalized.slice(0, 4) + normalized.slice(5);
  }
  return normalized;
}

/** Formato E.164 exigido pelo Chatwoot/WhatsApp. */
export function toE164(phone: string): string {
  return `+${phone}`;
}
