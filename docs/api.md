# Referência da API do CRM

Base: `https://api-crm.nordenimoveis.com.br`
Autenticação: cabeçalho `Authorization: Bearer <token>` (obtido em `/auth/login`, válido por 12h).
Erros: `{ "error": "mensagem" }`; validação devolve também `details`.

Esta referência é a base para o painel (próxima etapa).

## Sessão

| Método | Rota | Quem | Descrição |
|---|---|---|---|
| POST | `/auth/login` | todos | `{ email, password }` → `{ token, user }`. Limite de 10 tentativas a cada 5 min |
| GET | `/auth/me` | logado | Usuário atual |

## Leads (Kanban)

| Método | Rota | Quem | Descrição |
|---|---|---|---|
| GET | `/leads` | logado | Lista para o Kanban. Filtros: `stage`, `temperature`, `source`, `brokerId` (gestor), `q`, `includeOld`, `limit`. Corretor recebe só os próprios |
| GET | `/leads/:id` | dono do lead ou gestor | Lead + régua (`cadence`) + linha do tempo (`events`) |
| POST | `/leads` | logado | Cadastro manual `{ name, phone?, email?, interest?, notes?, brokerId?, startCadence? }` |
| PATCH | `/leads/:id` | dono do lead ou gestor | Edição rápida: `stage`, `temperature`, `name`, `email`, `interest`, `notes`, `tags`, `lossReasonId`. Tirar o card de "Novo Lead" cancela a régua. Mover para uma etapa de papel `LOST` (Perdido) **exige** `lossReasonId`, grava `lostAt` e cancela a régua; sair de Perdido limpa o motivo |
| POST | `/leads/:id/transfer` | gestor | `{ brokerId }` |
| POST | `/leads/:id/accept-ai-temperature` | dono do lead ou gestor | Aplica a temperatura sugerida pela IA |

Etapas (`stage`): **agora são dados** (ver `/pipeline/stages`), não um enum fixo. O gestor cria, renomeia, reordena e exclui etapas. As etapas de sistema (`systemRole`) carregam comportamento e não podem ser excluídas: `NEW` (Novo Lead), `AWAITING` (Aguardando Resposta), `ACTIVE` (Em Atendimento), `WON` (Negócio Fechado), `COLD` (Lead Frio), `LOST` (Perdido). O lead perdido **permanece na base** (para campanhas futuras), só sai do fluxo ativo; carrega `lostReasonId` e `lostAt`.
Temperaturas: `NAO_AVALIADO`, `FRIO`, `MORNO`, `QUENTE`.
Origens: `META_ADS`, `INSTAGRAM`, `SITE`, `WHATSAPP_DIRETO`, `BASE_ANTIGA`, `MANUAL`.

## Funil e motivos de perda

| Método | Rota | Quem | Descrição |
|---|---|---|---|
| GET | `/pipeline/stages` | logado | Etapas do funil, em ordem (`id, key, label, position, systemRole, isSystem`) |
| POST | `/pipeline/stages` | gestor | `{ label }` — cria etapa (gera `key`, entra no fim) |
| PATCH | `/pipeline/stages/:id` | gestor | `{ label }` — renomeia (não muda a `key`) |
| POST | `/pipeline/stages/reorder` | gestor | `{ ids: [...] }` — nova ordem completa |
| DELETE | `/pipeline/stages/:id` | gestor | Exclui etapa não-sistema e **vazia** (409 se tiver leads; 400 se for de sistema) |
| GET | `/loss-reasons` | logado | Motivos de perda (`id, label, position, active`) |
| POST | `/loss-reasons` | gestor | `{ label }` |
| PATCH | `/loss-reasons/:id` | gestor | `{ label?, active? }` (desativar preserva o histórico) |
| DELETE | `/loss-reasons/:id` | gestor | Exclui se não estiver em uso (409 orienta desativar) |

## Chat embutido

| Método | Rota | Descrição |
|---|---|---|
| GET | `/leads/:id/messages?before=<id>` | Histórico paginado. Devolve `canSendFreeText` e `windowExpiresAt` (janela de 24h) |
| POST | `/leads/:id/messages` | `{ content }`. Responde **409** fora da janela de 24h. Move "Aguardando Resposta" → "Em Atendimento" |
| GET | `/leads/:id/templates` | Os 4 templates aprovados, com `preview` já preenchido para o lead (`[{ step, name, preview }]`) |
| POST | `/leads/:id/template` | `{ step }` (1–4) — envia template aprovado, **funciona fora da janela de 24h**. Cancela a régua e move para "Em Atendimento". Respeita `CADENCE_SEND_ENABLED` |
| POST | `/leads/:id/notes` | `{ content }` — nota interna, o cliente não vê |

