/**
 * Normalização de telefone para o padrão que o WhatsApp Cloud API espera:
 * DDI + DDD + número, só dígitos, ex: 5548999998888.
 */
export function normalizarTelefone(entrada: string | null | undefined): string | null {
  if (!entrada) return null;

  let digitos = String(entrada).replace(/\D/g, '');
  if (!digitos) return null;

  digitos = digitos.replace(/^0+/, '');

  if (digitos.startsWith('55')) {
    const semDdi = digitos.slice(2);
    return validarNumeroBrasileiro(semDdi) ? digitos : null;
  }

  return validarNumeroBrasileiro(digitos) ? `55${digitos}` : null;
}

function validarNumeroBrasileiro(numero: string): boolean {
  if (numero.length !== 10 && numero.length !== 11) return false;
  const ddd = parseInt(numero.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  return true;
}
