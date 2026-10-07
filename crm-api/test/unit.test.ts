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
import { REENGAGE_VARIANTS, reengagePreview } from '../src/services/reengage.js';
import { interestFromReferral, parseCtwaText, readReferral } from '../src/lib/ctwa.js';

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

test('variações de retomada: preview conectado ao cliente e ao assunto', () => {
  const ctx = { lead_first_name: 'Diana', broker_first_name: 'Ana' };
  // Todas as variações cumprem o contrato: personalizam, citam o assunto e fecham com pergunta.
  for (const v of REENGAGE_VARIANTS) {
    const p = reengagePreview(v, ctx, 'o book do Origem Jurerê');
    assert.match(p, /Diana/);
    assert.match(p, /Ana/);
    assert.match(p, /o book do Origem Jurerê/);
    assert.match(p.trim(), /\?$/); // sempre termina com pergunta
    assert.doesNotMatch(p, /\{\{/); // nenhuma variável sobrou
  }
  // Fallback de nome quando o lead não tem primeiro nome.
  const semNome = reengagePreview('leve', { broker_first_name: 'Ana' }, 'a tabela');
  assert.match(semNome, /Oi tudo bem, tudo bem\?/);
});

test('CTWA: produto a partir de texto pré-preenchido com rótulo', () => {
  const texto = 'Olá! Tenho interesse.\nEmpreendimento: Origem Jurerê\nQuando pretende comprar? Este ano';
  const p = parseCtwaText(texto, ['Origem Jurerê', 'Montblanc']);
  assert.equal(p.interest, 'Origem Jurerê');
  assert.equal(p.looksLikeAd, true);
  assert.equal(p.fields.length, 1); // só a linha "Empreendimento: ..." é um campo rotulado
  assert.equal(p.fields[0]?.label, 'Empreendimento');
});

test('CTWA: produto conhecido citado no texto livre', () => {
  const p = parseCtwaText('Vi o anúncio do Montblanc e quero saber o valor', ['Origem Jurerê', 'Montblanc']);
  assert.equal(p.interest, 'Montblanc');
});

test('CTWA: mensagem comum não inventa produto', () => {
  const p = parseCtwaText('Oi, tudo bem? Pode me ligar?', ['Origem Jurerê']);
  assert.equal(p.interest, undefined);
  assert.equal(p.looksLikeAd, false);
});

test('CTWA: referral do anúncio vira origem e produto', () => {
  const ref = readReferral({ referral: { source_type: 'ad', headline: 'Origem Jurerê — unidades à venda', ctwa_clid: 'abc123' } });
  assert.ok(ref);
  assert.equal(interestFromReferral(ref, ['Origem Jurerê']), 'Origem Jurerê');
  // Sem produto conhecido, cai para o título do anúncio.
  assert.equal(interestFromReferral(ref, []), 'Origem Jurerê — unidades à venda');
});

test('CTWA: objeto sem referral não é tratado como anúncio', () => {
  assert.equal(readReferral({ foo: 'bar' }), null);
  assert.equal(readReferral(null), null);
});

test('CTWA: casamento por palavra inteira evita falso positivo', () => {
  // "Terrá" (normaliza "terra") não pode casar com "terraço".
  const p = parseCtwaText('Quero um apê com terraço grande', ['Terrá']);
  assert.equal(p.interest, undefined);
  // Mas casa quando o produto aparece como palavra.
  const q = parseCtwaText('Tenho interesse no Terrá', ['Terrá']);
  assert.equal(q.interest, 'Terrá');
});

test('chave canônica do telefone resolve o 9º dígito', async () => {
  const { phoneKey } = await import('../src/lib/phone.js');
  // Mesmo número com e sem o 9 => mesma chave.
  assert.equal(phoneKey('5548999998888'), '554899998888');
  assert.equal(phoneKey('554899998888'), '554899998888');
  assert.equal(phoneKey('5548999998888'), phoneKey('554899998888'));
  // Fixo (8 dígitos, sem 9 inicial) fica intacto.
  assert.equal(phoneKey('554833334444'), '554833334444');
  // Estrangeiro/outros tamanhos: inalterado.
  assert.equal(phoneKey('13055550101'), '13055550101');
  assert.equal(phoneKey(null), null);
});
