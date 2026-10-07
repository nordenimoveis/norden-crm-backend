-- Corrige leads de origem ativa (Meta/site/WhatsApp/manual) que foram criados
-- com in_funnel=false por um bug no ingestLead e ficaram invisíveis no Kanban.
UPDATE "leads" SET "in_funnel" = true WHERE "source" <> 'BASE_ANTIGA' AND "in_funnel" = false;
