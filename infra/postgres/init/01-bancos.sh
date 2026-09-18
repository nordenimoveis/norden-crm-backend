#!/bin/bash
# Executado só na primeira inicialização do volume do PostgreSQL.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres <<-SQL
  CREATE USER chatwoot WITH PASSWORD '${CHATWOOT_DB_PASSWORD}';
  CREATE USER n8n WITH PASSWORD '${N8N_DB_PASSWORD}';
  CREATE USER crm WITH PASSWORD '${CRM_DB_PASSWORD}';
  CREATE DATABASE chatwoot OWNER chatwoot;
  CREATE DATABASE n8n OWNER n8n;
  CREATE DATABASE crm OWNER crm;
SQL

# Extensões que o Chatwoot usa (exigem superusuário para criar)
psql -v ON_ERROR_STOP=1 --username postgres --dbname chatwoot <<-SQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
