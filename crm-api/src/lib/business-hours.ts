import { DateTime } from 'luxon';

export interface BusinessWindow {
  timezone: string;
  startHour: number; // inclusive
  endHour: number; // exclusive
}

/** Domingo (7 no Luxon) é bloqueado. Segunda (1) a sábado (6) são dias úteis. */
function isBusinessDay(dt: DateTime): boolean {
  return dt.weekday !== 7;
}

/**
 * Devolve o próprio instante se ele estiver dentro da janela comercial;
 * caso contrário, o próximo início de expediente válido.
 */
export function nextBusinessTime(date: Date, w: BusinessWindow): Date {
  let dt = DateTime.fromJSDate(date, { zone: w.timezone });

  for (let i = 0; i < 8; i++) {
    const start = dt.set({ hour: w.startHour, minute: 0, second: 0, millisecond: 0 });
    const end = dt.set({ hour: w.endHour % 24, minute: 0, second: 0, millisecond: 0 });

    if (isBusinessDay(dt)) {
      if (dt < start) return start.toJSDate();
      if (w.endHour === 24 || dt < end) return dt.toJSDate();
    }
    dt = dt.plus({ days: 1 }).set({ hour: w.startHour, minute: 0, second: 0, millisecond: 0 });
    if (isBusinessDay(dt)) return dt.toJSDate();
  }
  throw new Error('Não foi possível encontrar um horário comercial válido');
}

export function isWithinBusinessHours(date: Date, w: BusinessWindow): boolean {
  return nextBusinessTime(date, w).getTime() === date.getTime();
}
