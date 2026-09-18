import { and, asc, desc, eq, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import {
  campaignRecipients,
  campaigns,
  leads,
  users,
  whatsappTemplates,
  type Campaign,
  type WhatsappTemplate,
} from '../db/schema.js';
import { nextBusinessTime } from '../lib/business-hours.js';
import { badRequest, notFound, HttpError } from '../lib/errors.js';
import { buildContext, renderTemplate } from '../lib/template.js';
import { businessWindow } from './cadence.js';
import { chatwoot } from './chatwoot.js';
import { brokerToken, ensureConversation, loadBroker } from './conversation.js';
import { logEvent } from './timeline.js';

const STUCK_AFTER_MS = 15 * 60 * 1000;

/* ------------------------------ Catálogo de templates ------------------------------ */

export function listTemplates(): Promise<WhatsappTemplate[]> {
  return db.select().from(whatsappTemplates).orderBy(asc(whatsappTemplates.name));
}

export async function assertTemplate(id: string): Promise<WhatsappTemplate> {
  const [t] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, id));
  if (!t || !t.active) throw badRequest('Template inválido ou inativo');
  return t;
}

export async function createTemplate(input: {
  name: string;
  preview: string;
  paramSources?: string[];
  language?: string;
  category?: string;
}): Promise<WhatsappTemplate> {
  const name = input.name.trim();
  const preview = input.preview.trim();
  if (!name) throw badRequest('Informe o nome do template');
  if (!preview) throw badRequest('Informe o texto do template');
  const [row] = await db
    .insert(whatsappTemplates)
    .values({
      name,
      preview,
      paramSources: input.paramSources ?? [],
      language: input.language?.trim() || 'pt_BR',
      category: input.category?.trim() || 'MARKETING',
    })
    .returning();
  return row!;
}

export async function updateTemplate(
  id: string,
  patch: { name?: string; preview?: string; paramSources?: string[]; active?: boolean },
): Promise<WhatsappTemplate> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.preview !== undefined) set.preview = patch.preview.trim();
  if (patch.paramSources !== undefined) set.paramSources = patch.paramSources;
  if (patch.active !== undefined) set.active = patch.active;
  const [row] = await db.update(whatsappTemplates).set(set).where(eq(whatsappTemplates.id, id)).returning();
  if (!row) throw notFound('Template');
  return row;
}

export async function deleteTemplate(id: string): Promise<void> {
  const deleted = await db.delete(whatsappTemplates).where(eq(whatsappTemplates.id, id)).returning();
  if (deleted.length === 0) throw notFound('Template');
}

/* ------------------------------ Público (audiência) ------------------------------ */

export interface AudienceFilters {
  stages?: string[];
  temperatures?: string[];
  sources?: string[];
  brokerId?: string | null;
  includeOld?: boolean;
}

function audienceConditions(f: AudienceFilters) {
  const conds = [isNotNull(leads.phone)]; // WhatsApp exige telefone
  if (f.stages?.length) conds.push(inArray(leads.stage, f.stages));
  if (f.temperatures?.length) conds.push(inArray(leads.temperature, f.temperatures as never));
  if (f.sources?.length) conds.push(inArray(leads.source, f.sources as never));
  if (f.brokerId) conds.push(eq(leads.brokerId, f.brokerId));
  const wantsOld = f.includeOld || f.sources?.includes('BASE_ANTIGA');
  if (!wantsOld) conds.push(ne(leads.source, 'BASE_ANTIGA'));
  return and(...conds);
}

export async function previewAudience(f: AudienceFilters): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(audienceConditions(f));
  return Number(n);
}

/* ------------------------------ Campanhas ------------------------------ */

function view(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    templateName: c.templateName,
    templatePreview: c.templatePreview,
    status: c.status,
    scheduledFor: c.scheduledFor,
    total: c.total,
    sent: c.sent,
    failed: c.failed,
    createdAt: c.createdAt,
  };
}

export async function listCampaigns() {
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100);
  return rows.map(view);
}

