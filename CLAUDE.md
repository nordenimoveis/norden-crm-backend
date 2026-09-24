# CLAUDE.md — Norden CRM

Contexto permanente para o Claude Code. Leia antes de qualquer tarefa. Responda ao usuário em **português do Brasil**.

## O negócio

- **Norden Imóveis**: imobiliária de **alto padrão** em Jurerê Internacional e região (Florianópolis/SC).
- Volume atual: **30 a 40 leads novos por mês**, vindos de Meta Ads, Instagram e do formulário do site.
- O dono também atende. Há alguns corretores.
- Tom de comunicação com clientes: **"Concierge"** — elegante, consultivo, sem pressão de vendas, frases curtas para WhatsApp, sem gírias, sem excesso de emoji. Nunca inventar preço, metragem ou disponibilidade.
- O site público (outro projeto) roda no Replit, com domínio `nordenimoveis.com.br` na KingHost e e-mail transacional pelo Resend (`send.nordenimoveis.com.br`). Não faz parte deste repositório.
- CRM legado: **Imobzi**. Papel duplo: fonte da base antiga (importação CSV) e gateway dos leads do site (envia webhook para este sistema).

## Decisões de arquitetura (já tomadas — não reabrir sem o usuário pedir)

- **Chatwoot "invisível"**: é só a camada de mensagens (WhatsApp Cloud API oficial, templates, mídias, histórico). **Corretores nunca fazem login no Chatwoot.** Só o dono acessa.
- **Todo controle de acesso fica no CRM.** Requisito firme: **um corretor não pode ver conversas nem leads de outro.** DONO e ADMIN veem tudo.
  - Motivo: permissões por agente no Chatwoot exigem plano pago e já tiveram falhas de segurança (busca ignorando restrições).
- Chatwoot Community Edition (gratuito), n8n auto-hospedado, tudo em **uma VPS de 8 GB** com Docker Compose e Caddy.
- **Número único** de WhatsApp da Norden, vários corretores atendendo pelo CRM. Cada corretor tem um agente correspondente no Chatwoot, cujo token fica **criptografado** no CRM para as mensagens saírem no nome dele.
- **n8n agenda e integra; a regra de negócio e o estado da régua ficam no banco do CRM.** Não usar nós "Wait" de vários dias no n8n.
- **IA (Claude)**: nunca responde o cliente sozinha. Gera resumo, temperatura sugerida e rascunho → nota privada no Chatwoot + sugestão no CRM para o corretor revisar. Modelo padrão: `claude-sonnet-5` (configurável).
- Tokens do Chatwoot **nunca** chegam ao navegador. Front conversa só com a API do CRM.
- **Orçamento**: a solução só vale se o custo mensal ficar **abaixo de R$ 199** (preço do BotConversa, alternativa descartada). Estimativa atual: ~R$ 105–120/mês. Evite adicionar serviços pagos sem avisar o custo.

## Regras de negócio

**Entrada e distribuição**
- Deduplicação por telefone (normalizado com DDI 55); sem telefone, por origem + ID externo.
- **Roleta round-robin** entre usuários ativos com `inRotation = true` (quem recebeu há mais tempo).
- Base antiga do Imobzi: etiqueta "Base Antiga", **sem roleta, sem cadência**, fora do Kanban por padrão.
- Mensagem de número desconhecido: vira lead `WHATSAPP_DIRETO`, entra na roleta, **sem cadência**.
- Lead em "Lead Frio" que volta por campanha: retorna para "Novo Lead" sem reiniciar a régua.

**Régua de cadência (5 contatos de WhatsApp, 1/dia, + 2 tarefas de ligação)** — 5 templates de marketing aprovados na Meta. Plano em `src/services/cadence.ts` (`STEP_PLAN`); passos de canal `CALL` criam tarefa em vez de enviar.
| Passo | Dia | Canal | Template |
|---|---|---|---|
| 1 Recepção | 1 (1–3 min após a entrada) | WhatsApp | `norden_boas_vindas` |
| 2 Qualificação suave | 2 | WhatsApp | `norden_qualificacao` |
| 3 Ligação (se não respondeu) | 2 | 📞 Tarefa | — |
| 4 Autoridade / off-market | 3 | WhatsApp | `norden_off_market` |
| 5 Apoio na decisão | 4 | WhatsApp | `norden_apoio` |
| 6 Ligação (se não respondeu) | 4 | 📞 Tarefa | — |
| 7 Despedida elegante | 5 → etapa "Lead Frio", tag "Lead Frio / Standby" | WhatsApp | `norden_despedida` |

