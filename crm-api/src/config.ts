import { z } from 'zod';

/**
 * Todas as variáveis de ambiente são validadas na inicialização.
 * Se faltar alguma obrigatória, o servidor não sobe (falha rápida e explícita).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  PUBLIC_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter pelo menos 32 caracteres'),
  /** Chave de 32 bytes em base64 para criptografar os tokens do Chatwoot de cada corretor. */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'ENCRYPTION_KEY precisa ser 32 bytes em base64 (openssl rand -base64 32)',
  }),
  /** Chave usada pelo n8n para chamar as rotas /internal. */
  INTERNAL_API_KEY: z.string().min(24),
  /** Tokens que protegem os webhooks públicos (vão na query string ?token=). */
  CHATWOOT_WEBHOOK_TOKEN: z.string().min(24),
  IMOBZI_WEBHOOK_TOKEN: z.string().min(24),

  CHATWOOT_BASE_URL: z.string().url(),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
  CHATWOOT_INBOX_ID: z.coerce.number().int().positive(),
  /** Token de um usuário ADMINISTRADOR do Chatwoot (usado pelo sistema, nunca exposto ao navegador). */
  CHATWOOT_ADMIN_TOKEN: z.string().min(1),

  /** Webhook do n8n que recebe as mensagens para análise do Claude. Vazio = camada de IA desligada. */
  N8N_AI_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),

  TIMEZONE: z.string().default('America/Sao_Paulo'),
  BUSINESS_START_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  BUSINESS_END_HOUR: z.coerce.number().int().min(1).max(24).default(19),

  /** Nomes dos templates aprovados na Meta, um por contato de WhatsApp da régua (5 contatos). */
  TEMPLATE_STEP_1: z.string().default('norden_boas_vindas'),
  TEMPLATE_STEP_2: z.string().default('norden_qualificacao'),
  TEMPLATE_STEP_3: z.string().default('norden_off_market'),
  TEMPLATE_STEP_4: z.string().default('norden_apoio'),
  TEMPLATE_STEP_5: z.string().default('norden_despedida'),
  TEMPLATE_LANGUAGE: z.string().default('pt_BR'),
  TEMPLATE_CATEGORY: z.string().default('MARKETING'),
  /** Quando false, a cadência só registra o que enviaria (útil para testes antes da aprovação dos templates). */
  CADENCE_SEND_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Personaliza a 1ª mensagem (boas-vindas) com o empreendimento do lead.
   * Ligue SÓ depois de aprovar um template de boas-vindas com 3 variáveis
   * ({{1}} cliente, {{2}} corretor, {{3}} empreendimento) e apontar TEMPLATE_STEP_1 para ele.
   */
  WELCOME_WITH_PRODUCT: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /** Texto usado no lugar do empreendimento quando o lead não tem produto identificado. */
  TEMPLATE_PRODUCT_FALLBACK: z.string().default('os empreendimentos em Jurerê'),
  /** Quando false, as campanhas de disparo em massa só simulam (não enviam de verdade). */
  CAMPAIGN_SEND_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /** Teto de disparos de campanha por execução do executor (n8n). */
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().positive().default(40),

  /**
   * Leads de formulário do Meta (Lead Ads). Segredo único usado como verify token (GET)
   * e como ?token= (POST) do webhook /webhooks/meta-leadgen. Vazio = recurso desligado.
   */
  META_LEADGEN_TOKEN: z.string().default(''),
  /** Token da Graph API (com leads_retrieval + acesso à página) para buscar os dados do lead. */
  META_GRAPH_TOKEN: z.string().default(''),
  /** Base da Graph API (configurável para testes). */
  META_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  /** Versão da Graph API usada na busca do lead. */
  META_GRAPH_VERSION: z.string().default('v21.0'),
  /** ID da Página do Facebook (para o coletor puxar os leads dos formulários). Vazio = coletor desligado. */
  META_PAGE_ID: z.string().default(''),
  /** Janela (min) de leads considerados "novos" pelo coletor — deve cobrir o intervalo do agendador. */
  META_POLL_LOOKBACK_MIN: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
