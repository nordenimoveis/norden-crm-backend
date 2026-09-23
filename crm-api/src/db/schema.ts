import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/** DONO e ADMIN veem tudo; CORRETOR só vê os leads atribuídos a ele. */
export const userRole = pgEnum('user_role', ['DONO', 'ADMIN', 'CORRETOR']);

export const leadSource = pgEnum('lead_source', [
  'META_ADS',
  'INSTAGRAM',
  'SITE',
  'WHATSAPP_DIRETO',
  'BASE_ANTIGA',
  'MANUAL',
]);

// As etapas do funil agora são DADOS (tabela pipeline_stages) para o gestor
// criar, renomear, reordenar e excluir. leads.stage guarda a CHAVE da etapa.
// Etapas com system_role carregam comportamento (régua, "em atendimento",
// negócio fechado, lead frio, perdido) e não podem ser excluídas.

export const leadTemperature = pgEnum('lead_temperature', ['NAO_AVALIADO', 'FRIO', 'MORNO', 'QUENTE']);

export const cadenceStatus = pgEnum('cadence_status', ['PENDENTE', 'PROCESSANDO', 'ENVIADO', 'CANCELADO', 'FALHOU']);

/** Estado de uma tarefa do corretor (ex.: ligação sugerida pela régua). */
export const taskStatus = pgEnum('task_status', ['PENDENTE', 'FEITA', 'SEM_RESPOSTA', 'CANCELADA']);

/** Estado de uma campanha de disparo em massa. */
export const campaignStatus = pgEnum('campaign_status', [
  'RASCUNHO',
  'AGENDADA',
  'ENVIANDO',
  'CONCLUIDA',
  'CANCELADA',
]);

/** Estado do envio para cada destinatário de uma campanha. */
export const campaignRecipientStatus = pgEnum('campaign_recipient_status', [
  'PENDENTE',
  'PROCESSANDO',
  'ENVIADO',
  'FALHOU',
]);

/* ------------------------------------------------------------------ */
/* Tabelas                                                             */
/* ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('CORRETOR'),
  active: boolean('active').notNull().default(true),
  /** Participa da roleta de novos leads. */
  inRotation: boolean('in_rotation').notNull().default(true),
  lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
  /** ID do agente correspondente no Chatwoot (o corretor não faz login lá). */
  chatwootAgentId: integer('chatwoot_agent_id'),
  /** Token de acesso do agente no Chatwoot, criptografado (AES-256-GCM). */
  chatwootTokenEnc: text('chatwoot_token_enc'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Etapas do funil (Kanban), editáveis pelo gestor.
 * - `key`: identificador estável usado no código e em leads.stage (não muda ao renomear).
 * - `systemRole`: papel de sistema (NEW, AWAITING, ACTIVE, WON, COLD, LOST) — carrega
 *   comportamento (régua/perda). Etapas de sistema (`isSystem`) não podem ser excluídas.
 */
export const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  systemRole: text('system_role'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Motivos de perda (catálogo gerenciável pelo gestor). */
export const lossReasons = pgTable('loss_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Telefone só com dígitos, com DDI (ex.: 5548999998888). */
    phone: text('phone'),
    email: text('email'),
    source: leadSource('source').notNull(),
    /** Chave da etapa no funil (FK para pipeline_stages.key). */
    stage: text('stage')
      .notNull()
      .default('NOVO_LEAD')
      .references(() => pipelineStages.key, { onUpdate: 'cascade' }),
    temperature: leadTemperature('temperature').notNull().default('NAO_AVALIADO'),
    brokerId: uuid('broker_id').references(() => users.id, { onDelete: 'set null' }),
    /** Motivo da perda (quando o lead vai para uma etapa de papel LOST). */
    lostReasonId: uuid('lost_reason_id').references(() => lossReasons.id, { onDelete: 'set null' }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** ID do lead na origem (Meta leadgen_id, código do Imobzi etc.). */
    externalId: text('external_id'),
    campaign: text('campaign'),
    /** Imóvel ou produto de interesse informado na captação. */
    interest: text('interest'),
    notes: text('notes'),
    chatwootContactId: integer('chatwoot_contact_id'),
    chatwootConversationId: integer('chatwoot_conversation_id'),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    aiSummary: text('ai_summary'),
    aiSuggestedTemperature: leadTemperature('ai_suggested_temperature'),
    aiUpdatedAt: timestamp('ai_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leads_phone_unique').on(t.phone),
    uniqueIndex('leads_conversation_unique').on(t.chatwootConversationId),
    index('leads_broker_idx').on(t.brokerId),
    index('leads_stage_idx').on(t.stage),
    index('leads_source_external_idx').on(t.source, t.externalId),
  ],
);

export const cadenceSteps = pgTable(
  'cadence_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    step: integer('step').notNull(),
    status: cadenceStatus('status').notNull().default('PENDENTE'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    /** Quando o executor pegou o passo para envio (recupera travamentos). */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cadence_lead_step_unique').on(t.leadId, t.step),
    index('cadence_due_idx').on(t.status, t.scheduledFor),
  ],
);

/**
 * Tarefas do corretor ligadas a um lead. Hoje só o tipo CALL (ligação),
 * criada automaticamente pela régua quando o cliente não responde, para o
 * corretor executar (com a lista visual em /tarefas). Cancela junto com a
 * régua quando o cliente responde ou o lead sai de "Novo Lead".
 */
export const leadTasks = pgTable(
  'lead_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** Corretor responsável (dono do lead no momento da criação). */
    brokerId: uuid('broker_id').references(() => users.id, { onDelete: 'set null' }),
    /** Tipo da tarefa (por ora só 'CALL'). */
    type: text('type').notNull().default('CALL'),
    status: taskStatus('status').notNull().default('PENDENTE'),
    title: text('title').notNull(),
    /** Quando a tarefa deve ser feita (usada para ordenar a lista do dia). */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    /** Passo da régua que gerou a tarefa (auditoria). */
    cadenceStep: integer('cadence_step'),
    note: text('note'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: uuid('done_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lead_tasks_broker_status_idx').on(t.brokerId, t.status),
    index('lead_tasks_lead_idx').on(t.leadId),
  ],
);

/** Linha do tempo do lead (auditoria): quem fez o quê e quando. */
export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lead_events_lead_idx').on(t.leadId, t.createdAt)],
);

/** Respostas rápidas. ownerId nulo = template global (criado pelo admin). */
export const quickReplies = pgTable(
  'quick_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    shortcut: text('shortcut').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quick_replies_owner_idx').on(t.ownerId)],
);

