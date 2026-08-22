# Guia de instalação — CRM Omnichannel (WhatsApp + Instagram + Messenger + Comentários)

Este guia é para a pessoa técnica que vai **colocar o sistema no ar**. Ele cobre
o que precisa existir (banco, filas, contas Meta) e a ordem de configuração.

> Resumo: o CRM tem **3 processos** (API, worker de cadência e front-end),
> **1 banco Postgres**, **1 Redis** e integrações com **Meta** (WhatsApp,
> Instagram, Messenger) e **Imobzi**.

---

## 1. Pré-requisitos

- **Node.js 20+**
- **PostgreSQL 15+** com a extensão **`vector`** habilitada (usada pela IA/RAG e
  pelo match de imóveis). Em provedores gerenciados (Railway/Render/Neon/Supabase)
  a extensão costuma vir disponível — o `prisma db push` a habilita via schema.
- **Redis** (fila BullMQ da cadência e teto anti-ban).
- Contas/credenciais: **Meta Developers** (App + Página do Facebook + conta
  comercial do Instagram), **Pusher**, **Imobzi**, e opcionalmente **Anthropic**
  (IA), **Voyage** (embeddings) e **Cloudinary** (mídia de campanhas).

---

## 2. Backend (API + worker)

```bash
cd backend/crm-leads-backend
cp .env.example .env        # preencha os valores (ver seção 4)
npm install
npx prisma generate
npx prisma db push          # cria/atualiza as tabelas (inclui as novas: contatos_canais, comentarios_sociais)
npm run seed                # opcional: usuário admin + dados iniciais
```

Rodar em desenvolvimento (dois terminais):

```bash
npm run dev            # API em http://localhost:3333
npm run dev:worker     # worker da cadência (processa a fila do Redis)
```

Em produção:

```bash
npm run build
npm run start          # API
npm run start:worker   # worker (processo separado)
```

> **Importante:** a API e o **worker** são processos separados. Sem o worker, a
> cadência automática do WhatsApp e os disparos em massa não rodam. As respostas
> em tempo real (WhatsApp/Instagram/Messenger e comentários) funcionam só com a
> API no ar.

---

## 3. Front-end (Next.js)

```bash
cd frontend/norden-crm-frontend
cp .env.local.example .env.local   # preencha NEXT_PUBLIC_* (ver seção 4)
npm install
npm run dev            # http://localhost:3000
# produção:
npm run build && npm run start
```

---

## 4. Variáveis de ambiente

### Backend (`.env`)

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão do Postgres (com `vector`). |
| `REDIS_URL` | Fila da cadência / teto anti-ban. |
| `JWT_SECRET` | Segredo do login (troque por algo forte e único). |
| `IMOBZI_WEBHOOK_TOKEN` | Mesmo valor do campo *authorization* do webhook no Imobzi. |
| `IMOBZI_API_BASE_URL` / `IMOBZI_API_TOKEN` | API do Imobzi (Secret Key). |
| `META_APP_SECRET` | Valida a assinatura dos webhooks da Meta (WhatsApp/IG/Messenger). |
| `META_VERIFY_TOKEN` | Token de verificação do webhook (você inventa; usa igual nos 2 webhooks). |
| `META_PAGE_ACCESS_TOKEN` | Token da **Página do Facebook** — usado no WhatsApp, IG e Messenger. |
| `META_PAGE_ID` | ID da Página do Facebook (Messenger + comentários no FB). |
| `META_IG_ACCOUNT_ID` | ID da conta **comercial** do Instagram (DM + comentários IG). |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API. |
| `MAX_DAILY_MESSAGES` | Teto diário de mensagens automáticas do WhatsApp (comece baixo). |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | Tempo real (Kanban, chat, comentários). |
| `FRONTEND_URL` | URL do front em produção (restringe o CORS). |
| `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` | IA e embeddings (opcionais — sem eles o atendimento é 100% humano). |
| `CLOUDINARY_*` | Upload de mídia de campanhas (opcional). |

### Front-end (`.env.local`)

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL pública da API (ex.: `https://api.suaempresa.com`). |
| `NEXT_PUBLIC_PUSHER_KEY` | Mesma `PUSHER_KEY` do backend. |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Mesmo cluster (ex.: `us2`). |

---

## 5. Configuração na Meta (App de Desenvolvedor)

Tudo passa pelo **mesmo App da Meta**. São **dois webhooks** apontando para a
mesma API pública (`https://SUA_API`), com o **mesmo `META_VERIFY_TOKEN`**:

### 5.1 WhatsApp
- Produto **WhatsApp** → Configuração → Webhook:
  - **Callback URL:** `https://SUA_API/webhooks/whatsapp`
  - **Verify token:** `META_VERIFY_TOKEN`
  - **Campos:** `messages`.

### 5.2 Instagram Direct + Messenger + Comentários
- Produtos **Messenger** e **Instagram** → Webhooks:
  - **Callback URL:** `https://SUA_API/webhooks/meta-messaging`
  - **Verify token:** `META_VERIFY_TOKEN`
  - **Campos a assinar:**
    - Messenger: `messages`, `messaging_postbacks`, `feed` (comentários no FB).
    - Instagram: `messages`, `comments`.
- Vincule a **Página do Facebook** e a **conta comercial do Instagram** ao App e
  gere o **`META_PAGE_ACCESS_TOKEN`** (token de página de longa duração).
- Permissões necessárias no App: `pages_messaging`, `pages_manage_metadata`,
  `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`,
  `instagram_manage_comments` (e as equivalentes de WhatsApp já existentes).

> Onde achar os IDs: `META_PAGE_ID` = ID da Página do Facebook;
> `META_IG_ACCOUNT_ID` = ID da conta do Instagram vinculada à Página
> (disponível via Graph API `/{page-id}?fields=instagram_business_account`).

### 5.3 Imobzi
- No painel do Imobzi (**Administrador → Integrações → Webhooks**), cadastre o
  webhook de leads apontando para `https://SUA_API/webhooks/imobzi` e use, no
  campo *authorization*, o mesmo valor de `IMOBZI_WEBHOOK_TOKEN`.

---

## 6. Como testar

1. **Login** no front, com o usuário criado no `seed`.
2. **WhatsApp:** mande uma mensagem para o número conectado → deve aparecer em
   *Mensagens* com o selo 💬.
3. **Instagram/Messenger:** mande uma DM para a conta conectada → aparece em
   *Mensagens* com o selo do canal (📸 / 💠). Responda pelo chat.
4. **Comentários:** comente em um post conectado → aparece na tela *Comentários*
   → responda por ali (a resposta é publicada no post).
5. **IA (opcional):** ligue a IA no perfil de um lead e mande uma mensagem — a
   resposta automática sai pelo mesmo canal (WhatsApp, Instagram ou Messenger).

---

## 7. O que muda nesta versão (omnichannel)

- Tabelas novas: `contatos_canais`, `comentarios_sociais`; colunas novas em
  `mensagens` (`canal`, `external_id`, `midia_url`…) e `leads`
  (`canal_principal`, `telefone` agora **opcional**).
- Rota nova no front: **/comentarios**.
- A IA responde automaticamente em **WhatsApp, Instagram e Messenger**.
- A migração é **aditiva** — não apaga dados. Basta `prisma db push`.
