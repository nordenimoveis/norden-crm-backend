# Deploy do back-end no Railway

O back-end tem **dois processos** (API e worker) que rodam a partir do mesmo
código, mais **Postgres** e **Redis**. No Railway isso vira **um projeto com 4
serviços**. O `railway.json` já configura o serviço da **API**; o **worker** usa
o mesmo repositório, só com um comando de início diferente.

## Passo a passo

### 1. Criar o projeto e os bancos
1. Railway → **New Project**.
2. **+ New → Database → Add PostgreSQL** (deixe o nome padrão `Postgres`).
3. **+ New → Database → Add Redis** (deixe o nome padrão `Redis`).

> O Redis do Railway já vem com a política de memória correta para o BullMQ
> (`noeviction`) — não precisa mexer.

### 2. Serviço da API
1. **+ New → GitHub Repo →** selecione `norden-crm-backend`.
2. Nas **Settings** do serviço:
   - **Root Directory:** `backend/crm-leads-backend`  ← essencial (o app é aninhado).
   - O Railway detecta o `railway.json` (build + `prisma db push` + start + healthcheck).
3. Em **Variables**, adicione (as duas primeiras são referências aos bancos):
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL` = `${{Redis.REDIS_URL}}`
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = (um segredo forte e único)
   - `MAX_DAILY_MESSAGES` = `100`
   - `FRONTEND_URL` = URL do front na Vercel (ex.: `https://crm.suaempresa.com`)
   - `IMOBZI_WEBHOOK_TOKEN`, `IMOBZI_API_BASE_URL` (`https://api.imobzi.app/v1`), `IMOBZI_API_TOKEN`
   - `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_ACCOUNT_ID`
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
   - `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`
   - (opcionais) `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
4. Em **Settings → Networking**, clique em **Generate Domain** para ter a URL
   pública da API (é ela que vai no webhook da Meta e no front-end).

### 3. Serviço do Worker (mesmo repositório)
1. **+ New → GitHub Repo →** selecione o **mesmo** `norden-crm-backend`.
2. Nas **Settings** desse novo serviço:
   - **Root Directory:** `backend/crm-leads-backend`
   - **Deploy → Custom Start Command:** `npm run start:worker`
     (isso sobrepõe o start do `railway.json`, que é da API).
   - **Não** precisa de domínio (o worker não recebe requisições) nem de
     `prisma db push` (a API já aplica o schema).
3. Em **Variables**, use as **mesmas** do serviço da API. Dica: no Railway você
   pode usar **Shared Variables** do projeto, ou copiar as variáveis da API.
   No mínimo o worker precisa de: `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`,
   `MAX_DAILY_MESSAGES`, e os tokens de envio (`META_*`, `WHATSAPP_*`, `PUSHER_*`).

### 4. Ligar com o front-end
- Copie a URL pública da API (passo 2.4) e coloque em `NEXT_PUBLIC_API_URL` na
  Vercel.
- Copie a URL final da Vercel e coloque em `FRONTEND_URL` no Railway (libera o CORS).
- Configure os webhooks na Meta (ver `SETUP-OMNICHANNEL.md`):
  - `https://SUA_API/webhooks/whatsapp`
  - `https://SUA_API/webhooks/meta-messaging`

Pronto: API + worker no Railway, front na Vercel, bancos no Railway.
