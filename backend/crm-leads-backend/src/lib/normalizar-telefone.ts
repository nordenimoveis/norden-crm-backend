/**
 * Normalização de telefone para o padrão que o WhatsApp Cloud API espera:
 * DDI + DDD + número, só dígitos, ex: 5548999998888.
 *
 * Regras aplicadas (foco no Brasil, já que é o público da Norden):
 * - Remove tudo que não é dígito (espaços, traços, parênteses, "+").
 * - Se vier com 55 na frente já é o DDI; senão, assume Brasil e adiciona 55.
 * - Valida que, depois do DDI, sobra um número plausível (10 ou 11 dígitos:
 *   DDD + 8 ou 9 dígitos). Fora disso, considera inválido.
 *
 * Retorna o telefone normalizado, ou null se for impossível aproveitar.
 */
export function normalizarTelefone(entrada: string | null | undefined): string | null {
  if (!entrada) return null;

  let digitos = String(entrada).replace(/\D/g, '');
  if (!digitos) return null;

  // Remove zeros à esquerda (ex: "0 48 9...") que às vezes vêm de exportações
  digitos = digitos.replace(/^0+/, '');

  // Já tem DDI 55?
  if (digitos.startsWith('55')) {
    const semDdi = digitos.slice(2);
    return validarNumeroBrasileiro(semDdi) ? digitos : null;
  }

  // Sem DDI — assume Brasil
  return validarNumeroBrasileiro(digitos) ? `55${digitos}` : null;
}

/**
 * Um número brasileiro válido (sem DDI) tem:
 * - 11 dígitos: DDD (2) + 9 + 8 dígitos (celular moderno), OU
 * - 10 dígitos: DDD (2) + 8 dígitos (fixo ou celular antigo).
 * O DDD precisa começar com 1-9 (não existe DDD começando com 0).
 */
function validarNumeroBrasileiro(numero: string): boolean {
  if (numero.length !== 10 && numero.length !== 11) return false;
  const ddd = parseInt(numero.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  return true;
}
