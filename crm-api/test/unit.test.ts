import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { nextBusinessTime } from '../src/lib/business-hours.js';
import { normalizePhone } from '../src/lib/phone.js';
import { buildContext, renderTemplate } from '../src/lib/template.js';
import { mapImobziPayload } from '../src/lib/imobzi.js';

const W = { timezone: 'America/Sao_Paulo', startHour: 9, endHour: 19 };
const at = (iso: string) => DateTime.fromISO(iso, { zone: W.timezone }).toJSDate();
const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: W.timezone }).toFormat("ccc yyyy-MM-dd HH:mm");

test('horário comercial', () => {
  // 2026-09-14 é segunda-feira
  assert.equal(fmt(nextBusinessTime(at('2026-09-14T10:30'), W)), 'Mon 2026-09-14 10:30');
  assert.equal(fmt(nextBusinessTime(at('2026-09-14T07:00'), W)), 'Mon 2026-09-14 09:00');
  assert.equal(fmt(nextBusinessTime(at('2026-09-14T19:00'), W)), 'Tue 2026-09-15 09:00');
  assert.equal(fmt(nextBusinessTime(at('2026-09-19T18:59'), W)), 'Sat 2026-09-19 18:59');
  assert.equal(fmt(nextBusinessTime(at('2026-09-19T20:00'), W)), 'Mon 2026-09-21 09:00');
  assert.equal(fmt(nextBusinessTime(at('2026-09-20T12:00'), W)), 'Mon 2026-09-21 09:00');
});

test('normalização de telefone', () => {
  assert.equal(normalizePhone('(48) 99999-8888'), '5548999998888');
  assert.equal(normalizePhone('+55 48 99999-8888'), '5548999998888');
  assert.equal(normalizePhone('048 3333-4444'), '554833334444');
  assert.equal(normalizePhone('+1 305 555 0101'), '13055550101');
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(''), null);
});

test('variáveis das respostas rápidas', () => {
  const ctx = buildContext({ name: 'Maria Souza', interest: 'Ônix 302' }, { name: 'Pedro Lima' });
  assert.equal(
    renderTemplate('Olá {{lead_first_name}}, aqui é {{broker_name}} sobre {{ lead_interest }} {{desconhecida}}', ctx),
    'Olá Maria, aqui é Pedro Lima sobre Ônix 302 {{desconhecida}}',
  );
});

test('mapeamento tolerante do Imobzi', () => {
  const m = mapImobziPayload({ lead: { nome: 'João', telefones: [{ number: '48 98888-7777' }], email: 'j@x.com' }, codigo_imovel: 'AP123' });
  assert.equal(m.name, 'João');
  assert.equal(m.phone, '48 98888-7777');
  assert.equal(m.email, 'j@x.com');
  assert.equal(m.interest, 'AP123');
});