- **Tarefas de ligação**: passos de canal `CALL` inserem uma tarefa `CALL` (`lead_tasks`) para o corretor dono do lead, listada em `/tarefas` (API `/tasks`). Concluída com "Falei" (`FEITA`) ou "Não atendeu" (`SEM_RESPOSTA`). Régua e tarefas pendentes cancelam juntas quando o cliente responde ou o lead sai de "Novo Lead" (`cancelPendingTasks` em `src/services/tasks.ts`).
- Variáveis dos templates: `{{1}}` primeiro nome do cliente, `{{2}}` primeiro nome do corretor.
- **1ª mensagem personalizada por empreendimento (opcional)**: com `WELCOME_WITH_PRODUCT=true` + `TEMPLATE_STEP_1` apontando para um template de 3 variáveis, o passo 1 injeta `{{3}}` = empreendimento (de `leads.interest`, capturado do **nome do formulário do Meta** via `cleanFormName`/`fetchFormName` em `src/lib/meta-leads.ts`, ou de um campo do form). Gerador único em `src/services/cadence.ts` (`buildStepMessage`/`renderStepMessage`), usado também pelo envio manual. Fallback: `TEMPLATE_PRODUCT_FALLBACK`.
- Horário comercial **estrito: seg–sáb, 09h–19h, America/Sao_Paulo. Domingo bloqueado.** Fora da janela → reagenda para o próximo horário válido.
- **Qualquer mensagem do cliente cancela a régua na hora**, aplica a tag "Atendimento Humano" e move o card para "Aguardando Resposta".
- Corretor mover o card para fora de "Novo Lead" ou enviar mensagem também cancela a régua.
- `CADENCE_SEND_ENABLED=false` = modo simulado (executa tudo, não envia). Só ligar após os templates aprovados.

**WhatsApp**
- Texto livre só dentro de **24h da última mensagem do cliente**; fora disso a API responde 409 e o painel deve oferecer apenas template.
- Enviar mensagem move "Aguardando Resposta"/"Novo Lead" → "Em Atendimento".

**Kanban / Funil editável** — as etapas agora são **dados** (`pipeline_stages`), não enum. O gestor cria, renomeia, reordena e exclui etapas (`/pipeline/stages`). `leads.stage` guarda a **chave** da etapa (FK para `pipeline_stages.key`).
- **Etapas de sistema** (`system_role`, `is_system=true`) carregam comportamento e **não podem ser excluídas** — só renomeadas/reordenadas. A **chave** delas é fixa (o código referencia por chave):
  - `NEW` → `NOVO_LEAD` (entrada; onde a régua começa)
  - `AWAITING` → `AGUARDANDO_RESPOSTA` (cliente respondeu)
  - `ACTIVE` → `EM_ATENDIMENTO` (após enviar mensagem)
  - `WON` → `NEGOCIO_FECHADO`
  - `COLD` → `LEAD_FRIO` (standby ao fim da régua; recuperável)
  - `LOST` → `PERDIDO` (perdido, com motivo)
- Etapas sem papel (ex.: `VISITA_AGENDADA`, `PROPOSTA`) são livres: criar/renomear/reordenar/excluir (excluir só se estiver vazia).
- Papéis de sistema em `src/services/pipeline.ts` (`STAGE_ROLE`). Ao tocar em régua/entrada/mensagem, **referencie pela chave fixa**, nunca pelo label (que o gestor pode mudar).

**Perda (Perdido)** — mover um lead para a etapa de papel `LOST` **exige `lossReasonId`** (catálogo `loss_reasons`, gerenciável em `/loss-reasons`), grava `lost_at` e **cancela a régua**. O lead perdido **permanece na base** (não some) — fica disponível para **campanhas em massa futuras**; só sai do fluxo ativo. Sair de "Perdido" limpa motivo/data e recupera o lead.

**Temperatura (lead scoring manual)**: `NAO_AVALIADO` (inicial), `FRIO`, `MORNO`, `QUENTE`. Visível no card, editável sem abrir o cadastro, filtros rápidos no topo do Kanban. A IA só sugere; o corretor aceita com um clique.

**Respostas rápidas**: globais (só gestores criam) e pessoais. Acionadas digitando `/` no chat. Variáveis: `{{lead_name}}`, `{{lead_first_name}}`, `{{broker_name}}`, `{{broker_first_name}}`, `{{lead_interest}}`.

