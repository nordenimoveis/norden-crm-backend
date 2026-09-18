CREATE TABLE "loss_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"system_role" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
INSERT INTO "pipeline_stages" ("key","label","position","system_role","is_system") VALUES
	('NOVO_LEAD','Novo Lead',1,'NEW',true),
	('AGUARDANDO_RESPOSTA','Aguardando Resposta',2,'AWAITING',true),
	('EM_ATENDIMENTO','Em Atendimento',3,'ACTIVE',true),
	('VISITA_AGENDADA','Visita Agendada',4,NULL,false),
	('PROPOSTA','Proposta',5,NULL,false),
	('NEGOCIO_FECHADO','Negócio Fechado',6,'WON',true),
	('LEAD_FRIO','Lead Frio',7,'COLD',true),
	('PERDIDO','Perdido',8,'LOST',true);
--> statement-breakpoint
INSERT INTO "loss_reasons" ("label","position") VALUES
	('Comprou com concorrente',1),
	('Sem retorno / não respondeu',2),
	('Fora do perfil ou orçamento',3),
	('Desistiu da compra',4),
	('Apenas pesquisando',5),
	('Contato inválido',6);
--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "stage" SET DATA TYPE text USING "stage"::text;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "stage" SET DEFAULT 'NOVO_LEAD';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_pipeline_stages_key_fk" FOREIGN KEY ("stage") REFERENCES "public"."pipeline_stages"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_reason_id_loss_reasons_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "public"."loss_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."lead_stage";