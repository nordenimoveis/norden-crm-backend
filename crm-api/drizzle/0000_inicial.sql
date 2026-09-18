CREATE TYPE "public"."cadence_status" AS ENUM('PENDENTE', 'PROCESSANDO', 'ENVIADO', 'CANCELADO', 'FALHOU');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('META_ADS', 'INSTAGRAM', 'SITE', 'WHATSAPP_DIRETO', 'BASE_ANTIGA', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('NOVO_LEAD', 'AGUARDANDO_RESPOSTA', 'EM_ATENDIMENTO', 'VISITA_AGENDADA', 'PROPOSTA', 'NEGOCIO_FECHADO', 'LEAD_FRIO');--> statement-breakpoint
CREATE TYPE "public"."lead_temperature" AS ENUM('NAO_AVALIADO', 'FRIO', 'MORNO', 'QUENTE');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('DONO', 'ADMIN', 'CORRETOR');--> statement-breakpoint
CREATE TABLE "cadence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"status" "cadence_status" DEFAULT 'PENDENTE' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"source" "lead_source" NOT NULL,
	"stage" "lead_stage" DEFAULT 'NOVO_LEAD' NOT NULL,
	"temperature" "lead_temperature" DEFAULT 'NAO_AVALIADO' NOT NULL,
	"broker_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"external_id" text,
	"campaign" text,
	"interest" text,
	"notes" text,
	"chatwoot_contact_id" integer,
	"chatwoot_conversation_id" integer,
	"last_inbound_at" timestamp with time zone,
	"ai_summary" text,
	"ai_suggested_temperature" "lead_temperature",
	"ai_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"shortcut" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'CORRETOR' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"in_rotation" boolean DEFAULT true NOT NULL,
	"last_assigned_at" timestamp with time zone,
	"chatwoot_agent_id" integer,
	"chatwoot_token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cadence_steps" ADD CONSTRAINT "cadence_steps_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_broker_id_users_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cadence_lead_step_unique" ON "cadence_steps" USING btree ("lead_id","step");--> statement-breakpoint
CREATE INDEX "cadence_due_idx" ON "cadence_steps" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_phone_unique" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_conversation_unique" ON "leads" USING btree ("chatwoot_conversation_id");--> statement-breakpoint
CREATE INDEX "leads_broker_idx" ON "leads" USING btree ("broker_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "leads_source_external_idx" ON "leads" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "quick_replies_owner_idx" ON "quick_replies" USING btree ("owner_id");