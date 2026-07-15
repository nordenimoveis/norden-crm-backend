import { z } from 'zod';

// Payload de webhook do WhatsApp Cloud API — cobre tanto mensagens recebidas
// quanto atualizações de status (enviada/entregue/lida/falhou) de mensagens que nós enviamos.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
export const whatsappWebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.literal('messages'),
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              phone_number_id: z.string(),
            }),
            messages: z
              .array(
                z.object({
                  from: z.string(), // telefone do lead, sem "+"
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                })
              )
              .optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(), // whatsapp_message_id da mensagem que enviamos
                  status: z.enum(['sent', 'delivered', 'read', 'failed']),
                  timestamp: z.string(),
                  recipient_id: z.string(),
                })
              )
              .optional(),
          }),
        })
      ),
    })
  ),
});

export type WhatsappWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;

export const enviarTextoSchema = z.object({
  telefone: z.string().min(8),
  texto: z.string().min(1),
});

export const enviarTemplateSchema = z.object({
  telefone: z.string().min(8),
  nomeTemplate: z.string().min(1),
  idioma: z.string().default('pt_BR'),
  parametros: z.array(z.string()).optional(),
});

export type EnviarTextoInput = z.infer<typeof enviarTextoSchema>;
export type EnviarTemplateInput = z.infer<typeof enviarTemplateSchema>;
