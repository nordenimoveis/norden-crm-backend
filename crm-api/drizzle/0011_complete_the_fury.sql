ALTER TABLE "leads" ADD COLUMN "phone_key" text;--> statement-breakpoint
CREATE INDEX "leads_phone_key_idx" ON "leads" USING btree ("phone_key");--> statement-breakpoint
-- Backfill da chave canônica (resolve o 9º dígito dos celulares BR).
UPDATE "leads" SET "phone_key" = CASE
  WHEN "phone" IS NULL THEN NULL
  WHEN length("phone") = 13 AND left("phone", 2) = '55' AND substr("phone", 5, 1) = '9'
    THEN left("phone", 4) || substr("phone", 6)
  ELSE "phone"
END;
