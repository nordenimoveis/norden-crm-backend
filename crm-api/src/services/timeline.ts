import type { Db, Tx } from '../db/client.js';
import { leadEvents } from '../db/schema.js';

export type EventType =
  | 'lead.created'
  | 'lead.reentry'
  | 'lead.assigned'
  | 'lead.transferred'
  | 'lead.updated'
  | 'cadence.scheduled'
  | 'cadence.sent'
  | 'cadence.simulated'
  | 'cadence.failed'
  | 'cadence.cancelled'
  | 'cadence.finished'
  | 'message.inbound'
  | 'message.outbound'
  | 'template.sent'
  | 'template.simulated'
  | 'campaign.sent'
  | 'campaign.simulated'
  | 'note.created'
  | 'ai.suggestion'
  | 'chatwoot.error';

export async function logEvent(
  conn: Db | Tx,
  leadId: string,
  type: EventType,
  payload: Record<string, unknown> = {},
  actorId: string | null = null,
) {
  await conn.insert(leadEvents).values({ leadId, type, payload, actorId });
}
