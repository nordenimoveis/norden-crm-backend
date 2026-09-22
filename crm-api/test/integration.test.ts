/**
 * Teste de ponta a ponta com PostgreSQL real e um Chatwoot simulado.
 * Requer TEST_DATABASE_URL apontando para um banco vazio já migrado.
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { after, before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  test('integração (ignorado: defina TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  type Call = { method: string; path: string; body: any; token: string };
  const calls: Call[] = [];
  let msgId = 1000;
  const mock = createServer(async (req: IncomingMessage, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : undefined;
    const path = (req.url ?? '').replace(/^\/api\/v1\/accounts\/1/, '');
    calls.push({ method: req.method!, path, body, token: String(req.headers['api_access_token']) });
    const send = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    // Graph API simulada (busca do lead do formulário do Meta): /v21.0/<leadgen_id>?...
    if (/^\/v\d+\.\d+\//.test(path))
      return send({ id: '900900', field_data: [{ name: 'full_name', values: ['Lead Meta Form'] }, { name: 'phone_number', values: ['+55 48 99123-4567'] }, { name: 'email', values: ['form@meta.test'] }], campaign_name: 'Jurerê Lançamento' });
    if (path.startsWith('/contacts/search')) return send({ payload: [] });
    if (path === '/contacts') return send({ payload: { contact: { id: 11 } } });
    if (path === '/conversations') return send({ id: 500 + calls.filter((c) => c.path === '/conversations').length });
    if (/\/labels$/.test(path) && req.method === 'GET') return send({ payload: ['existente'] });
    if (/\/messages/.test(path) && req.method === 'GET')
      return send({ payload: [{ id: 1, content: 'Oi, tenho interesse', message_type: 0, private: false, created_at: 1_700_000_000 }] });
    if (/\/messages$/.test(path)) return send({ id: ++msgId, content: body.content, message_type: 1, private: !!body.private, created_at: 1_700_000_100, sender: { name: 'X' } });
    return send({});
  });

  let app: any;
  let db: any;
  let schema: any;
  let tokens: Record<string, string> = {};
  let ids: Record<string, string> = {};
  const internal = randomBytes(16).toString('hex');
  const cwHook = randomBytes(16).toString('hex');
  const imobziHook = randomBytes(16).toString('hex');

  before(async () => {
    await new Promise<void>((r) => mock.listen(0, r));
    const port = (mock.address() as any).port;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PUBLIC_URL: 'http://localhost',
      DATABASE_URL: DB,
      JWT_SECRET: randomBytes(32).toString('hex'),
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      INTERNAL_API_KEY: internal,
      CHATWOOT_WEBHOOK_TOKEN: cwHook,
      IMOBZI_WEBHOOK_TOKEN: imobziHook,
      CHATWOOT_BASE_URL: `http://127.0.0.1:${port}`,
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '2',
      CHATWOOT_ADMIN_TOKEN: 'admin-token',
      N8N_AI_WEBHOOK_URL: '',
      CADENCE_SEND_ENABLED: 'true',
      CAMPAIGN_SEND_ENABLED: 'true',
      META_LEADGEN_TOKEN: 'meta-hook-secret',
      META_GRAPH_TOKEN: 'graph-token',
      META_GRAPH_BASE_URL: `http://127.0.0.1:${port}`,
      META_GRAPH_VERSION: 'v21.0',
    });
    const { buildServer } = await import('../src/server.js');
    ({ db } = await import('../src/db/client.js'));
    schema = await import('../src/db/schema.js');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`truncate lead_events, cadence_steps, quick_replies, leads, users cascade`);
    const bcrypt = (await import('bcryptjs')).default;
    await db.insert(schema.users).values({ name: 'Dono Norden', email: 'dono@norden.test', passwordHash: await bcrypt.hash('senha-forte-123', 4), role: 'DONO', inRotation: false });
    app = await buildServer();
  });

  after(async () => {
    await app?.close();
    const { closeDb } = await import('../src/db/client.js');
    await closeDb();
    mock.close();
  });

  const login = async (email: string, password: string) => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().token as string;
  };
  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  test('fluxo completo', async (t) => {
    await t.test('gestor cria corretores', async () => {
      tokens.dono = await login('dono@norden.test', 'senha-forte-123');
      for (const [key, name, agent] of [['ana', 'Ana Prado', 7], ['bruno', 'Bruno Reis', 8]] as const) {
        const r = await app.inject({ method: 'POST', url: '/users', headers: as('dono'), payload: { name, email: `${key}@norden.test`, password: 'senha-forte-123', chatwootAgentId: agent, chatwootToken: `token-${key}-xyz` } });
        assert.equal(r.statusCode, 201, r.body);
        assert.equal(r.json().chatwootConfigured, true);
        assert.equal(r.json().chatwootToken, undefined);
        ids[key] = r.json().id;
        tokens[key] = await login(`${key}@norden.test`, 'senha-forte-123');
      }
      const denied = await app.inject({ method: 'GET', url: '/users', headers: as('ana') });
      assert.equal(denied.statusCode, 403);
    });

    await t.test('entrada de leads com roleta e deduplicação', async () => {
      const brokers: string[] = [];
      for (const [i, phone] of ['(48) 99111-0001', '48991110002', '+55 48 99111-0003'].entries()) {
        const r = await app.inject({ method: 'POST', url: '/internal/leads/ingest', headers: { 'x-internal-key': internal }, payload: { name: `Cliente ${i + 1} Silva`, phone, source: 'META_ADS', campaign: 'Jurerê' } });
        assert.equal(r.statusCode, 201, r.body);
        ids[`lead${i + 1}`] = r.json().id;
        brokers.push(r.json().brokerId);
      }
      assert.notEqual(brokers[0], brokers[1], 'roleta alterna');
      assert.equal(brokers[0], brokers[2]);
      const dup = await app.inject({ method: 'POST', url: '/internal/leads/ingest', headers: { 'x-internal-key': internal }, payload: { name: 'Repetido', phone: '48 99111-0001', source: 'INSTAGRAM' } });
      assert.equal(dup.statusCode, 200);
      assert.equal(dup.json().created, false);
      const noKey = await app.inject({ method: 'POST', url: '/internal/leads/ingest', payload: {} });
      assert.equal(noKey.statusCode, 401);
    });

    await t.test('isolamento entre corretores', async () => {
      const ownerOf1 = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as('dono') })).json().lead.brokerId;
      const owner = ownerOf1 === ids.ana ? 'ana' : 'bruno';
      const other = owner === 'ana' ? 'bruno' : 'ana';
      ids.owner1 = owner; ids.other1 = other;
      const mine = (await app.inject({ method: 'GET', url: '/leads', headers: as(owner) })).json();
      const theirs = (await app.inject({ method: 'GET', url: '/leads', headers: as(other) })).json();
      assert.equal(mine.length, 2);
      assert.equal(theirs.length, 1);
      assert.ok(mine.every((l: any) => l.brokerId === ids[owner]));
      for (const url of [`/leads/${ids.lead1}`, `/leads/${ids.lead1}/messages`]) {
        const r = await app.inject({ method: 'GET', url, headers: as(other) });
        assert.equal(r.statusCode, 403, url);
      }
      const patch = await app.inject({ method: 'PATCH', url: `/leads/${ids.lead1}`, headers: as(other), payload: { temperature: 'QUENTE' } });
      assert.equal(patch.statusCode, 403);
      const all = (await app.inject({ method: 'GET', url: '/leads', headers: as('dono') })).json();
      assert.equal(all.length, 3);
    });

    await t.test('cadência: envia passo 1 no horário comercial e agenda o passo 2', async () => {
      const { runDueSteps } = await import('../src/services/cadence.js');
      const { sql } = await import('drizzle-orm');
      const monday10 = DateTime.fromISO('2030-01-07T10:00', { zone: 'America/Sao_Paulo' }).toJSDate();
      const sunday = DateTime.fromISO('2030-01-06T10:00', { zone: 'America/Sao_Paulo' }).toJSDate();
      await db.execute(sql`update cadence_steps set scheduled_for = ${'2030-01-05T00:00:00Z'}`);

      const onSunday = await runDueSteps(25, sunday);
      assert.equal(onSunday.rescheduled, 3, 'domingo bloqueado');

      await db.execute(sql`update cadence_steps set scheduled_for = ${'2030-01-05T00:00:00Z'}`);
      const res = await runDueSteps(25, monday10);
      assert.equal(res.sent, 3, JSON.stringify(res));
      const tpl = calls.filter((c) => c.body?.template_params);
      assert.equal(tpl.length, 3);
      assert.equal(tpl[0]!.body.template_params.name, 'norden_boas_vindas');
      assert.equal(tpl[0]!.body.template_params.processed_params['1'], 'Cliente');
      assert.ok(tpl.every((c) => c.token.startsWith('token-')), 'mensagem sai com o token do corretor');
      const again = await runDueSteps(25, monday10);
      assert.equal(again.processed, 0, 'passo 2 ainda não venceu');
      const detail = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as('dono') })).json();
      assert.deepEqual(detail.cadence.map((c: any) => [c.step, c.status]), [[1, 'ENVIADO'], [2, 'PENDENTE']]);
    });

    await t.test('cliente responde: cadência cancelada e alerta', async () => {
      const detail = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as('dono') })).json();
      assert.equal(detail.lead.hasConversation, true);
      const { eq } = await import('drizzle-orm');
      const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, ids.lead1));
      const bad = await app.inject({ method: 'POST', url: '/webhooks/chatwoot?token=errado', payload: {} });
      assert.equal(bad.statusCode, 401);
      const r = await app.inject({
        method: 'POST', url: `/webhooks/chatwoot?token=${cwHook}`,
        payload: { event: 'message_created', id: 1, content: 'Olá!', message_type: 'incoming', private: false, conversation: { id: lead.chatwootConversationId, meta: { sender: { phone_number: '+5548991110001' } } } },
      });
      assert.equal(r.json().handled, 'entrada');
      const after = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as('dono') })).json();
      assert.equal(after.lead.stage, 'AGUARDANDO_RESPOSTA');
      assert.ok(after.lead.tags.includes('Atendimento Humano'));
      assert.equal(after.cadence.find((c: any) => c.step === 2).status, 'CANCELADO');
      const labels = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/labels')).at(-1);
      assert.deepEqual(labels!.body.labels.sort(), ['atendimento-humano', 'existente']);
    });

    await t.test('chat embutido: janela de 24h e mudança de etapa', async () => {
      const owner = ids.owner1!;
      const ok = await app.inject({ method: 'POST', url: `/leads/${ids.lead1}/messages`, headers: as(owner), payload: { content: 'Olá! Que bom falar com você.' } });
      assert.equal(ok.statusCode, 201, ok.body);
      assert.equal(calls.at(-1)!.token, `token-${owner}-xyz`);
      const detail = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as(owner) })).json();
      assert.equal(detail.lead.stage, 'EM_ATENDIMENTO');
      const hist = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}/messages`, headers: as(owner) })).json();
      assert.equal(hist.canSendFreeText, true);
      assert.equal(hist.messages[0].direction, 'in');
      const other = (await app.inject({ method: 'GET', url: '/leads', headers: as(owner) })).json().find((l: any) => l.id !== ids.lead1);
      const blocked = await app.inject({ method: 'POST', url: `/leads/${other.id}/messages`, headers: as(owner), payload: { content: 'oi' } });
      assert.equal(blocked.statusCode, 409);
    });

    await t.test('respostas rápidas com variáveis', async () => {
      const g = await app.inject({ method: 'POST', url: '/quick-replies', headers: as('dono'), payload: { shortcut: 'visita', title: 'Agendar visita', body: '{{lead_first_name}}, aqui é {{broker_first_name}}. Podemos agendar uma visita?', global: true } });
      assert.equal(g.statusCode, 201, g.body);
      const denied = await app.inject({ method: 'POST', url: '/quick-replies', headers: as('ana'), payload: { shortcut: 'x1', title: 'Global', body: 'x', global: true } });
      assert.equal(denied.statusCode, 403);
      const p = await app.inject({ method: 'POST', url: '/quick-replies', headers: as('ana'), payload: { shortcut: 'minha', title: 'Pessoal', body: 'teste' } });
      assert.equal(p.statusCode, 201);
      const listB = (await app.inject({ method: 'GET', url: '/quick-replies', headers: as('bruno') })).json();
      assert.deepEqual(listB.map((q: any) => q.shortcut), ['visita']);
      const owner = ids.owner1!;
      const r = await app.inject({ method: 'POST', url: `/quick-replies/${g.json().id}/render`, headers: as(owner), payload: { leadId: ids.lead1 } });
      const expectedBroker = owner === 'ana' ? 'Ana' : 'Bruno';
      assert.equal(r.json().text, `Cliente, aqui é ${expectedBroker}. Podemos agendar uma visita?`);
    });

    await t.test('transferência pelo gestor', async () => {
      const denied = await app.inject({ method: 'POST', url: `/leads/${ids.lead1}/transfer`, headers: as(ids.owner1!), payload: { brokerId: ids[ids.other1!] } });
      assert.equal(denied.statusCode, 403);
      const r = await app.inject({ method: 'POST', url: `/leads/${ids.lead1}/transfer`, headers: as('dono'), payload: { brokerId: ids[ids.other1!] } });
      assert.equal(r.statusCode, 200, r.body);
      const now = await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as(ids.other1!) });
      assert.equal(now.statusCode, 200);
      const before = await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as(ids.owner1!) });
      assert.equal(before.statusCode, 403);
      assert.equal(calls.at(-1)!.path.endsWith('/assignments'), true);
    });

    await t.test('número desconhecido vira lead sem cadência', async () => {
      const r = await app.inject({
        method: 'POST', url: `/webhooks/chatwoot?token=${cwHook}`,
        payload: { event: 'message_created', id: 2, content: 'Vi o anúncio', message_type: 'incoming', conversation: { id: 900, meta: { sender: { id: 55, name: 'Carla Nova', phone_number: '+5548990000099' } } } },
      });
      assert.equal(r.json().handled, 'entrada');
      const all = (await app.inject({ method: 'GET', url: '/leads?q=Carla', headers: as('dono') })).json();
      assert.equal(all.length, 1);
      assert.equal(all[0].source, 'WHATSAPP_DIRETO');
      assert.equal(all[0].stage, 'AGUARDANDO_RESPOSTA');
      const d = (await app.inject({ method: 'GET', url: `/leads/${all[0].id}`, headers: as('dono') })).json();
      assert.equal(d.cadence.length, 0);
    });

    await t.test('webhook do Imobzi e base antiga', async () => {
      const r = await app.inject({ method: 'POST', url: `/webhooks/imobzi?token=${imobziHook}`, payload: { contact: { name: 'Lead Site', cellphone: '48 98888-1234', email: 'SITE@x.com' }, property_code: 'TERRA-801' } });
      assert.equal(r.statusCode, 201, r.body);
      const { ingestLead } = await import('../src/services/leads.js');
      const old = await ingestLead({ name: 'Antigo', phone: '4830001111', source: 'BASE_ANTIGA' });
      assert.equal(old.lead.brokerId, null);
      assert.deepEqual(old.lead.tags, ['Base Antiga']);
      const kanban = (await app.inject({ method: 'GET', url: '/leads', headers: as('dono') })).json();
      assert.ok(!kanban.some((l: any) => l.source === 'BASE_ANTIGA'));
      const site = kanban.find((l: any) => l.source === 'SITE');
      assert.equal(site.interest, 'TERRA-801');
      assert.equal(site.email, 'site@x.com');
    });

    await t.test('passo 4 leva o lead para Lead Frio', async () => {
      const { runDueSteps } = await import('../src/services/cadence.js');
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`update cadence_steps set status = 'ENVIADO' where lead_id = ${ids.lead2}`);
      await db.execute(sql`update cadence_steps set status = 'CANCELADO' where status = 'PENDENTE'`);
      await db.execute(sql`insert into cadence_steps (lead_id, step, scheduled_for) values (${ids.lead2}, 4, ${'2030-01-01T00:00:00Z'})`);
      const monday10 = DateTime.fromISO('2030-01-07T10:00', { zone: 'America/Sao_Paulo' }).toJSDate();
      const res = await runDueSteps(25, monday10);
      assert.equal(res.sent, 1, JSON.stringify(res));
      const d = (await app.inject({ method: 'GET', url: `/leads/${ids.lead2}`, headers: as('dono') })).json();
      assert.equal(d.lead.stage, 'LEAD_FRIO');
      assert.ok(d.lead.tags.includes('Lead Frio / Standby'));
    });

    await t.test('resultado da IA vira nota privada e sugestão', async () => {
      const r = await app.inject({ method: 'POST', url: '/internal/ai/result', headers: { 'x-internal-key': internal }, payload: { leadId: ids.lead1, summary: 'Busca 3 suítes em Jurerê', suggestedTemperature: 'QUENTE', draftReply: 'Perfeito!' } });
      assert.equal(r.statusCode, 200, r.body);
      const note = calls.at(-1)!;
      assert.equal(note.body.private, true);
      assert.equal(note.token, 'admin-token');
      const owner = ids.other1!;
      const acc = await app.inject({ method: 'POST', url: `/leads/${ids.lead1}/accept-ai-temperature`, headers: as(owner) });
      assert.equal(acc.json().temperature, 'QUENTE');
    });

    await t.test('relatório só para gestores', async () => {
      const denied = await app.inject({ method: 'GET', url: '/reports/summary', headers: as('ana') });
      assert.equal(denied.statusCode, 403);
      const r = await app.inject({ method: 'GET', url: '/reports/summary', headers: as('dono') });
      assert.equal(r.statusCode, 200, r.body);
      assert.ok(r.json().byBroker.length >= 2);
    });

    await t.test('funil editável: cria/renomeia/exclui e protege etapa de sistema', async () => {
      const stages = (await app.inject({ method: 'GET', url: '/pipeline/stages', headers: as('dono') })).json();
      assert.ok(stages.length >= 8);
      assert.ok(stages.some((s: any) => s.key === 'PERDIDO' && s.systemRole === 'LOST'));
      const novo = stages.find((s: any) => s.key === 'NOVO_LEAD');
      assert.equal(novo.isSystem, true);

      const denied = await app.inject({ method: 'POST', url: '/pipeline/stages', headers: as('ana'), payload: { label: 'Reserva' } });
      assert.equal(denied.statusCode, 403);

      const created = await app.inject({ method: 'POST', url: '/pipeline/stages', headers: as('dono'), payload: { label: 'Reserva Técnica' } });
      assert.equal(created.statusCode, 201, created.body);
      const custom = created.json();
      assert.equal(custom.isSystem, false);
      assert.equal(custom.position, stages.length + 1);

      const renamed = await app.inject({ method: 'PATCH', url: `/pipeline/stages/${custom.id}`, headers: as('dono'), payload: { label: 'Reserva' } });
      assert.equal(renamed.json().label, 'Reserva');

      const sysDel = await app.inject({ method: 'DELETE', url: `/pipeline/stages/${novo.id}`, headers: as('dono') });
      assert.equal(sysDel.statusCode, 400, 'etapa de sistema não pode ser excluída');

      const del = await app.inject({ method: 'DELETE', url: `/pipeline/stages/${custom.id}`, headers: as('dono') });
      assert.equal(del.statusCode, 204);
    });

    await t.test('motivos de perda: só gestor cria', async () => {
      const list = (await app.inject({ method: 'GET', url: '/loss-reasons', headers: as('dono') })).json();
      assert.ok(list.length >= 6);
      const denied = await app.inject({ method: 'POST', url: '/loss-reasons', headers: as('ana'), payload: { label: 'X' } });
      assert.equal(denied.statusCode, 403);
      const created = await app.inject({ method: 'POST', url: '/loss-reasons', headers: as('dono'), payload: { label: 'Comprou na planta' } });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().active, true);
    });

    await t.test('perdido: exige motivo, mantém na base e recupera ao sair', async () => {
      const reasons = (await app.inject({ method: 'GET', url: '/loss-reasons', headers: as('dono') })).json();
      const reasonId = reasons[0].id;

      const noReason = await app.inject({ method: 'PATCH', url: `/leads/${ids.lead3}`, headers: as('dono'), payload: { stage: 'PERDIDO' } });
      assert.equal(noReason.statusCode, 400, 'perda sem motivo é recusada');

      const bad = await app.inject({ method: 'PATCH', url: `/leads/${ids.lead3}`, headers: as('dono'), payload: { stage: 'NAO_EXISTE' } });
      assert.equal(bad.statusCode, 400, 'etapa inexistente é recusada');

      const lost = await app.inject({ method: 'PATCH', url: `/leads/${ids.lead3}`, headers: as('dono'), payload: { stage: 'PERDIDO', lossReasonId: reasonId } });
      assert.equal(lost.statusCode, 200, lost.body);
      assert.equal(lost.json().stage, 'PERDIDO');
      assert.equal(lost.json().lostReasonId, reasonId);
      assert.ok(lost.json().lostAt);

      const all = (await app.inject({ method: 'GET', url: '/leads', headers: as('dono') })).json();
      assert.ok(all.some((l: any) => l.id === ids.lead3 && l.stage === 'PERDIDO'), 'lead perdido continua na base');

      const back = await app.inject({ method: 'PATCH', url: `/leads/${ids.lead3}`, headers: as('dono'), payload: { stage: 'NOVO_LEAD' } });
      assert.equal(back.json().stage, 'NOVO_LEAD');
      assert.equal(back.json().lostReasonId, null);
      assert.equal(back.json().lostAt, null);
    });

    await t.test('envio manual de template (fora da janela de 24h)', async () => {
      const list = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}/templates`, headers: as('dono') })).json();
      assert.equal(list.length, 4);
      assert.equal(list[0].name, 'norden_boas_vindas');
      assert.ok(list[0].preview.includes('Cliente'), 'preview preenche o primeiro nome');

      const sent = await app.inject({ method: 'POST', url: `/leads/${ids.lead1}/template`, headers: as('dono'), payload: { step: 1 } });
      assert.equal(sent.statusCode, 201, sent.body);
      const tplCall = calls.filter((c) => c.body?.template_params).at(-1);
      assert.equal(tplCall!.body.template_params.name, 'norden_boas_vindas');

      const d = (await app.inject({ method: 'GET', url: `/leads/${ids.lead1}`, headers: as('dono') })).json();
      assert.equal(d.lead.stage, 'EM_ATENDIMENTO');

      // lead1 foi transferido para other1; owner1 não é mais dono → 403
      const denied = await app.inject({ method: 'POST', url: `/leads/${ids.lead1}/template`, headers: as(ids.owner1!), payload: { step: 1 } });
      assert.equal(denied.statusCode, 403);
    });

    await t.test('campanha em massa: template, público congelado, disparo e conclusão', async () => {
      const denied = await app.inject({ method: 'POST', url: '/campaign-templates', headers: as('ana'), payload: { name: 'x', preview: 'y' } });
      assert.equal(denied.statusCode, 403, 'corretor não gerencia campanhas');

      const tpl = await app.inject({
        method: 'POST',
        url: '/campaign-templates',
        headers: as('dono'),
        payload: { name: 'norden_lancamento', preview: 'Olá {{lead_first_name}}, novidade em Jurerê!', paramSources: ['{{lead_first_name}}'] },
      });
      assert.equal(tpl.statusCode, 201, tpl.body);
      const templateId = tpl.json().id;

      const prev = await app.inject({ method: 'POST', url: '/campaigns/preview-audience', headers: as('dono'), payload: { includeOld: false } });
      assert.ok(prev.json().count >= 1, 'público tem leads com telefone');

      const created = await app.inject({ method: 'POST', url: '/campaigns', headers: as('dono'), payload: { name: 'Lançamento X', templateId, filters: { includeOld: false } } });
      assert.equal(created.statusCode, 201, created.body);
      const camp = created.json();
      assert.equal(camp.status, 'RASCUNHO');
      assert.ok(camp.total >= 1);

      const launched = await app.inject({ method: 'POST', url: `/campaigns/${camp.id}/launch`, headers: as('dono'), payload: {} });
      assert.equal(launched.json().status, 'ENVIANDO');

      const { runDueCampaigns } = await import('../src/services/campaigns.js');
      const monday10 = DateTime.fromISO('2030-01-07T10:00', { zone: 'America/Sao_Paulo' }).toJSDate();
      const res = await runDueCampaigns(100, monday10);
      assert.ok(res.sent >= 1, JSON.stringify(res));
      const tplCall = calls.filter((c) => c.body?.template_params?.name === 'norden_lancamento').at(-1);
      assert.ok(tplCall, 'o template da campanha foi enviado ao Chatwoot');

      const detail = (await app.inject({ method: 'GET', url: `/campaigns/${camp.id}`, headers: as('dono') })).json();
      assert.equal(detail.status, 'CONCLUIDA');
      assert.equal(detail.pending, 0);
      assert.equal(detail.sent, camp.total);
    });

    await t.test('leads do Meta: verificação do webhook e criação via formulário', async () => {
      const token = 'meta-hook-secret';

      // GET de verificação: só devolve o desafio se o verify token bater
      const verify = await app.inject({ method: 'GET', url: `/webhooks/meta-leadgen?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=desafio123` });
      assert.equal(verify.statusCode, 200);
      assert.equal(verify.body, 'desafio123');
      const badVerify = await app.inject({ method: 'GET', url: `/webhooks/meta-leadgen?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x` });
      assert.equal(badVerify.statusCode, 403);

      // POST sem o token na query → 401
      const noToken = await app.inject({ method: 'POST', url: '/webhooks/meta-leadgen', payload: { object: 'page', entry: [] } });
      assert.equal(noToken.statusCode, 401);

      // POST de evento leadgen → busca o lead na Graph (mock) e cria com origem META_ADS
      const evt = await app.inject({
        method: 'POST',
        url: `/webhooks/meta-leadgen?token=${token}`,
        payload: { object: 'page', entry: [{ id: 'PAGE1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: '900900', form_id: 'F1', page_id: 'PAGE1' } }] }] },
      });
      assert.equal(evt.statusCode, 200, evt.body);
      assert.equal(evt.json().created, 1);

      const list = (await app.inject({ method: 'GET', url: '/leads', headers: as('dono') })).json();
      const metaLead = list.find((l: any) => l.name === 'Lead Meta Form');
      assert.ok(metaLead, 'lead do formulário do Meta apareceu no Kanban');
      const full = (await app.inject({ method: 'GET', url: `/leads/${metaLead.id}`, headers: as('dono') })).json();
      assert.equal(full.lead.source, 'META_ADS');
    });

    await t.test('importação da base antiga: só gestor, como Base Antiga, sem roleta/cadência', async () => {
      const denied = await app.inject({
        method: 'POST',
        url: '/leads/import',
        headers: as('ana'),
        payload: { rows: [{ name: 'X', phone: '48 3000-9000' }] },
      });
      assert.equal(denied.statusCode, 403, 'corretor não importa base');

      const res = await app.inject({
        method: 'POST',
        url: '/leads/import',
        headers: as('dono'),
        payload: {
          rows: [
            { name: 'Imob Um', phone: '48 3222-1000', email: 'um@old.com', interest: 'Cobertura' },
            { name: 'Imob Dois', phone: '48 3222-2000' },
            { name: 'Sem Contato' },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const out = res.json();
      assert.equal(out.created, 2, JSON.stringify(out));
      assert.equal(out.errors.length, 1, 'linha sem telefone/e-mail é reportada');
      assert.equal(out.errors[0].row, 3);

      // Base Antiga fica fora do Kanban por padrão…
      const kanban = (await app.inject({ method: 'GET', url: '/leads?q=Imob', headers: as('dono') })).json();
      assert.ok(!kanban.some((l: any) => l.name === 'Imob Um'), 'base antiga fica fora do Kanban');

      // …e aparece ao incluir a base antiga, sem corretor, com a etiqueta e sem cadência.
      const old = (await app.inject({ method: 'GET', url: '/leads?includeOld=true&q=Imob', headers: as('dono') })).json();
      const one = old.find((l: any) => l.name === 'Imob Um');
      assert.ok(one, 'aparece ao incluir a base antiga');
      assert.equal(one.source, 'BASE_ANTIGA');
      assert.equal(one.brokerId, null);
      assert.deepEqual(one.tags, ['Base Antiga']);
      const detail = (await app.inject({ method: 'GET', url: `/leads/${one.id}`, headers: as('dono') })).json();
      assert.equal(detail.cadence.length, 0, 'base antiga não agenda cadência');
    });
  });
}
