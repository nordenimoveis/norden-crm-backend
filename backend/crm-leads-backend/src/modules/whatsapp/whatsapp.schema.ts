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
            // Perfil de quem enviou (nome do WhatsApp + wa_id) — usado para
            // nomear o lead quando um número novo manda mensagem.
            contacts: z
              .array(
                z.object({
                  profile: z.object({ name: z.string() }).optional(),
                  wa_id: z.string(),
                })
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(), // telefone do lead, sem "+"
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  // Resposta por botão de template (quick reply / CTA).
                  button: z
                    .object({ text: z.string().optional(), payload: z.string().optional() })
                    .optional(),
                  // Resposta de botão/lista interativa.
                  interactive: z
                    .object({
                      button_reply: z
                        .object({ id: z.string().optional(), title: z.string().optional() })
                        .optional(),
                      list_reply: z
                        .object({ id: z.string().optional(), title: z.string().optional() })
                        .optional(),
                    })
                    .optional(),
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
                  // Só vem quando status = failed. Traz o motivo da não-entrega
                  // (ex.: 131049 marketing descartado, 131026 indisponível).
                  errors: z
                    .array(
                      z.object({
                        code: z.number().optional(),
                        title: z.string().optional(),
                        message: z.string().optional(),
                        error_data: z.object({ details: z.string().optional() }).optional(),
                      })
                    )
                    .optional(),
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
  // Nomes das variáveis, na MESMA ordem de `parametros`. Quando presentes e
  // não-numéricos, o corpo é enviado no formato NOMEADO da Meta (parameter_name).
  nomesVariaveis: z.array(z.string()).optional(),
  // Cabeçalho de mídia — só usado quando o template aprovado na Meta tem um
  // header do tipo IMAGE/VIDEO/DOCUMENT configurado.
  midiaUrl: z.string().url().optional(),
  midiaTipo: midiaTipoEnum.optional(),
});

export type MidiaTipo = z.infer<typeof midiaTipoEnum>;

export type EnviarTextoInput = z.infer<typeof enviarTextoSchema>;
export type EnviarTemplateInput = z.infer<typeof enviarTemplateSchema>;
