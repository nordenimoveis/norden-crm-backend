# Norden CRM

Sistema interno da Norden Imóveis para gestão de leads (Meta Ads, Instagram, site/Imobzi) com atendimento e cadência via WhatsApp oficial.

```
Meta Ads / Instagram ─┐
Site → Imobzi ────────┼─► n8n ─► CRM API ◄──► Chatwoot ◄──► WhatsApp Cloud API
Base antiga (CSV) ────┘     │        ▲                 (só o dono acessa)
                            └► Claude (sugestões)      Corretores usam apenas o painel do CRM
```

**Princípios da arquitetura**

- O CRM é a fonte da verdade do lead e o único lugar que decide quem vê o quê. Corretores nunca acessam o Chatwoot.
- O Chatwoot é a camada de mensagens: conexão com a Meta, templates, mídias e histórico.
- O n8n agenda e integra (Meta Ads, Claude). A regra de negócio da régua mora no CRM, com o estado no banco.
- A IA nunca responde o cliente sozinha: gera resumo, temperatura sugerida e rascunho para o corretor revisar.

## O que está pronto nesta entrega

| Parte | Situação |
|---|---|
| Infraestrutura (Docker Compose, HTTPS, bancos, backup) | ✅ |
| API do CRM: login, papéis, isolamento por corretor | ✅ |
| Entrada de leads: Meta/Instagram (n8n), site (webhook do Imobzi), manual, base antiga (CSV) | ✅ |
| Roleta justa entre corretores | ✅ |
| Régua de 4 passos com horário comercial, reagendamento, pausa ao responder e "Lead Frio" | ✅ |
| Chat embutido (API): histórico, envio com a janela de 24h, notas internas | ✅ |
| Respostas rápidas globais e pessoais com variáveis | ✅ |
| Temperatura do lead + sugestão do Claude | ✅ |
| Transferência de leads, relatório para o dono, tempo real (SSE) | ✅ |
| Testes automatizados (23 cenários: isolamento, régua, funil, perda, campanhas) | ✅ |
| Funil editável + motivos de perda | ✅ |
| Campanhas de disparo em massa (template aprovado, público congelado) | ✅ |
| **Painel web (Kanban, chat, gestão, campanhas)** | ✅ |

## Estrutura

```
infra/        docker-compose.yml, Caddyfile, .env.example, scripts de segredos e backup
crm-api/      API em Node.js + TypeScript (Fastify, Drizzle ORM, PostgreSQL)
painel/       Painel web (Next.js) — Kanban, chat, gestão e campanhas
n8n/          4 workflows prontos para importar
docs/         templates do WhatsApp e referência da API
```

---

# Implantação passo a passo

Tempo estimado: 3 a 4 horas de trabalho, mais a espera de aprovação da Meta.

## 0. Antes de começar (pode levar dias — inicie já)

1. **Meta Business verificado** (business.facebook.com → Central de Segurança).
2. **Número para a API oficial.** Um número já em uso no app WhatsApp Business precisa ser migrado (ou usar o modo de coexistência, se disponível para a conta). Faça isso fora do horário comercial.
3. **App na Meta for Developers** com o produto WhatsApp: anote o *Phone Number ID*, o *WhatsApp Business Account ID* e gere um **token permanente** (usuário do sistema com permissões `whatsapp_business_messaging` e `whatsapp_business_management`).
4. **Enviar os 4 templates** de `docs/templates-whatsapp.md`.

## 1. VPS

Contrate uma VPS com **Ubuntu 24.04, 2 vCPU e 8 GB de RAM** (ex.: plano KVM 2 da Hostinger). Acesse por SSH e instale o Docker:

```bash
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. DNS (KingHost)

Crie quatro registros **A** apontando para o IP da VPS:

| Nome | Uso |
|---|---|
| `crm` | Painel (a equipe acessa) |
| `api-crm` | API do CRM |
| `atendimento` | Chatwoot (só o dono) |
| `automacao` | n8n |

## 3. Projeto e segredos

```bash
mkdir -p /opt && cd /opt
# envie a pasta do projeto para /opt/norden-crm (scp, git etc.)
cd /opt/norden-crm/infra
cp .env.example .env
./gerar-segredos.sh
nano .env   # confira domínios, e-mail, senha SMTP (Resend) e ANTHROPIC_API_KEY
```

A chave da Anthropic é criada em console.anthropic.com (API Keys). Defina um limite de gasto mensal no console.

## 4. Subir os serviços

```bash
docker compose up -d postgres redis
docker compose run --rm chatwoot-web bundle exec rails db:chatwoot_prepare
docker compose up -d --build
docker compose ps
```

Em 1 ou 2 minutos, `https://atendimento.nordenimoveis.com.br` e `https://automacao.nordenimoveis.com.br` abrem com HTTPS.

