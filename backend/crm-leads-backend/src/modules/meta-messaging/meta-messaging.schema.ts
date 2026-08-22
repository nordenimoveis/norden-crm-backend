import { z } from 'zod';

/**
 * Webhook unificado de mensageria da Meta — cobre Instagram Direct, Messenger
 * e comentários de posts (IG/Facebook). Um mesmo App da Meta entrega tudo aqui;
 * o campo raiz `object` diz de qual produto veio ("instagram" ou "page"), e
 * cada `entry` pode trazer `messaging` (DMs) e/ou `changes` (comentários/feed).
 *
 * Os schemas são propositalmente permissivos (.passthrough / .optional): a Meta
 * adiciona campos com frequência e um payload com um campo extra NUNCA deve
 * derrubar o processamento de um evento válido.
 * Docs:
 *  - Messenger:  https://developers.facebook.com/docs/messenger-platform/webhooks
 *  - Instagram:  https://developers.facebook.com/docs/instagram-platform/webhooks
 */

// --- Evento de mensagem direta (DM) — mesmo formato em IG e Messenger --------
const attachmentSchema = z
  .object({
    type: z.string(), // image | video | audio | file | story_mention | share | ...
    payload: z
      .object({
        url: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const messagingEventSchema = z
  .object({
    sender: z.object({ id: z.string() }).passthrough(),
    recipient: z.object({ id: z.string() }).passthrough(),
    timestamp: z.number().optional(),
    message: z
      .object({
        mid: z.string().optional(),
        text: z.string().optional(),
        is_echo: z.boolean().optional(), // true = mensagem que NÓS enviamos, ecoada de volta
        attachments: z.array(attachmentSchema).optional(),
      })
      .passthrough()
      .optional(),
    // Recibos de entrega/leitura — reconhecidos mas não processados (o painel
    // não exibe "lida" para DM ainda; ficam aqui para não gerar warning de parse).
    delivery: z.record(z.unknown()).optional(),
    read: z.record(z.unknown()).optional(),
  })
  .passthrough();

// --- Evento de comentário -----------------------------------------------------
// Instagram (field "comments") e Facebook (field "feed", item "comment") têm
// formatos ligeiramente diferentes; este schema aceita os dois.
const commentChangeSchema = z
  .object({
    field: z.string(), // "comments" (IG) | "feed" (FB)
    value: z
      .object({
        // IG usa `id`; FB usa `comment_id`.
        id: z.string().optional(),
        comment_id: z.string().optional(),
        // FB feed traz `item` ("comment", "status", "reaction"...) — só nos
        // interessa "comment".
        item: z.string().optional(),
        verb: z.string().optional(), // add | edited | remove | hide
        post_id: z.string().optional(),
        parent_id: z.string().optional(),
        media: z.object({ id: z.string().optional() }).passthrough().optional(),
        text: z.string().optional(), // IG
        message: z.string().optional(), // FB
        permalink: z.string().optional(),
        from: z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
            username: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string(),
    time: z.number().optional(),
    messaging: z.array(messagingEventSchema).optional(),
    changes: z.array(commentChangeSchema).optional(),
    // Instagram entrega DMs em `messaging`; algumas versões usam `standby`
    // (handover). Tratamos standby igual a messaging para não perder mensagem.
    standby: z.array(messagingEventSchema).optional(),
  })
  .passthrough();

export const metaMessagingPayloadSchema = z
  .object({
    object: z.string(), // "instagram" | "page"
    entry: z.array(entrySchema),
  })
  .passthrough();

export type MetaMessagingPayload = z.infer<typeof metaMessagingPayloadSchema>;
export type MessagingEvent = z.infer<typeof messagingEventSchema>;
export type CommentChange = z.infer<typeof commentChangeSchema>;

// --- Schemas dos endpoints internos (painel) ---------------------------------
export const enviarDmSchema = z.object({
  texto: z.string().min(1),
});
export type EnviarDmInput = z.infer<typeof enviarDmSchema>;

export const responderComentarioSchema = z.object({
  texto: z.string().min(1),
});
export type ResponderComentarioInput = z.infer<typeof responderComentarioSchema>;

export const listarComentariosQuerySchema = z.object({
  canal: z.enum(['instagram', 'messenger']).optional(),
  respondido: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  busca: z.string().optional(),
});
export type ListarComentariosQuery = z.infer<typeof listarComentariosQuerySchema>;
