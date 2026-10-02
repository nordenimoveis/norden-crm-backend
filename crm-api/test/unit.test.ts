import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { nextBusinessTime } from '../src/lib/business-hours.js';
import { normalizePhone } from '../src/lib/phone.js';
import { buildContext, renderTemplate } from '../src/lib/template.js';
import { mapImobziPayload } from '../src/lib/imobzi.js';
import { cleanFormName } from '../src/lib/meta-leads.js';
import { mapBodyVariables } from '../src/lib/meta-templates.js';
import { contactName, contactPhone, contactEmail, isOwner } from '../src/lib/imobzi-api.js';

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

test('empreendimento a partir do nome do formulário do Meta', () => {
  assert.equal(cleanFormName('Form - Montblanc - 22/07/26 [CP]'), 'Montblanc');
  assert.equal(cleanFormName('Formulário - Terra Jurerê - 21/09/26'), 'Terra Jurerê');
  assert.equal(cleanFormName('Stay Agronômica'), 'Stay Agronômica');
  assert.equal(cleanFormName('  '), undefined);
  assert.equal(cleanFormName(null), undefined);
});

test('variáveis do template da Meta viram tokens do CRM', () => {
  const r = mapBodyVariables('Olá {{1}}, aqui é {{2}} sobre {{3}}. Podemos falar?');
  assert.equal(r.preview, 'Olá {{lead_first_name}}, aqui é {{broker_first_name}} sobre {{lead_interest}}. Podemos falar?');
  assert.deepEqual(r.paramSources, ['{{lead_first_name}}', '{{broker_first_name}}', '{{lead_interest}}']);

  // Sem variáveis: texto intacto, sem fontes.
  const s = mapBodyVariables('Mensagem fixa, sem variáveis.');
  assert.equal(s.preview, 'Mensagem fixa, sem variáveis.');
  assert.deepEqual(s.paramSources, []);

  // Variável repetida entra uma vez só nas fontes.
  const d = mapBodyVariables('{{1}}, confirmo com você, {{1}}.');
  assert.deepEqual(d.paramSources, ['{{lead_first_name}}']);
});

test('mapeamento de contato do Imobzi (API)', () => {
  const c = {
    fullname: 'Maria Silva',
    phones: [{ number: '51 99954-9115', number_plain: '51999549115', type: 'mobile' }],
    email: 'maria@x.com',
    tags: ['contact', 'leads'],
  };
  assert.equal(contactName(c), 'Maria Silva');
  assert.equal(contactPhone(c), '51999549115');
  assert.equal(contactEmail(c), 'maria@x.com');
  assert.equal(isOwner(c), false);

  // "Não informado" vira nome neutro; proprietário detectado pela tag.
  assert.equal(contactName({ fullname: 'Naoinformado' }), 'Contato Imobzi');
  assert.equal(contactName({ name: 'Não informado' }), 'Contato Imobzi');
  assert.equal(isOwner({ tags: ['Proprietário', 'owner'] }), true);
  assert.equal(contactPhone({ phones: [] }), null);
  // prefere o celular quando há vários
  assert.equal(
    contactPhone({ phones: [{ number_plain: '4833334444', type: 'phone' }, { number_plain: '48999990000', type: 'mobile' }] }),
    '48999990000',
  );
});

test('mapeamento tolerante do Imobzi', () => {
  const m = mapImobziPayload({ lead: { nome: 'João', telefones: [{ number: '48 98888-7777' }], email: 'j@x.com' }, codigo_imovel: 'AP123' });
  assert.equal(m.name, 'João');
  assert.equal(m.phone, '48 98888-7777');
  assert.equal(m.email, 'j@x.com');
  assert.equal(m.interest, 'AP123');
});