/**
 * Catálogo de templates aprovados na Meta, usados nas campanhas de disparo.
 * `paramSources` mapeia cada variável ({{1}}, {{2}}…) para um token que é
 * renderizado por lead (ex.: '{{lead_first_name}}') ou um texto fixo.
 */
export const whatsappTemplates = pgTable('whatsapp_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Nome do template aprovado na Meta (ex.: norden_lancamento). */
  name: text('name').notNull(),
  language: text('language').notNull().default('pt_BR'),
  category: text('category').notNull().default('MARKETING'),
  /** Texto exibido no preview/histórico, com {{1}}, {{2}}… ou {{lead_first_name}}. */
  preview: text('preview').notNull(),
  paramSources: text('param_sources').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Campanha de disparo em massa. O público é CONGELADO na criação
 * (campaign_recipients) e o template é copiado (snapshot) para o disparo ficar
 * previsível/auditável, mesmo que o catálogo mude depois.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    templateName: text('template_name').notNull(),
    templatePreview: text('template_preview').notNull(),
    paramSources: text('param_sources').array().notNull().default(sql`'{}'::text[]`),
    status: campaignStatus('status').notNull().default('RASCUNHO'),
    /** Filtros usados para montar o público (referência/auditoria). */
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    total: integer('total').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_status_idx').on(t.status)],
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    status: campaignRecipientStatus('status').notNull().default('PENDENTE'),
    error: text('error'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_recipient_unique').on(t.campaignId, t.leadId),
    index('campaign_recipients_due_idx').on(t.campaignId, t.status),
  ],
);

export type User = typeof users.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type CadenceStep = typeof cadenceSteps.$inferSelect;
export type LeadTask = typeof leadTasks.$inferSelect;
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type LossReason = typeof lossReasons.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
/** A etapa é uma chave livre (definida em pipeline_stages). */
export type LeadStage = string;
export type LeadTemperature = (typeof leadTemperature.enumValues)[number];
export type LeadSource = (typeof leadSource.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
