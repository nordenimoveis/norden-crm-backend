import { z } from 'zod';

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
                  from: z.string(),
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
                  id: z.string(),
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

export const midiaTipoEnum = z.enum(['image', 'video', 'document']);

export const enviarTemplateSchema = z.object({
  telefone: z.string().min(8),
  nomeTemplate: z.string().min(1),
  idioma: z.string().default('pt_BR'),
  parametros: z.array(z.string()).optional(),
  midiaUrl: z.string().url().optional(),
  midiaTipo: midiaTipoEnum.optional(),
});

export type MidiaTipo = z.infer<typeof midiaTipoEnum>;

export type EnviarTextoInput = z.infer<typeof enviarTextoSchema>;
export type EnviarTemplateInput = z.infer<typeof enviarTemplateSchema>;