Mensagem: `{ id, direction: 'in'|'out'|'system', private, text, at, senderName, status, attachments[] }`.

## Respostas rápidas (gatilho "/")

| Método | Rota | Descrição |
|---|---|---|
| GET | `/quick-replies` | Globais + pessoais do usuário |
| POST | `/quick-replies` | `{ shortcut, title, body, global? }` — `global` só para gestores |
| PATCH / DELETE | `/quick-replies/:id` | Dono da resposta (ou gestor, para globais) |
| POST | `/quick-replies/:id/render` | `{ leadId }` → `{ text }` com variáveis preenchidas |

Variáveis: `{{lead_name}}`, `{{lead_first_name}}`, `{{broker_name}}`, `{{broker_first_name}}`, `{{lead_interest}}`.

## Campanhas de disparo em massa (gestor)

Envio de um **template aprovado** para um público de leads. O público é
**congelado** na criação e o template é copiado (snapshot) — envio previsível e
auditável. Só templates (sem texto livre). Respeita horário comercial e
`CAMPAIGN_SEND_ENABLED` (false = simulado). O executor é chamado pelo n8n.

| Método | Rota | Descrição |
|---|---|---|
| GET / POST | `/campaign-templates` | Catálogo de templates (`{ name, preview, paramSources[], language?, category? }`) |
| PATCH / DELETE | `/campaign-templates/:id` | Editar/desativar/excluir template |
| POST | `/campaigns/preview-audience` | `{ stages?, temperatures?, sources?, brokerId?, includeOld? }` → `{ count }` (só leads com telefone) |
| GET | `/campaigns` | Lista com status e progresso (`total`, `sent`, `failed`) |
| GET | `/campaigns/:id` | Detalhe + `pending` |
| POST | `/campaigns` | `{ name, templateId, filters }` — cria RASCUNHO congelando o público |
| POST | `/campaigns/:id/launch` | `{ scheduledFor? }` — envia agora (ENVIANDO) ou agenda (AGENDADA) |
| POST | `/campaigns/:id/cancel` | Cancela a campanha |
| DELETE | `/campaigns/:id` | Exclui (não pode estar ENVIANDO) |
| POST | `/internal/campaigns/run` | `x-internal-key` — executor chamado pelo n8n |

Status da campanha: `RASCUNHO`, `AGENDADA`, `ENVIANDO`, `CONCLUIDA`, `CANCELADA`.

## Tempo real

`GET /events?token=<jwt>` — Server-Sent Events. Eventos: `lead.created`, `lead.updated`, `lead.assigned`, `message.created`, `ai.suggestion`. Cada um traz `leadId` e dados extras (ex.: `alert: "aguardando_resposta"`, `draftReply`). Corretor só recebe eventos dos próprios leads.

## Gestão

| Método | Rota | Descrição |
|---|---|---|
| GET | `/brokers` | Nomes dos usuários ativos (filtros e transferência) |
| GET / POST | `/users` | Gestor: listar e criar usuários |
| PATCH | `/users/:id` | Gestor: nome, papel, ativo, roleta (`inRotation`), senha, `chatwootAgentId`, `chatwootToken` |
| GET | `/reports/summary?days=30` | Gestor: funil, origens, desempenho por corretor, temperatura, saúde da régua |

## Integrações (não usadas pelo painel)

| Rota | Proteção | Origem |
|---|---|---|
| `POST /webhooks/chatwoot?token=` | `CHATWOOT_WEBHOOK_TOKEN` | Chatwoot (evento `message_created`) |
| `POST /webhooks/imobzi?token=` | `IMOBZI_WEBHOOK_TOKEN` | Formulário do site via Imobzi |
| `POST /internal/leads/ingest` | `x-internal-key` + só rede interna | n8n (Meta Ads) |
| `POST /internal/cadence/run` | idem | n8n (a cada 5 min) |
| `POST /internal/ai/result` | idem | n8n (Claude) |