export async function getCampaign(id: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) throw notFound('Campanha');
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'PENDENTE')::int` })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, id));
  return { ...view(c), pending: Number(pending) };
}

/** Cria a campanha como RASCUNHO, CONGELANDO o público no momento. */
export async function createCampaign(
  input: { name: string; templateId: string; filters: AudienceFilters },
  userId: string,
) {
  const name = input.name.trim();
  if (!name) throw badRequest('Informe o nome da campanha');
  const template = await assertTemplate(input.templateId);

  const audience = await db
    .select({ id: leads.id })
    .from(leads)
    .where(audienceConditions(input.filters));
  if (audience.length === 0) throw badRequest('Nenhum lead corresponde aos filtros (público vazio).');

  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        name,
        templateName: template.name,
        templatePreview: template.preview,
        paramSources: template.paramSources,
        filters: input.filters as Record<string, unknown>,
        total: audience.length,
        createdBy: userId,
      })
      .returning();
    await tx
      .insert(campaignRecipients)
      .values(audience.map((a) => ({ campaignId: campaign!.id, leadId: a.id })));
    return view(campaign!);
  });
}

/** Coloca a campanha para enviar (agora) ou agenda para o futuro. */
export async function launchCampaign(id: string, scheduledFor?: Date | null) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) throw notFound('Campanha');
  if (c.status !== 'RASCUNHO' && c.status !== 'AGENDADA') {
    throw new HttpError(409, 'A campanha já foi enviada ou cancelada.');
  }
  const now = new Date();
  const future = scheduledFor && scheduledFor.getTime() > now.getTime();
  const [row] = await db
    .update(campaigns)
    .set({
      status: future ? 'AGENDADA' : 'ENVIANDO',
      scheduledFor: future ? scheduledFor : null,
      updatedAt: now,
    })
    .where(eq(campaigns.id, id))
    .returning();
  return view(row!);
}

export async function cancelCampaign(id: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) throw notFound('Campanha');
  if (c.status === 'CONCLUIDA' || c.status === 'CANCELADA') return view(c);
  const [row] = await db
    .update(campaigns)
    .set({ status: 'CANCELADA', updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return view(row!);
}

export async function deleteCampaign(id: string): Promise<void> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) throw notFound('Campanha');
  if (c.status === 'ENVIANDO') throw new HttpError(409, 'Cancele a campanha antes de excluí-la.');
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

/* ------------------------------ Executor (n8n) ------------------------------ */

export interface CampaignRunResult {
  processed: number;
  sent: number;
  simulated: number;
  failed: number;
  skipped: number;
}

/**
 * Envia um lote de disparos pendentes. Chamado pelo n8n periodicamente.
 * Respeita o horário comercial, o modo simulado e um teto por execução.
 */
export async function runDueCampaigns(limit = env().CAMPAIGN_BATCH_SIZE, now = new Date()): Promise<CampaignRunResult> {
  const result: CampaignRunResult = { processed: 0, sent: 0, simulated: 0, failed: 0, skipped: 0 };

  // Promove campanhas agendadas cuja hora chegou.
  await db
    .update(campaigns)
    .set({ status: 'ENVIANDO', scheduledFor: null, updatedAt: now })
    .where(and(eq(campaigns.status, 'AGENDADA'), lte(campaigns.scheduledFor, now)));

  // Fora do horário comercial: não dispara marketing agora.
  if (nextBusinessTime(now, businessWindow()).getTime() !== now.getTime()) {
    return result;
  }

  // Recupera destinatários presos.
  await db
    .update(campaignRecipients)
    .set({ status: 'PENDENTE', claimedAt: null })
    .where(and(eq(campaignRecipients.status, 'PROCESSANDO'), lt(campaignRecipients.claimedAt, new Date(now.getTime() - STUCK_AFTER_MS))));

  const sending = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, 'ENVIANDO'));
  if (sending.length === 0) return result;
  const sendingIds = sending.map((c) => c.id);

  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: campaignRecipients.id })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.status, 'PENDENTE'), inArray(campaignRecipients.campaignId, sendingIds)))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!due.length) return [] as { id: string }[];
    await tx
      .update(campaignRecipients)
      .set({ status: 'PROCESSANDO', claimedAt: now })
      .where(inArray(campaignRecipients.id, due.map((d) => d.id)));
    return due;
  });

  const dryRun = !env().CAMPAIGN_SEND_ENABLED;
  const touched = new Set<string>();

  for (const { id } of claimed) {
    result.processed++;
    const [rec] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, id));
    if (!rec) continue;
    touched.add(rec.campaignId);
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, rec.campaignId));
    const [lead] = await db.select().from(leads).where(eq(leads.id, rec.leadId));
    if (!campaign || !lead) {
      await db.update(campaignRecipients).set({ status: 'FALHOU', error: 'lead/campanha ausente', claimedAt: null }).where(eq(campaignRecipients.id, id));
      result.failed++;
      continue;
    }

    try {
      const broker = await loadBroker(lead.brokerId);
      const ctx = buildContext(lead, broker);
      const params = campaign.paramSources.map((s) => renderTemplate(s, ctx));
      if (!dryRun) {
        const conversationId = await ensureConversation(lead, broker);
        await chatwoot().sendTemplate(
          conversationId,
          { name: campaign.templateName, params },
          renderTemplate(campaign.templatePreview, ctx),
          brokerToken(broker),
        );
      }
      await db.transaction(async (tx) => {
        await tx.update(campaignRecipients).set({ status: 'ENVIADO', sentAt: now, claimedAt: null, error: dryRun ? 'simulado' : null }).where(eq(campaignRecipients.id, id));
        await tx.update(campaigns).set({ sent: sql`${campaigns.sent} + 1`, updatedAt: now }).where(eq(campaigns.id, campaign.id));
        await logEvent(tx, lead.id, dryRun ? 'campaign.simulated' : 'campaign.sent', { campaignId: campaign.id, name: campaign.name });
      });
      dryRun ? result.simulated++ : result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.transaction(async (tx) => {
        await tx.update(campaignRecipients).set({ status: 'FALHOU', error: message.slice(0, 500), claimedAt: null }).where(eq(campaignRecipients.id, id));
        await tx.update(campaigns).set({ failed: sql`${campaigns.failed} + 1`, updatedAt: now }).where(eq(campaigns.id, campaign.id));
      });
      result.failed++;
    }
  }

  // Fecha campanhas sem pendências.
  for (const campaignId of touched) {
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('PENDENTE','PROCESSANDO'))::int` })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, campaignId));
    if (Number(remaining) === 0) {
      await db.update(campaigns).set({ status: 'CONCLUIDA', updatedAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'ENVIANDO')));
    }
  }

  return result;
}