**Papéis**: `DONO`, `ADMIN` (veem tudo, transferem leads, relatórios) e `CORRETOR` (só os próprios leads).

## Estrutura do repositório

```
infra/     docker-compose.yml, Caddyfile, .env.example, gerar-segredos.sh, backup.sh
crm-api/   API Node.js + TypeScript (Fastify 5, Drizzle ORM, PostgreSQL, Zod 4, Luxon)
painel/    Front-end Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui
n8n/       01 executor da cadência · 02 assistente Claude · 03 leads do Meta Ads
docs/      api.md (referência da API) · templates-whatsapp.md
```

Arquivos centrais da API:
- `src/services/access.ts` — regra de isolamento (`assertLeadAccess`, `leadScope`). **Toda rota nova que toca lead precisa passar por aqui.**
- `src/services/cadence.ts` — régua (usa `FOR UPDATE SKIP LOCKED`); `TEMPLATE_PREVIEWS` deve espelhar os textos aprovados.
- `src/services/incoming.ts` — webhook do Chatwoot (resposta do cliente).
- `src/services/leads.ts` — porta de entrada única de leads.
- `src/services/chatwoot.ts` — cliente da API do Chatwoot.
- `src/lib/imobzi.ts` — mapeamento tolerante do webhook do Imobzi.
- `src/lib/meta-leads.ts` + `/webhooks/meta-leadgen` (em `src/routes/webhooks.ts`) — leads de formulário do Meta (Lead Ads). **Uma assinatura `leadgen` da Página cobre todos os formulários** (não precisa mexer ao criar/pausar campanha). Verificação por `META_LEADGEN_TOKEN`; busca o lead na Graph API com `META_GRAPH_TOKEN` (**Page Access Token** com `leads_retrieval`); cria com origem `META_ADS`. Captura o empreendimento do nome do formulário.
- **Coletor de leads do Meta** (`src/services/meta-poll.ts` + `POST /internal/meta/poll`): puxa os leads novos dos formulários da Página via Graph API (não depende do webhook da Meta, que exige App Review/Advanced Access). Liga com `META_PAGE_ID`; só considera leads dos últimos `META_POLL_LOOKBACK_MIN` min (dedup por telefone). Agendado a cada ~5 min (n8n ou cron). É o caminho **confiável** de entrada dos leads do Meta; o webhook fica como complemento.

## Comandos

```bash
cd crm-api
npm install
npm run dev                 # precisa de .env (ver .env.example)
npm run typecheck
npm run build
npm run db:generate         # após alterar src/db/schema.ts (gera SQL em drizzle/)
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/crm_test npm test
```

```bash
cd painel
npm install
cp .env.example .env.local  # defina CRM_API_URL=http://localhost:3333
npm run dev                 # http://localhost:3000
npm run typecheck
npm run build               # saída "standalone" para o Docker
```

O teste de integração exige um banco **vazio e já migrado** (`DATABASE_URL=... node dist/scripts/migrate.js` após o build). Ele sobe um Chatwoot simulado. Os 18 cenários devem passar antes de qualquer commit.

## Convenções e armadilhas conhecidas

- ESM com `module: NodeNext`: **imports relativos terminam em `.js`** (vale para a API; o painel usa `moduleResolution: bundler`, sem sufixo).
- TypeScript 7 (instalado via npm) na API. Mantenha `strict`.
- **Drizzle + postgres-js: não passe `Date` dentro de `sql\`...\``** — quebra a consulta. Use operadores (`lt`, `lte`, `gte`) com a coluna.
- Datas da régua usam o `now` recebido pela função (determinismo nos testes).
- Validação de entrada sempre com Zod; erros de negócio com `HttpError`.
- Nunca devolver `passwordHash` ou `chatwootTokenEnc` em respostas.
- Mensagens de erro e comentários em português.
- Não commitar `.env`. Sem o `.env` de produção, os tokens criptografados não podem ser lidos.
- **CORS da API**: a variável real é `CORS_ORIGINS` (em `crm-api/src/config.ts`), mapeada de `CRM_CORS_ORIGINS` no compose. O painel fala com a API **pela rede interna do Docker** (`CRM_API_URL=http://crm-api:3333`), então **o CORS não é necessário para o painel**.

## Rumo do projeto (decisão do usuário)