## 5. Configurar o Chatwoot

1. Acesse `https://atendimento...` e crie a conta do **dono** (primeiro acesso).
2. **Caixa de entrada** → Adicionar → WhatsApp → *WhatsApp Cloud*. Informe Phone Number ID, Business Account ID e o token permanente. O Chatwoot mostra uma **URL de webhook** e um **token de verificação**: cadastre-os no app da Meta (WhatsApp → Configuração → Webhook) e assine o campo `messages`.
3. Nas configurações dessa caixa: **desative a atribuição automática** (a roleta é do CRM) e clique em sincronizar templates.
4. **Etiquetas** (Configurações → Etiquetas): crie `atendimento-humano`, `base-antiga` e `lead-frio`.
5. **Integrações → Webhooks** → adicionar:
   `https://api-crm.nordenimoveis.com.br/webhooks/chatwoot?token=<CHATWOOT_WEBHOOK_TOKEN>`
   Evento: **Mensagem criada**.
6. Anote no `.env`:
   - `CHATWOOT_ACCOUNT_ID` e `CHATWOOT_INBOX_ID`: aparecem na URL (`/app/accounts/1/settings/inboxes/2`)
   - `CHATWOOT_ADMIN_TOKEN`: Perfil → Token de acesso
7. Aplique: `docker compose up -d crm-api`

## 6. Usuário dono no CRM

```bash
docker compose exec -e SEED_NAME="Seu Nome" -e SEED_EMAIL="voce@nordenimoveis.com.br" \
  -e SEED_PASSWORD="uma-senha-forte" crm-api node dist/scripts/seed-admin.js
```

## 7. Corretores

Para cada corretor:

1. No Chatwoot, **Agentes → Adicionar** com um e-mail do corretor. Aceite o convite você mesmo, defina uma senha que **só você** conhece, entre como esse agente uma vez e copie o **token de acesso** do perfil. Anote também o ID do agente (aparece na lista/URL).
2. Cadastre no CRM (até o painel ficar pronto, via terminal):

```bash
TOKEN=$(curl -s https://api-crm.nordenimoveis.com.br/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"voce@nordenimoveis.com.br","password":"uma-senha-forte"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

curl -s https://api-crm.nordenimoveis.com.br/users \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Nome do Corretor","email":"corretor@nordenimoveis.com.br","password":"senha-inicial-forte",
       "role":"CORRETOR","chatwootAgentId":3,"chatwootToken":"TOKEN_DO_AGENTE"}'
```

O token é guardado criptografado. É ele que faz a mensagem sair no nome do corretor.

## 8. n8n

1. Acesse `https://automacao...` e crie a conta de proprietário.
2. **Importe** os quatro arquivos de `n8n/` (menu ⋯ → Import from file).
3. **01 Executor da cadência**: ative.
4. **02 Assistente Claude**: ative. No `.env`, defina
   `N8N_AI_WEBHOOK_URL=http://n8n:5678/webhook/norden-ia` (rede interna) e rode `docker compose up -d crm-api`.
5. **03 Leads do Meta Ads** (opcional): esse workflow captura **um** formulário por vez (limite do n8n). Para pegar **todos** os formulários da página automaticamente, prefira o webhook do CRM (passo **8b** abaixo) e deixe este workflow desativado.
6. **04 Executor de campanhas**: ative (dispara os lotes das campanhas em massa, a cada 5 min, como a cadência).

### 8b. Leads de formulário do Meta (recomendado — pega todos os formulários)

Uma assinatura de página cobre **todos os formulários**, atuais e futuros — você não mexe ao criar/pausar campanha.

1. Gere um segredo e um token da Graph API e preencha no `.env`:
   ```bash
   # segredo do webhook (verify token + ?token=)
   echo "META_LEADGEN_TOKEN=$(openssl rand -hex 24)" >> .env
   ```
   - `META_GRAPH_TOKEN`: um token da Graph API com **`leads_retrieval`** + acesso à página (usuário do sistema com a Página como ativo, ou token de página de longa duração).
   - Rode `docker compose up -d crm-api`.
2. No app da Meta → produto **Webhooks** → objeto **Page** → **Editar assinatura**:
   - **Callback URL**: `https://api-crm.<seu-domínio>/webhooks/meta-leadgen?token=<META_LEADGEN_TOKEN>`
   - **Verify token**: o mesmo `META_LEADGEN_TOKEN`
   - **Verificar e salvar** → assine o campo **`leadgen`**.
3. Assine a **Página** ao app (produto Webhooks → Page → adicionar a página).
4. Teste em `developers.facebook.com/tools/lead-ads-testing` → o lead nasce no Kanban com origem `META_ADS`.

## 9. Imobzi (formulário do site)

No Imobzi, configure o webhook de novos leads para:

