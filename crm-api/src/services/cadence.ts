import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db, type Tx } from '../db/client.js';
import { cadenceSteps, leads, type CadenceStep, type Lead } from '../db/schema.js';
import { nextBusinessTime, type BusinessWindow } from '../lib/business-hours.js';
import { bus } from '../lib/events.js';
import { buildContext, renderTemplate, type TemplateContext } from '../lib/template.js';
import { chatwoot, LABELS } from './chatwoot.js';
import { brokerToken, ensureConversation, loadBroker } from './conversation.js';
import { createCallTask } from './tasks.js';
import { logEvent } from './timeline.js';

/**
 * Régua da Norden — 5 contatos de WhatsApp (1 por dia) + 2 tarefas de ligação:
 *  Dia 1 (passo 1) — recepção (norden_boas_vindas): 1 a 3 min após a entrada
 *  Dia 2 (passo 2) — qualificação suave (norden_qualificacao)
 *  Dia 2 (passo 3) — LIGAÇÃO: tarefa para o corretor, se o cliente não respondeu
 *  Dia 3 (passo 4) — autoridade / off-market (norden_off_market)
 *  Dia 4 (passo 5) — apoio (norden_apoio)
 *  Dia 4 (passo 6) — LIGAÇÃO: tarefa para o corretor
 *  Dia 5 (passo 7) — despedida elegante (norden_despedida) → lead vai para "Lead Frio / Standby"
 * Tudo respeita a janela comercial (seg–sáb, 09h–19h). Qualquer mensagem do cliente cancela a régua.
 */
type CadenceChannel = 'WHATSAPP' | 'CALL';

