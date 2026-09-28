import { and, eq, inArray, or } from 'drizzle-orm';
import webpush from 'web-push';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { pushSubscriptions, users } from '../db/schema.js';
import type { AuthUser } from './access.js';

/**
 * Web Push: notifica o corretor (e os gestores) no celular/desktop mesmo com o
 * CRM fechado, quando o cliente manda uma mensagem no WhatsApp. As mensagens do
 * Chatwoot NUNCA saem daqui — o push carrega só "fulano respondeu" + o link do lead.
 *
 * Requer o par de chaves VAPID (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY). Sem elas, o
 * recurso fica desligado silenciosamente (o sino dentro do CRM continua valendo).
 */

let configured: boolean | null = null;

/** Configura o web-push uma única vez; devolve false se as chaves não estão definidas. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export function pushEnabled(): boolean {
  return ensureConfigured();
}

export function vapidPublicKey(): string {
  return env().VAPID_PUBLIC_KEY;
}

/** Registra (ou atualiza) a inscrição de um dispositivo do usuário. */
export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string | null,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null },
    });
}

/** Remove uma inscrição (o navegador cancelou, ou o endpoint expirou). */
export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

interface PushPayload {
  title: string;
  body: string;
  /** Rota interna do CRM aberta ao tocar na notificação (ex.: /?lead=<id>). */
  url?: string;
  /** Agrupa notificações do mesmo lead (substitui a anterior em vez de empilhar). */
  tag?: string;
}

/** Envia uma notificação a todos os dispositivos de um conjunto de usuários. */
async function sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured() || userIds.length === 0) return;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada): limpa.
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) stale.push(s.endpoint);
      }
    }),
  );
  if (stale.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, stale));
  }
}

/**
 * Notifica que um lead respondeu no WhatsApp. Vai para o corretor dono do lead e
 * para todos os gestores (DONO/ADMIN) — mesma audiência que enxerga o lead no CRM.
 * Nunca inclui o conteúdo da mensagem do cliente.
 */
export async function notifyInbound(lead: { id: string; name: string; brokerId: string | null }): Promise<void> {
  if (!ensureConfigured()) return;
  // Gestores (veem tudo) + o corretor dono do lead.
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.active, true),
        lead.brokerId
          ? or(inArray(users.role, ['DONO', 'ADMIN']), eq(users.id, lead.brokerId))
          : inArray(users.role, ['DONO', 'ADMIN']),
      ),
    );
  const ids = recipients.map((r) => r.id);
  await sendToUsers(ids, {
    title: 'Nova mensagem no WhatsApp',
    body: `${lead.name} respondeu. Toque para abrir a conversa.`,
    url: `/kanban?lead=${lead.id}`,
    tag: `lead-${lead.id}`,
  });
}

/** Envia uma notificação de teste para o próprio usuário (botão "testar" no painel). */
export async function sendTestNotification(user: AuthUser): Promise<{ delivered: number }> {
  if (!ensureConfigured()) return { delivered: 0 };
  const subs = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id));
  await sendToUsers([user.id], {
    title: 'Notificações ativas ✓',
    body: 'Você vai receber um aviso aqui quando um cliente responder no WhatsApp.',
    url: '/kanban',
    tag: 'teste',
  });
  return { delivered: subs.length };
}
