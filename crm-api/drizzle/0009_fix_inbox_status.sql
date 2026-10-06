-- Corrige o backfill do 0008: leads da Base Antiga que já estavam marcados como
-- Perdido (ou já trazidos ao funil) tinham virado "NOVO" por engano na triagem.

-- Já trazidos ao funil (promovidos) => Qualificados.
UPDATE "leads"
SET "inbox_status" = 'QUALIFICADO'
WHERE "source" = 'BASE_ANTIGA' AND "in_funnel" = true AND "lost_at" IS NULL;

-- Já marcados como Perdido => Sem interesse (tem precedência sobre o resto).
UPDATE "leads"
SET "inbox_status" = 'SEM_INTERESSE'
WHERE "source" = 'BASE_ANTIGA' AND "lost_at" IS NOT NULL;
