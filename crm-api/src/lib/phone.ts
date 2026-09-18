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

/** Formato E.164 exigido pelo Chatwoot/WhatsApp. */
export function toE164(phone: string): string {
  return `+${phone}`;
}