```
https://api-crm.nordenimoveis.com.br/webhooks/imobzi?token=<IMOBZI_WEBHOOK_TOKEN>
```

O mapeamento reconhece nomes comuns de campos (nome/name, telefone/celular/phone, email, código do imóvel). O payload original fica salvo na linha do tempo do lead: se algum campo vier vazio, confira ali o nome real e acrescente em `crm-api/src/lib/imobzi.ts`.

## 10. Base antiga

Exporte os contatos do Imobzi em CSV e importe (entram com a etiqueta "Base Antiga", sem roleta e sem cadência, e não aparecem no Kanban por padrão):

```bash
docker compose cp contatos.csv crm-api:/tmp/base.csv
docker compose exec crm-api node dist/scripts/import-imobzi.js /tmp/base.csv
```

## 11. Ligar a cadência

Com o sistema rodando, `CADENCE_SEND_ENABLED=false` executa a régua em **modo simulado**: tudo acontece (agendamento, passos, "Lead Frio"), mas nada é enviado, e a linha do tempo registra `cadence.simulated`. Use esse modo para validar.

Quando os 4 templates estiverem **aprovados**:

```bash
sed -i 's/^CADENCE_SEND_ENABLED=.*/CADENCE_SEND_ENABLED=true/' .env
docker compose up -d crm-api
```

Leads que entraram durante o modo simulado já tiveram passos marcados como feitos. Para não confundir, zere a base de testes antes de ativar ou comece com leads novos.

**Campanhas de disparo em massa.** No painel (`https://crm.nordenimoveis.com.br` → engrenagem → **Campanhas**), cadastre os templates aprovados na Meta e monte a campanha (escolhe o público com contagem ao vivo e envia agora ou agenda). O público é congelado no momento da criação. Como a cadência, `CAMPAIGN_SEND_ENABLED=false` **simula**. Para enviar de verdade (com os templates aprovados e o workflow **04** ativo no n8n):

```bash
sed -i 's/^CAMPAIGN_SEND_ENABLED=.*/CAMPAIGN_SEND_ENABLED=true/' .env
docker compose up -d crm-api
```

## 12. Backup

```bash
crontab -e
0 3 * * * cd /opt/norden-crm/infra && ./backup.sh >> backups/backup.log 2>&1
```

Copie a pasta `infra/backups` para fora da VPS (ex.: `rclone` para o Google Drive). Guarde também o `.env`: sem ele, os tokens criptografados não podem ser lidos.

---

# Testes de integração (roteiro manual)

Faça com um celular pessoal antes de liberar para a equipe.

1. **Site:** envie o formulário → lead aparece com corretor definido pela roleta.
2. **Meta:** use a Ferramenta de Teste de Leads da Meta → lead com origem `META_ADS`.
3. **Régua (modo real):** passo 1 chega em 1 a 3 minutos no horário comercial, com o nome do corretor.
4. **Fora do horário:** lead criado às 20h de sábado → passo 1 agendado para segunda às 9h.
5. **Resposta:** responda pelo celular → lead vai para "Aguardando Resposta", ganha "Atendimento Humano", o passo 2 é cancelado e, em ~30s, surge a nota da IA no Chatwoot.
6. **Isolamento:** o corretor B não consegue abrir o lead do corretor A (`403`).
7. **Janela de 24h:** tentar enviar texto livre para um lead que nunca respondeu → `409`.
8. **Número desconhecido:** mande mensagem de outro celular para a Norden → vira lead `WHATSAPP_DIRETO`, sem régua.

Acompanhe erros com `docker compose logs -f crm-api`.

# Desenvolvimento

```bash
cd crm-api
npm install
cp .env.example .env         # preencha
npm run dev
npm run typecheck
npm run db:generate          # após alterar src/db/schema.ts
TEST_DATABASE_URL=postgres://... npm test   # banco vazio já migrado
```

# Segurança

- Tokens do Chatwoot ficam só no servidor; os dos corretores são criptografados (AES-256-GCM).
- `/internal/*` é bloqueado no Caddy: só o n8n, pela rede interna do Docker, chega lá.
- Webhooks exigem token; login tem limite de tentativas; senhas com bcrypt.
- Custom roles do Chatwoot não são usados: o isolamento é garantido pelo CRM, e os corretores não têm login no Chatwoot.
- Atualize Chatwoot e n8n com calma: fixe versões no `.env`, leia o changelog e rode o roteiro acima depois.

# Custos mensais estimados (30–40 leads/mês)

| Item | Valor |
|---|---|
| VPS 8 GB | ~R$ 39 |
| Templates da régua (pior caso) | R$ 39–51 |
| Claude (Sonnet 5) | ~R$ 25–30 |
| Chatwoot Community, n8n, PostgreSQL | R$ 0 |
| **Total** | **~R$ 105–120** |
