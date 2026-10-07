import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { cadenceSteps, campaignRecipients, leadEvents, leadTasks, leads, type Lead } from '../db/schema.js';
import { logEvent } from './timeline.js';

/** Prioridade de origem (qual registro representa melhor a aquisição real). */
const SRC_RANK: Record<string, number> = {
  META_ADS: 5,
  INSTAGRAM: 5,
  SITE: 4,
  MANUAL: 3,
  WHATSAPP_DIRETO: 2,
  BASE_ANTIGA: 1,
};
const rank = (s: string) => SRC_RANK[s] ?? 0;

/** Grupos de leads que compartilham a mesma chave de telefone (duplicados). */
export async function findDuplicateGroups(): Promise<string[][]> {
  const rows = await db
    .select({ key: leads.phoneKey, ids: sql<string[]>`array_agg(${leads.id} order by ${leads.createdAt})` })
    .from(leads)
    .where(isNotNull(leads.phoneKey))
    .groupBy(leads.phoneKey)
    .having(sql`count(*) > 1`);
  return rows.map((r) => r.ids);
}

const ts = (d: Date | null | undefined) => (d ? d.getTime() : 0);

/** Escolhe o registro que vai SOBREVIVER (mantém a conversa e o histórico). */
function pickPrimary(group: Lead[]): Lead {
  return [...group].sort((a, b) => {
    const conv = Number(Boolean(b.chatwootConversationId)) - Number(Boolean(a.chatwootConversationId));
    if (conv !== 0) return conv;
    const fun = Number(b.inFunnel) - Number(a.inFunnel);
    if (fun !== 0) return fun;
    const inb = ts(b.lastInboundAt) - ts(a.lastInboundAt);
    if (inb !== 0) return inb;
    return ts(a.createdAt) - ts(b.createdAt); // mais antigo
  })[0]!;
}

/** Mescla todos os registros de um grupo no primário (dentro de uma transação). */
async function mergeGroup(ids: string[]): Promise<{ primaryId: string; merged: number } | null> {
  return db.transaction(async (tx) => {
    const group = await tx.select().from(leads).where(sql`${leads.id} = ANY(${ids})`).for('update');
    if (group.length < 2) return null;

    const primary = pickPrimary(group);
    const dups = group.filter((l) => l.id !== primary.id);
    // Melhor registro de identidade (origem mais "forte") para nome/produto/origem.
    const identity = [...group].sort((a, b) => rank(b.source) - rank(a.source))[0]!;

    for (const dup of dups) {
      // Move os filhos ANTES de apagar o duplicado (senão o cascade apaga tudo).
      await tx.update(cadenceSteps).set({ leadId: primary.id }).where(eq(cadenceSteps.leadId, dup.id));
      await tx.update(leadTasks).set({ leadId: primary.id }).where(eq(leadTasks.leadId, dup.id));
      await tx.update(leadEvents).set({ leadId: primary.id }).where(eq(leadEvents.leadId, dup.id));
      // campaign_recipients tem unique(campaign_id, lead_id): move só os que o primário ainda não tem.
      await tx.execute(sql`
        UPDATE campaign_recipients SET lead_id = ${primary.id}
        WHERE lead_id = ${dup.id}
          AND campaign_id NOT IN (SELECT campaign_id FROM campaign_recipients WHERE lead_id = ${primary.id})
      `);
      await tx.delete(campaignRecipients).where(eq(campaignRecipients.leadId, dup.id));
      await tx.delete(leads).where(eq(leads.id, dup.id));
    }

    // Campos mesclados (identidade da melhor origem; conversa/estado do primário).
    const nonNull = <T>(vals: (T | null | undefined)[]): T | undefined => vals.find((v) => v != null && v !== ('' as unknown as T)) ?? undefined;
    const longestPhone = group.map((l) => l.phone).filter(Boolean).sort((a, b) => (b!.length - a!.length))[0] ?? primary.phone;
    const tags = Array.from(new Set(group.flatMap((l) => l.tags)));
    const temperature = group.map((l) => l.temperature).find((t) => t !== 'NAO_AVALIADO') ?? primary.temperature;
    const maxInbound = Math.max(...group.map((l) => ts(l.lastInboundAt)));

    const [merged] = await tx
      .update(leads)
      .set({
        name: identity.name?.trim() || primary.name,
        source: identity.source,
        phone: longestPhone,
        phoneKey: primary.phoneKey ?? identity.phoneKey,
        email: primary.email ?? nonNull(group.map((l) => l.email)) ?? null,
        interest: primary.interest ?? nonNull(group.map((l) => l.interest)) ?? null,
        campaign: primary.campaign ?? nonNull(group.map((l) => l.campaign)) ?? null,
        temperature,
        inFunnel: group.some((l) => l.inFunnel),
        brokerId: primary.brokerId ?? nonNull(group.map((l) => l.brokerId)) ?? null,
        chatwootConversationId: primary.chatwootConversationId ?? nonNull(group.map((l) => l.chatwootConversationId)) ?? null,
        chatwootContactId: primary.chatwootContactId ?? nonNull(group.map((l) => l.chatwootContactId)) ?? null,
        lastCampaignId: primary.lastCampaignId ?? nonNull(group.map((l) => l.lastCampaignId)) ?? null,
        lastInboundAt: maxInbound > 0 ? new Date(maxInbound) : null,
        tags,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, primary.id))
      .returning();

    await logEvent(tx, primary.id, 'lead.updated', { mergedFrom: dups.map((d) => ({ id: d.id, name: d.name, source: d.source })) });
    return { primaryId: merged!.id, merged: dups.length };
  });
}

/**
 * Mescla todos os leads duplicados por telefone. dryRun só conta os grupos.
 * Retorna quantos grupos e quantos registros foram absorvidos.
 */
export async function dedupAllByPhone(dryRun = false): Promise<{ groups: number; mergedRecords: number }> {
  const groups = await findDuplicateGroups();
  if (dryRun) return { groups: groups.length, mergedRecords: groups.reduce((s, g) => s + (g.length - 1), 0) };
  let mergedRecords = 0;
  for (const ids of groups) {
    const r = await mergeGroup(ids);
    if (r) mergedRecords += r.merged;
  }
  return { groups: groups.length, mergedRecords };
}