interface StepDef {
  channel: CadenceChannel;
  /** Índice do template de WhatsApp (1..5), só para passos de canal WHATSAPP. */
  templateIndex?: number;
  /** Espera após o passo anterior, em ms (o passo 1 usa firstStepTime). */
  delayAfterPreviousMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A ligação aparece algumas horas após o WhatsApp do mesmo dia (dá tempo de o cliente responder). */
const CALL_DELAY_MS = 3 * 60 * 60 * 1000;

/** Plano da régua: passo → canal, template e espera. */
export const STEP_PLAN: Record<number, StepDef> = {
  1: { channel: 'WHATSAPP', templateIndex: 1, delayAfterPreviousMs: 0 },
  2: { channel: 'WHATSAPP', templateIndex: 2, delayAfterPreviousMs: DAY_MS },
  3: { channel: 'CALL', delayAfterPreviousMs: CALL_DELAY_MS },
  4: { channel: 'WHATSAPP', templateIndex: 3, delayAfterPreviousMs: DAY_MS },
  5: { channel: 'WHATSAPP', templateIndex: 4, delayAfterPreviousMs: DAY_MS },
  6: { channel: 'CALL', delayAfterPreviousMs: CALL_DELAY_MS },
  7: { channel: 'WHATSAPP', templateIndex: 5, delayAfterPreviousMs: DAY_MS },
};

export const FINAL_STEP = 7;
/** Quantidade de templates de WhatsApp da régua (para o seletor manual). */
export const TEMPLATE_COUNT = 5;
const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 15 * 60 * 1000;

export const TAG_LEAD_FRIO = 'Lead Frio / Standby';

/** Texto exibido no histórico do Chatwoot/CRM. Espelha o texto aprovado na Meta (docs/templates-whatsapp.md). Chave = índice do template (1..5). */
export const TEMPLATE_PREVIEWS: Record<number, string> = {
  1: 'Olá, {{lead_first_name}}! Aqui é {{broker_first_name}}, da Norden Imóveis. Recebi seu interesse e será um prazer acompanhar você pessoalmente. Quando for conveniente, me conte um pouco sobre o que procura.',
  2: 'Olá, {{lead_first_name}}. Para selecionar apenas o que realmente faz sentido para você, posso entender melhor o que imagina? Tipologia, região preferida e o momento da sua busca já me ajudam bastante. Sigo à disposição, {{broker_first_name}} | Norden Imóveis.',
  3: 'Olá, {{lead_first_name}}. Parte dos imóveis que acompanhamos em Jurerê não é divulgada publicamente. Se desejar, posso apresentar algumas oportunidades reservadas alinhadas ao seu perfil. {{broker_first_name}} | Norden Imóveis.',
  4: 'Olá, {{lead_first_name}}. Sei que uma decisão dessas merece calma. Se ajudar, posso enviar valores, plantas ou combinar uma visita sem compromisso, no seu tempo. Fico à disposição para conversar. {{broker_first_name}} | Norden Imóveis.',
  5: 'Olá, {{lead_first_name}}. Imagino que o momento talvez não seja agora, e está tudo bem. Vou pausar as mensagens por aqui, mas sigo à disposição sempre que desejar retomar. Um abraço, {{broker_first_name}} | Norden Imóveis.',
};

export function templateName(templateIndex: number): string {
  const e = env();
  return [e.TEMPLATE_STEP_1, e.TEMPLATE_STEP_2, e.TEMPLATE_STEP_3, e.TEMPLATE_STEP_4, e.TEMPLATE_STEP_5][templateIndex - 1]!;
}

/** Boas-vindas com o empreendimento ({{3}} = lead_interest). Deve espelhar o template aprovado. */
export const WELCOME_PRODUCT_PREVIEW =
  'Olá, {{lead_first_name}}! Aqui é {{broker_first_name}}, da Norden Imóveis. Recebi seu interesse no {{lead_interest}} e será um prazer te acompanhar pessoalmente. Quando puder, me conte um pouco sobre o que procura.';

export interface StepMessage {
  name: string;
  params: string[];
  preview: string;
}

/**
 * Monta nome do template, parâmetros e texto de um passo de WhatsApp.
 * No passo 1, com `welcomeWithProduct`, injeta o empreendimento do lead como
 * 3º parâmetro ({{3}}), usando o fallback quando o lead não tem produto.
 * Versão pura (sem `env`) para facilitar os testes.
 */
export function buildStepMessage(
  templateIndex: number,
  ctx: TemplateContext,
  opts: { welcomeWithProduct: boolean; productFallback: string },
): StepMessage {
  const productMode = templateIndex === 1 && opts.welcomeWithProduct;
  const product = (ctx.lead_interest && ctx.lead_interest.trim()) || opts.productFallback;
  const renderCtx = productMode ? { ...ctx, lead_interest: product } : ctx;
  const body = productMode ? WELCOME_PRODUCT_PREVIEW : TEMPLATE_PREVIEWS[templateIndex] ?? '';
  const params = [ctx.lead_first_name ?? '', ctx.broker_first_name ?? ''];
  if (productMode) params.push(product);
  return { name: templateName(templateIndex), params, preview: renderTemplate(body, renderCtx) };
}

/** Igual ao acima, lendo as opções do ambiente. */
export function renderStepMessage(templateIndex: number, ctx: TemplateContext): StepMessage {
  const e = env();
  return buildStepMessage(templateIndex, ctx, {
    welcomeWithProduct: e.WELCOME_WITH_PRODUCT,
    productFallback: e.TEMPLATE_PRODUCT_FALLBACK,
  });
}

export function businessWindow(): BusinessWindow {
  const e = env();
  return { timezone: e.TIMEZONE, startHour: e.BUSINESS_START_HOUR, endHour: e.BUSINESS_END_HOUR };
}

export function firstStepTime(now: Date, random = Math.random): Date {
  const jitterMs = 60_000 + Math.floor(random() * 120_000); // 1 a 3 minutos
  return nextBusinessTime(new Date(now.getTime() + jitterMs), businessWindow());
}

export function nextStepTime(step: number, previousSentAt: Date): Date {
  const def = STEP_PLAN[step];
  if (!def) throw new Error(`Passo inválido: ${step}`);
  return nextBusinessTime(new Date(previousSentAt.getTime() + def.delayAfterPreviousMs), businessWindow());
}

export async function scheduleStep(tx: Tx, leadId: string, step: number, when: Date) {
  await tx
    .insert(cadenceSteps)
    .values({ leadId, step, scheduledFor: when })
    .onConflictDoNothing({ target: [cadenceSteps.leadId, cadenceSteps.step] });
  await logEvent(tx, leadId, 'cadence.scheduled', { step, scheduledFor: when.toISOString() });
}

export async function cancelPendingSteps(tx: Tx, leadId: string, reason: string): Promise<number> {
  const cancelled = await tx
    .update(cadenceSteps)
    .set({ status: 'CANCELADO', lastError: reason })
    .where(and(eq(cadenceSteps.leadId, leadId), inArray(cadenceSteps.status, ['PENDENTE', 'PROCESSANDO'])))
    .returning({ id: cadenceSteps.id, step: cadenceSteps.step });
  if (cancelled.length) {
    await logEvent(tx, leadId, 'cadence.cancelled', { reason, steps: cancelled.map((c) => c.step) });
  }
  return cancelled.length;
}

/** A régua só continua enquanto o lead está em "Novo Lead" e nunca respondeu. */
function cadenceStillValid(lead: Lead): boolean {
  return lead.stage === 'NOVO_LEAD' && !lead.lastInboundAt;
}

interface RunResult {
  processed: number;
  sent: number;
  simulated: number;
  tasks: number;
  rescheduled: number;
  cancelled: number;
  failed: number;
}

/**
 * Executor chamado pelo n8n a cada 5 minutos (POST /internal/cadence/run).
 * Usa FOR UPDATE SKIP LOCKED: duas execuções simultâneas nunca pegam o mesmo passo.
 */
export async function runDueSteps(limit = 25, now = new Date()): Promise<RunResult> {
  const result: RunResult = { processed: 0, sent: 0, simulated: 0, tasks: 0, rescheduled: 0, cancelled: 0, failed: 0 };

  // Recupera passos que ficaram presos (ex.: servidor reiniciou no meio do envio)
  await db
    .update(cadenceSteps)
    .set({ status: 'PENDENTE', claimedAt: null })
    .where(
      and(
        eq(cadenceSteps.status, 'PROCESSANDO'),
        lt(cadenceSteps.claimedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    );

  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: cadenceSteps.id })
      .from(cadenceSteps)
      .where(and(eq(cadenceSteps.status, 'PENDENTE'), lte(cadenceSteps.scheduledFor, now)))
      .orderBy(cadenceSteps.scheduledFor)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!due.length) return [] as CadenceStep[];
    return tx
      .update(cadenceSteps)
      .set({ status: 'PROCESSANDO', claimedAt: now, attempts: sql`${cadenceSteps.attempts} + 1` })
      .where(inArray(cadenceSteps.id, due.map((d) => d.id)))
      .returning();
  });

  for (const step of claimed) {
    result.processed++;
    const outcome = await processStep(step, now);
    result[outcome]++;
  }
  return result;
}

