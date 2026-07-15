import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatória'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa ter pelo menos 16 caracteres'),

  // Imobzi — CRM legado com papel duplo: gateway dos novos leads do site (webhook)
  // e fonte da base antiga (importação em lote via API).
  // IMOBZI_WEBHOOK_TOKEN: valor que você define no campo "authorization" ao
  // cadastrar o webhook no painel do Imobzi — eles reenviam esse mesmo valor
  // no header `Authorization` de cada chamada, e é isso que autenticamos.
  // IMOBZI_API_TOKEN: sua "Secret Key" do Imobzi (Administrador > Integrações
  // e Automações > API Keys), enviada no header `X-Imobzi-Secret`.
  IMOBZI_WEBHOOK_TOKEN: z.string().min(8, 'IMOBZI_WEBHOOK_TOKEN precisa ter pelo menos 8 caracteres'),
  IMOBZI_API_BASE_URL: z.string().url().optional(),
  IMOBZI_API_TOKEN: z.string().optional(),

  // Meta Ads / WhatsApp Cloud API (usados nos módulos 3 e 4, já deixamos previsto aqui)
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_PAGE_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Trava anti-ban: teto de mensagens automatizadas (cadência) disparadas por dia.
  // Comece conservador e aumente conforme o número ganha reputação no WhatsApp.
  MAX_DAILY_MESSAGES: z.coerce.number().int().positive().default(100),

  // Pusher — tempo real do painel (Kanban + chat). Plano gratuito é suficiente
  // para o volume de uma imobiliária boutique.
  PUSHER_APP_ID: z.string().min(1, 'PUSHER_APP_ID é obrigatória'),
  PUSHER_KEY: z.string().min(1, 'PUSHER_KEY é obrigatória'),
  PUSHER_SECRET: z.string().min(1, 'PUSHER_SECRET é obrigatória'),
  PUSHER_CLUSTER: z.string().min(1, 'PUSHER_CLUSTER é obrigatória'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