- **Arquitetura escolhida: esta (Chatwoot + Drizzle + VPS)** — não a do sistema antigo (Prisma/Meta-direto no Railway/Vercel). O painel novo é o front desta arquitetura.
- **Sem Instagram DM/Messenger/comentários** aqui → **o vídeo/App Review da Meta não é mais necessário** (ele era das permissões de Login do IG/Messenger). Para WhatsApp, continua a conexão do app/WABA, a verificação da empresa e a aprovação de templates — nada disso depende do vídeo.
- **Campanhas de disparo em massa**: portadas para esta arquitetura (o sistema antigo tinha; a base nova não tinha). Ver `src/services/campaigns.ts` e `docs/api.md`. Público congelado, só template aprovado, horário comercial, `CAMPAIGN_SEND_ENABLED`, executor via n8n (`/internal/campaigns/run`).

## Pendências para validar no ambiente real

1. Formato de `template_params` no envio de templates pelo Chatwoot (usa o formato numerado `{"1": ..., "2": ...}` do Chatwoot 4.x).
2. Nomes reais dos campos no webhook do Imobzi (o payload bruto fica na linha do tempo do lead).
3. Importação do gatilho *Facebook Lead Ads* no n8n.
4. Roteiro de 8 testes manuais no README.

## Status

- ✅ Infra, API completa, workflows do n8n, documentação e testes (18 cenários passando).
- 🏗️ **Painel (front-end)**: em construção por blocos. **Blocos 1 e 2 concluídos** (fundação/sessão/proxy e o Kanban). Ver abaixo.

## Painel (front-end)

### Stack (confirmada com o usuário)

- **Next.js 15 (App Router) + React 19 + TypeScript**, na pasta `painel/`, na **raiz** de `crm.nordenimoveis.com.br` (sem `basePath`).
- **Tailwind + shadcn/ui** com **tema próprio** (paleta sóbria "papel + tinta" com acento discreto de latão; tipografia Inter no corpo e Fraunces nos títulos). **Não usar o tema padrão** do shadcn. Tokens em `painel/app/globals.css` e `painel/tailwind.config.ts`.
- **TanStack Query** (dados do servidor), **@dnd-kit** (arrastar cards do Kanban), **React Hook Form + Zod** (formulários), **EventSource** nativo (tempo real).
- Servido pelo Caddy; contêiner `painel` no `infra/docker-compose.yml` (build `output: 'standalone'`).

### Sessão e segurança (decisões firmes)

- **JWT em cookie `httpOnly`** (`norden_session`): `secure` (só em produção/HTTPS), `sameSite=lax`, `path=/`, duração **12h**. O token **nunca** chega ao JavaScript do navegador.
- **Proxy genérico** `app/api/[...path]/route.ts`: lê o cookie e repassa à API com `Authorization: Bearer`. **Allowlist** de rotas: `auth/me`, `leads`, `quick-replies`, `users`, `brokers`, `reports`. **Bloqueia** `internal/*`, `webhooks/*` e `auth/login` (login é feito por `app/api/session`). Configuração em `painel/lib/config.ts`.
- **`app/api/session/route.ts`**: `POST` faz login na API pelo servidor e grava o cookie; `DELETE` faz logout.
- **SSE**: `app/api/events/route.ts` com `runtime='nodejs'` e `dynamic='force-dynamic'`; chama `/events?token=` no servidor e devolve o `body` em streaming, com `Cache-Control: no-cache` e `X-Accel-Buffering: no`. No navegador use `new EventSource('/api/events')`.
- **Anti-CSRF**: nas requisições que alteram dados, o proxy confere que o cabeçalho `Origin` bate com o host (`painel/lib/server/csrf.ts`).
- **Ao receber 401** (token expirado/inválido): o proxy limpa o cookie e o cliente redireciona para o login.
- **`middleware.ts`** só verifica se o cookie existe. Os **papéis** vêm de `/auth/me` e servem só para a interface — **a API continua sendo quem garante as permissões**.

### Especificação de telas

- **Login** (JWT de `/auth/login`, 12h).
- **Kanban** com as 7 colunas, arrastar entre colunas (`PATCH /leads/:id` com `stage`) via **@dnd-kit**, **filtros rápidos por temperatura no topo**, busca, filtro por corretor (só gestores). Base Antiga fora por padrão.
- **Card**: nome, origem, temperatura editável no próprio card, corretor, e **alerta visual destacado** quando a etapa for "Aguardando Resposta".
- **Painel do lead**: abre **sobre o Kanban via `?lead=<id>`** (não é rota separada) — dados do lead, linha do tempo, régua (`cadence`), sugestão da IA (resumo, temperatura com "aceitar", rascunho com "usar") e o **chat estilo WhatsApp Web**. A **transferência** (só gestores) fica aqui como ação principal; a tela de gestão também mantém.
- **Chat**: histórico paginado, envio de texto, notas internas, **respostas rápidas ao digitar `/`** (renderizadas via `/quick-replies/:id/render`), bloqueio de texto livre fora da janela de 24h com aviso claro.
- **Telas de gestor**: usuários (criar, ativar, roleta, token do Chatwoot), transferência de leads, relatório (`/reports/summary`), respostas rápidas globais.
- Referência completa dos endpoints: `docs/api.md`.