type Outcome = 'sent' | 'simulated' | 'tasks' | 'rescheduled' | 'cancelled' | 'failed';

async function processStep(step: CadenceStep, now: Date): Promise<Outcome> {
  const def = STEP_PLAN[step.step];
  const [lead] = await db.select().from(leads).where(eq(leads.id, step.leadId));
  if (!lead || !def || !cadenceStillValid(lead)) {
    await db.transaction((tx) => cancelPendingSteps(tx, step.leadId, 'Lead respondeu ou saiu de "Novo Lead"'));
    return 'cancelled';
  }

  // Executor atrasado pode cair fora da janela: reagenda para o próximo horário comercial
  const allowedAt = nextBusinessTime(now, businessWindow());
  if (allowedAt.getTime() !== now.getTime()) {
    await db
      .update(cadenceSteps)
      .set({ status: 'PENDENTE', scheduledFor: allowedAt, claimedAt: null, attempts: sql`${cadenceSteps.attempts} - 1` })
      .where(eq(cadenceSteps.id, step.id));
    return 'rescheduled';
  }

  // Passo de LIGAÇÃO: cria a tarefa para o corretor (não envia nada ao cliente) e segue a régua.
  if (def.channel === 'CALL') {
    const sentAt = now;
    await db.transaction(async (tx) => {
      await createCallTask(tx, lead, step.step, sentAt);
      await tx.update(cadenceSteps).set({ status: 'ENVIADO', sentAt, claimedAt: null, lastError: null }).where(eq(cadenceSteps.id, step.id));
      // Ligação nunca é o passo final (o fim é sempre a despedida por WhatsApp).
      await scheduleStep(tx, lead.id, step.step + 1, nextStepTime(step.step + 1, sentAt));
    });
    bus.publish({ type: 'task.created', leadId: lead.id, brokerId: lead.brokerId, data: { cadenceStep: step.step } });
    return 'tasks';
  }

  const broker = await loadBroker(lead.brokerId);
  const ctx = buildContext(lead, broker);
  const templateIndex = def.templateIndex!;
  const message = renderStepMessage(templateIndex, ctx);
  const preview = message.preview;
  const dryRun = !env().CADENCE_SEND_ENABLED;

  try {
    if (!dryRun) {
      const conversationId = await ensureConversation(lead, broker);
      await chatwoot().sendTemplate(
        conversationId,
        { name: message.name, params: message.params },
        preview,
        brokerToken(broker),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const giveUp = step.attempts >= MAX_ATTEMPTS;
    await db.transaction(async (tx) => {
      await tx
        .update(cadenceSteps)
        .set({
          status: giveUp ? 'FALHOU' : 'PENDENTE',
          claimedAt: null,
          lastError: message.slice(0, 1000),
          scheduledFor: giveUp ? step.scheduledFor : nextBusinessTime(new Date(now.getTime() + 10 * 60_000 * step.attempts), businessWindow()),
        })
        .where(eq(cadenceSteps.id, step.id));
      await logEvent(tx, lead.id, 'cadence.failed', { step: step.step, attempt: step.attempts, giveUp, error: message.slice(0, 500) });
    });
    if (giveUp) bus.publish({ type: 'lead.updated', leadId: lead.id, brokerId: lead.brokerId, data: { alert: 'cadence_failed', step: step.step } });
    return 'failed';
  }

  // Usa o relógio da execução como base: mantém a régua determinística (diferença de segundos)
  const sentAt = now;
  await db.transaction(async (tx) => {
    await tx.update(cadenceSteps).set({ status: 'ENVIADO', sentAt, claimedAt: null, lastError: dryRun ? 'simulado' : null }).where(eq(cadenceSteps.id, step.id));
    await logEvent(tx, lead.id, dryRun ? 'cadence.simulated' : 'cadence.sent', { step: step.step, templateIndex, text: preview });

    if (step.step < FINAL_STEP) {
      await scheduleStep(tx, lead.id, step.step + 1, nextStepTime(step.step + 1, sentAt));
    } else {
      const tags = Array.from(new Set([...lead.tags, TAG_LEAD_FRIO]));
      await tx.update(leads).set({ stage: 'LEAD_FRIO', tags, updatedAt: sentAt }).where(eq(leads.id, lead.id));
      await logEvent(tx, lead.id, 'cadence.finished', {});
    }
  });

  if (step.step === FINAL_STEP && !dryRun && lead.chatwootConversationId) {
    chatwoot().addLabels(lead.chatwootConversationId, [LABELS.leadFrio]).catch(() => undefined);
  }
  bus.publish({ type: 'lead.updated', leadId: lead.id, brokerId: lead.brokerId, data: { cadenceStep: step.step } });
  return dryRun ? 'simulated' : 'sent';
}
