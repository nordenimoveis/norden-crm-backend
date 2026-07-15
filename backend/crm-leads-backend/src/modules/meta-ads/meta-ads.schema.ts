import { z } from 'zod';

// Estrutura enviada pelo Meta quando um novo lead entra (evento leadgen)
// Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/webhooks
export const metaWebhookPayloadSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id: z.string(), // page_id
      time: z.number().optional(),
      changes: z.array(
        z.object({
          field: z.literal('leadgen'),
          value: z.object({
            leadgen_id: z.string(),
            form_id: z.string(),
            page_id: z.string(),
            adgroup_id: z.string().optional(),
            ad_id: z.string().optional(),
            campaign_id: z.string().optional(),
            created_time: z.number().optional(),
          }),
        })
      ),
    })
  ),
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;

// Resposta da Graph API ao buscar os dados completos de um lead pelo leadgen_id
export const metaLeadFieldsSchema = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  field_data: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.string()),
    })
  ),
});

export type MetaLeadFields = z.infer<typeof metaLeadFieldsSchema>;
