/**
 * Regras de horário comercial da cadência (Regras Globais 1 e 2):
 * - Nunca enviar fora de 09h00–19h00.
 * - Enviar de segunda a sábado. Domingo é bloqueado para automações.
 *
 * Brasil (fuso de Florianópolis/São Paulo) não tem mais horário de verão desde 2019,
 * então o offset de -03:00 em relação a UTC é fixo o ano todo. Por isso resolvemos
 * isso com aritmética simples, sem precisar de uma lib de timezone — se a operação
 * um dia cobrir outro fuso (ex: filial em outro estado com DST), revisar aqui.
 */

const OFFSET_HORAS_BRASIL = -3;
const HORARIO_INICIO = 9; // 09h00
const HORARIO_FIM = 19; // 19h00
const DOMINGO = 0;

function paraHorarioLocal(data: Date): Date {
  return new Date(data.getTime() + OFFSET_HORAS_BRASIL * 60 * 60 * 1000);
}

function paraUtc(dataLocal: Date): Date {
  return new Date(dataLocal.getTime() - OFFSET_HORAS_BRASIL * 60 * 60 * 1000);
}

/** Verifica se um instante (em UTC) cai dentro da janela comercial no horário do Brasil. */
export function estaDentroDoHorarioComercial(data: Date): boolean {
  const local = paraHorarioLocal(data);
  const diaSemana = local.getUTCDay();
  const hora = local.getUTCHours();

  if (diaSemana === DOMINGO) return false;
  return hora >= HORARIO_INICIO && hora < HORARIO_FIM;
}

/**
 * Ajusta uma data para o próximo horário comercial válido.
 * Se já estiver dentro da janela, retorna a mesma data sem alteração.
 * Caso contrário, avança para as 09h00 do próximo dia útil disponível
 * (pulando domingo).
 */
export function proximoHorarioComercial(data: Date): Date {
  let local = paraHorarioLocal(data);

  // Máximo de 8 iterações é mais que suficiente (não existem 8 domingos seguidos)
  for (let tentativas = 0; tentativas < 8; tentativas++) {
    const diaSemana = local.getUTCDay();
    const hora = local.getUTCHours();

    if (diaSemana === DOMINGO) {
      local = proximoDiaAs9h(local);
      continue;
    }

    if (hora < HORARIO_INICIO) {
      local = comHorario(local, HORARIO_INICIO);
      break;
    }

    if (hora >= HORARIO_FIM) {
      local = proximoDiaAs9h(local);
      continue;
    }

    // já está dentro da janela válida
    break;
  }

  return paraUtc(local);
}

function comHorario(data: Date, hora: number): Date {
  const nova = new Date(data);
  nova.setUTCHours(hora, 0, 0, 0);
  return nova;
}

function proximoDiaAs9h(data: Date): Date {
  const nova = new Date(data);
  nova.setUTCDate(nova.getUTCDate() + 1);
  nova.setUTCHours(HORARIO_INICIO, 0, 0, 0);
  return nova;
}

/**
 * Retorna a data no formato YYYY-MM-DD considerando o fuso do Brasil — usado
 * como chave do contador diário de disparos (trava anti-ban).
 */
export function formatarDataBrasil(data: Date): string {
  const local = paraHorarioLocal(data);
  const ano = local.getUTCFullYear();
  const mes = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(local.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Calcula a próxima janela comercial válida a partir de AMANHÃ (ignora o
 * restante do dia de hoje). Usado pelo backlog do limite diário: se o teto
 * de mensagens de hoje já foi atingido, o disparo vai para as 09h00 do
 * próximo dia útil, mesmo que ainda estejamos dentro do horário comercial agora.
 */
export function proximaJanelaComercialAmanha(data: Date): Date {
  const amanha = new Date(data);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  amanha.setUTCHours(0, 0, 0, 0);
  return proximoHorarioComercial(amanha);
}