### Mobile (corretores usam muito pelo celular)

- **Kanban**: layout móvel próprio (colunas em abas ou rolagem horizontal), não só encolher o desktop.
- **Chat**: ocupa a tela inteira no celular.

### Endpoint a criar na API (antes do Bloco 4 — chat)

- **`POST /leads/:id/template`**: envio manual de template **fora da janela de 24h**. Mesma regra de acesso (`assertLeadAccess`), com **testes** e **registro na linha do tempo**. (Ainda não existe na API.)

### Ordem de construção (blocos pequenos, validar cada um com o usuário)

1. ✅ **Fundação**: scaffold `painel/`, Tailwind + shadcn + tema próprio, `apiClient`, tipos, login com cookie httpOnly, proxy + SSE + CSRF, middleware, Dockerfile + serviço no compose + Caddyfile.
2. ✅ **Kanban**: board dinâmico (colunas vêm de `/pipeline/stages`), card (nome, origem, temperatura editável no card, corretor, alerta "Aguardando Resposta", motivo na coluna Perdido), filtros (temperatura, busca, corretor p/ gestor, Base Antiga), arrastar com **@dnd-kit** → `PATCH /leads/:id { stage }` com atualização otimista (`hooks/use-leads.ts`). Arrastar para "Perdido" abre diálogo de motivo. Mobile com rolagem horizontal + snap. **Falta:** clicar no card abrir o painel do lead (Bloco 3).
2b. ✅ **Funil editável + motivos de perda**: `/configuracoes/funil` (criar/renomear/reordenar/excluir; etapas de sistema travadas) e `/configuracoes/motivos` (CRUD, desativar). Só gestores (guard em `app/(app)/configuracoes/layout.tsx` + API). Atalho na engrenagem da topbar.
3. ✅ **Painel do lead** (`?lead=<id>`, gaveta lateral — `components/lead-panel/`, full-screen no mobile, abas **Resumo/Conversa**): dados, sugestão da IA (resumo + aceitar temperatura), régua, linha do tempo, seletor de etapa, transferência (gestor) e **marcar como perdido com motivo**. Abre pelo clique no card (com guarda anti-arraste).
4. ✅ **Chat (aba Conversa)** — `components/lead-panel/chat/`: histórico paginado (bolhas in/out/system + notas), compositor com **Mensagem/Nota interna**, **`/` respostas rápidas** (renderizadas via `/quick-replies/:id/render`), **bloqueio fora da janela de 24h** com aviso e **seletor de template** (`POST /leads/:id/template`), e **"usar rascunho da IA"** (chega por SSE). Nota interna funciona mesmo fora da janela.
5. ✅ **Tempo real (SSE)** — `components/realtime-provider.tsx` ouve `/api/events` e invalida as consultas (Kanban, painel, chat ao vivo); guarda o rascunho da IA por lead.
4. **Chat estilo WhatsApp Web**: histórico, envio, notas, `/` respostas rápidas, janela de 24h, template fora da janela.
5. **Tempo real** (SSE) ligando tudo.
6. ✅ **Telas de gestor** (`/configuracoes/*`, aba na engrenagem — só DONO/ADMIN): funil, motivos de perda, **usuários** (criar, ativar/desativar, roleta on/off, papel, senha, agente+token do Chatwoot), **relatório** (`/reports/summary`: KPIs, funil, origens, temperatura, desempenho por corretor, saúde da régua; período 7/30/90 dias) e **campanhas** (`components/gestao/campaigns-view.tsx`): catálogo de templates + compositor (escolher template, filtrar público com contagem ao vivo, enviar/agendar) + lista com progresso. e **respostas rápidas** (`/configuracoes/respostas`: globais e pessoais, com variáveis) — também acionadas pelo `/` no chat.

Visual: sóbrio e elegante, coerente com alto padrão; clean, com fontes discretas.
