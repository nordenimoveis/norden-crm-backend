CREATE TYPE "public"."inbox_status" AS ENUM('NOVO', 'ACOMPANHANDO', 'SEM_INTERESSE', 'QUALIFICADO');--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "in_funnel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "inbox_status" "inbox_status";--> statement-breakpoint
-- Backfill: todo lead que não é Base Antiga já faz parte do funil ativo.
UPDATE "leads" SET "in_funnel" = true WHERE "source" <> 'BASE_ANTIGA';
--> statement-breakpoint
-- Backfill: leads da Base Antiga que já responderam entram como "NOVO" na triagem.
UPDATE "leads" SET "inbox_status" = 'NOVO' WHERE "source" = 'BASE_ANTIGA' AND "last_inbound_at" IS NOT NULL AND "inbox_status" IS NULL;
