# CRM Leads WhatsApp — Backend (Módulo 2)

Backend do CRM interno para gestão de leads de campanhas Meta Ads, com motor de cadência via WhatsApp.

## Stack

- Node.js + TypeScript
- Fastify (API REST)
- Prisma + PostgreSQL
- BullMQ + Redis (fila de cadência)

## Estrutura de pastas

```
src/
├── config/           # variáveis de ambiente validadas (zod)
├── modules/          # um módulo por domínio (leads, usuarios, cadencias...)
│   └── leads/
│       ├── leads.routes.ts    # camada HTTP (Fastify)
│       ├── leads.service.ts   # regras de negócio
│       └── leads.schema.ts    # validação de entrada (zod)
├── plugins/          # plugins do Fastify (prisma, auth)
├── queues/           # definição das filas BullMQ
├── workers/          # processos de worker (rodam separados da API)
├── lib/              # conexões compartilhadas (redis)
├── app.ts            # monta a instância Fastify
└── server.ts          # entrypoint HTTP

prisma/
├── schema.prisma     # schema completo do banco
└── seed.ts           # dados iniciais (usuário admin + cadência exemplo)
```

## Padrão para novos módulos

Ao construir `usuarios`, `cadencias`, `campanhas`, `imoveis`, siga o mesmo padrão do módulo `leads`:
1. `*.schema.ts` — validação com zod
2. `*.service.ts` — lógica de negócio, recebe `PrismaClient` via construtor
3. `*.routes.ts` — só camada HTTP, chama o service
4. Registrar as rotas em `src/app.ts`

## Como rodar localmente

```bash
cp .env.example .env
# preencha DATABASE_URL e REDIS_URL (local via Docker ou instância gerenciada)

npm install
npm run prisma:migrate   # cria as tabelas
npm run seed             # cria usuário gestor e cadência de exemplo

npm run dev               # sobe a API em http://localhost:3333
npm run dev:worker        # em outro terminal: sobe o worker de cadência
```

## Deploy (Railway/Render)

Suba dois serviços a partir do mesmo repositório:
- **web**: `npm run build && npm run start`
- **worker**: `npm run build && npm run start:worker`

Ambos compartilham as mesmas variáveis de ambiente (`DATABASE_URL`, `REDIS_URL`).

## Módulos implementados

- **usuarios**: login (`POST /api/auth/login`), CRUD de usuários, papéis (gestor/corretor/admin)
- **leads**: CRUD, Kanban (`PATCH /leads/:id/status`), transferência (`PATCH /leads/:id/atribuir`)
- **meta-ads**: webhook do Meta Lead Ads (`GET/POST /webhooks/meta`) — valida assinatura, busca dados do lead na Graph API e cria o lead automaticamente
- **imobzi**: webhook ativo de novos leads do site + importação passiva da base legada (ver seção própria abaixo)
- **whatsapp**: motor de envio/recebimento via WhatsApp Cloud API (`GET/POST /webhooks/whatsapp`), plugado ao worker de cadência
- **realtime**: autenticação de canais privados do Pusher

### Integração com o Imobzi (papel duplo)

O Imobzi (CRM legado da imobiliária) tem duas funções na arquitetura, com regras de negócio
**opostas** — importante não confundir uma com a outra:

| | Rota 1 — Webhook (Ativa) | Rota 2 — Importação (Passiva) |
|---|---|---|
| Endpoint | `POST /webhooks/imobzi/novo-lead` | `POST /api/imobzi/importar-legado` ou `npm run sync:imobzi` |
| Quando roda | Toda vez que um lead novo entra pelo site | Sob demanda / em lote, para a base antiga |
| Origem gravada | `site_imobzi` | `legado_imobzi` ("Base Antiga") |
| Passa por Round-Robin? | **Sim** | **Não, nunca** |
| Dispara cadência do WhatsApp? | **Sim, imediatamente (Passo 1)** | **Não, sob nenhuma hipótese** |
| Deduplicação | por `imobziId` (idempotente a reenvios de webhook) | por `imobziId` |

O código que impõe essa diferença está no `LeadsService`: `criarDeImobziWebhook()` chama o
mesmo fluxo ativo usado pelo Meta Ads (`criarLeadEIniciarFluxoAtivo`), enquanto
`importarLeadLegado()` é um método **deliberadamente mais simples**, que só grava o registro —
ele não tem nenhuma chamada para round-robin ou cadência, então não há como o comportamento
"vazar" entre os dois fluxos.

### Detalhes confirmados a partir do OpenAPI oficial do Imobzi

- **Base URL**: `https://api.imobzi.app/v1`
- **Autenticação da API deles**: header `X-Imobzi-Secret: <sua secret key>` (gerada em
  Administrador > Integrações e Automações > API Keys). Isso vai em `IMOBZI_API_TOKEN`.
- **Autenticação do webhook (inversa)**: ao cadastrar o webhook no painel do Imobzi
  (Administrador > Integrações > Webhooks) ou via `POST /v1/webhooks` da API deles, você define
  um valor no campo `authorization` — o Imobzi reenvia **esse mesmo valor** no header
  `Authorization` de toda chamada ao nosso endpoint. Isso vai em `IMOBZI_WEBHOOK_TOKEN`, e é o
  que `imobzi.routes.ts` compara em `POST /webhooks/imobzi/novo-lead`.
- **Evento a assinar**: `lead_created`.
- **Payload do webhook**: o registro completo do contato (schema `ContactFieldsSchema` deles),
  incluindo `db_id` (identificador único — vira nosso `imobziId`), `name`/`fullname`, `email`, e
  `cellphone` como **objeto aninhado** (`{ number, country_code, type }`), não uma string simples.
  Ver `imobzi.schema.ts` → `extrairTelefone()` para a montagem do telefone final.
- **Importação em lote**: `GET /v1/contacts?contact_type=lead&cursor=...` — **paginação por
  cursor**, não por número de página. A resposta traz `{ contacts: [...], cursor }`; quando
  `cursor` vem vazio/nulo, acabou a lista. Já implementado em `ImobziService.sincronizarBaseLegada()`.

### Importação em lote

Para "milhares de clientes", prefira `npm run sync:imobzi` (script de linha de comando, sem o
limite de tempo de uma requisição HTTP) em vez do endpoint `POST /api/imobzi/importar-legado`.

### Motor de WhatsApp e Cadência (Fase 4 — tom Concierge)

- `WhatsappService.enviarTemplate` / `enviarTexto` — chamam a Cloud API e registram a mensagem na tabela `mensagens`.
- Webhook `/webhooks/whatsapp` recebe mensagens novas do lead e atualizações de status (enviada/entregue/lida/falhou).

Regras de negócio implementadas:

1. **Horário comercial estrito (09h-19h)** — `src/utils/horario-comercial.ts`. Qualquer disparo
   calculado para cair fora da janela é automaticamente reagendado para as 09h00 do próximo dia útil.
2. **Dias úteis + sábado, domingo bloqueado** — mesma função, considera o fuso de Brasília
   (offset fixo -03:00, sem horário de verão desde 2019).
3. **Gatilho de Interrupção Absoluta** — qualquer mensagem do lead (texto, áudio, imagem — o tipo
   não importa) faz o `WhatsappService` chamar `cancelarJobAgendado()`, que **remove fisicamente
   o job da fila no Redis** (não é só uma pausa lógica no banco), cancela a execução
   (`status = 'cancelada'`) e marca `lead.atendimentoHumano = true` + `lead.status = 'respondeu'`
   — a flag que o painel Kanban vai usar para destacar o card.
4. **Régua de 4 passos** (`prisma/seed.ts`, cadência marcada como `padrao: true`):
   - Passo 1 — Recepção Imediata: jitter aleatório de 1-3 min (`calcularDelayBaseMs`), simula tempo humano.
   - Passo 2 — Qualificação Suave: 24h após o Passo 1.
   - Passo 3 — Autoridade/Off-Market: 3 dias após o Passo 2.
   - Passo 4 — Despedida Elegante: 7 dias após o Passo 3. Ao concluir, `lead.status = 'frio_standby'`.

Todo lead novo (Meta Ads/Instagram ou site via webhook do Imobzi) entra automaticamente na cadência `padrao`
assim que é criado — a chamada acontece dentro do `LeadsService`, via
`CadenciasService.iniciarCadenciaParaLead()`.

### Configurando o webhook do WhatsApp no Meta

Mesmo processo do Meta Ads: URL `https://seu-dominio.com/webhooks/whatsapp`, mesmo `META_VERIFY_TOKEN`
e mesmo `META_APP_SECRET` (é o mesmo App do Meta por trás dos dois produtos).

### Pendências conhecidas antes de produção

- Os `metaTemplateName` no seed são placeholders — precisam ser os nomes reais dos templates
  depois de aprovados na Meta Business Suite, e `aprovadoMeta` precisa virar `true`.
- Ainda não há rota para gerenciar cadências/templates pelo painel (fica para a Fase 5 ou 6).

### Trava Anti-Ban — Limite Diário de Disparos (`src/lib/limite-diario.ts`)

Implementa um "balde de tokens" diário no Redis: cada dia tem uma chave própria
(`whatsapp:envios:YYYY-MM-DD`) com um contador de 0 até `MAX_DAILY_MESSAGES` (env, padrão 100).

- **Reserva atômica via script Lua** (`reservarSlotDeEnvio`): como o worker roda com
  `concurrency: 5`, um simples "ler contador, depois incrementar" em duas chamadas separadas
  permitiria condição de corrida (dois workers lendo o mesmo valor antes de qualquer um
  incrementar, furando o teto). O script Lua roda atomicamente dentro do próprio Redis,
  eliminando esse risco.
- **Backlog do dia seguinte**: se o teto for atingido, o worker **não descarta** o passo —
  ele reagenda para a próxima janela comercial (amanhã 09h00), sem avançar `passoAtual`
  (na próxima execução, o mesmo passo é reprocessado do zero, inclusive tentando reservar
  slot novamente).
- **Prioridade no backlog**: todo job é agendado com `priority: ordem_do_passo` no BullMQ
  (menor número = maior prioridade). Como o Passo 1 tem `ordem = 1`, ele sempre fica na
  frente de Passo 2/3/4 quando múltiplos jobs competem pela mesma janela de amanhã —
  resolvendo a regra de "Boas-vindas tem prioridade sobre acompanhamento".
- Aumente `MAX_DAILY_MESSAGES` aos poucos conforme o número ganha reputação no WhatsApp.

## Temperatura do Lead (Lead Scoring manual)

Campo `temperatura` no `Lead`, enum `LeadTemperatura` (`nao_avaliado` | `frio` | `morno` | `quente`).
Todo lead novo nasce com `nao_avaliado` — faz sentido, já que o corretor só tem elementos pra
avaliar isso depois do primeiro contato.

### Endpoint

- `PATCH /leads/:id/temperatura` — troca rápida, mesma regra de dono do `PATCH /leads/:id/status`
  (corretor só altera a temperatura dos próprios leads; gestor/admin altera qualquer um). Dispara
  `notificarLeadAtualizado` (Pusher), então o card no Kanban reflete a mudança em tempo real sem
  precisar de refresh — inclusive se outro corretor/gestor estiver olhando o board no momento.
- `GET /leads?temperatura=quente` — o filtro já existe no `listarLeadsQuerySchema`, é a base dos
  botões "Apenas Leads Quentes" / "Apenas Leads Mornos" do Kanban.

### Requisitos para o Front-end (Next.js — próxima fase)

- **Indicador visual no card**: cor ou ícone por temperatura (ex: 🔴 quente, 🟡 morno, 🔵 frio,
  cinza/sem destaque para não avaliado). Sugestão: uma borda lateral colorida no card, mais sutil
  que um badge grande — mantém o tom "Concierge" sem virar um painel gritante de cores.
- **Troca rápida**: dropdown direto no card (sem abrir a ficha do lead) ou no cabeçalho do chat.
  Chama `PATCH /leads/:id/temperatura` e atualiza o card localmente (otimista), igual ao padrão
  de drag-and-drop que já documentamos para o `status`.
- **Filtros rápidos no topo do Kanban**: botões tipo pill/toggle ("Quentes", "Mornos", "Frios",
  "Todos") que aplicam o parâmetro `temperatura` na query de `GET /leads` — client-side, sem
  precisar de uma tela de filtro separada.

## Quick Replies (Respostas Rápidas / Templates de Script)

Tabela `quick_replies`, com dois tipos:
- `global`: criado por gestor/admin, visível para toda a equipe.
- `pessoal`: criado por um corretor, visível só para ele.

### Variáveis dinâmicas

O `textoMensagem` suporta `{{lead_name}}` e `{{broker_name}}`. A substituição acontece em
`src/lib/template-variaveis.ts` (`substituirVariaveis`), chamada dentro de
`QuickRepliesService.enviarParaLead()` — nunca no front-end, para garantir que o texto que
chega no WhatsApp já saiu do backend 100% resolvido. Adicionar uma variável nova no futuro
(ex: `{{imovel_titulo}}`) é só uma linha a mais no tipo `VariaveisTemplate`.

### Endpoints

- `GET /api/quick-replies?busca=texto` — lista os visíveis para o usuário (globais + pessoais
  dele), filtrando por título. É o endpoint que vai alimentar o popover do "/" no chat.
- `POST /api/quick-replies` — cria (tipo `global` restrito a gestor/admin).
- `PATCH /api/quick-replies/:id` / `DELETE /api/quick-replies/:id` — só o dono (se pessoal) ou
  gestor/admin (se global) pode editar/apagar.
- `POST /api/quick-replies/:id/enviar/:leadId` — dispara o quick reply para o lead, já com as
  variáveis substituídas. Usa o mesmo `WhatsappService.enviarTexto` do envio manual comum —
  ou seja, só funciona dentro da janela de 24h (é texto livre, não template pré-aprovado).

### Previsão de UX para o Next.js (próxima fase)

O input de texto do chat deve ter um **trigger na tecla `/`**: ao digitar `/`, abre um popover
listando os quick replies disponíveis (globais + pessoais do corretor logado), com um campo de
busca que filtra pelo `titulo` em tempo real (debounce chamando `GET /api/quick-replies?busca=...`,
ou filtrando client-side se a lista total for pequena — o que é provável, dado o volume de uma
imobiliária boutique). Ao selecionar um item, duas abordagens possíveis:
1. Inserir o texto (já com variáveis substituídas) diretamente no campo, para o corretor revisar antes de enviar.
2. Enviar direto via `POST /api/quick-replies/:id/enviar/:leadId`, sem passar pelo campo de texto.

Recomendo a opção 1 como padrão — corretores de imóveis de alto padrão costumam querer dar uma
ajustada fina no texto antes de mandar (nome do imóvel, detalhe da visita, etc.), então forçar
uma revisão rápida antes do envio é mais alinhado ao tom "Concierge" do que um disparo automático.
Como o texto final já vem resolvido do backend (endpoint de listagem pode retornar o texto puro
com `{{variáveis}}`, e a substituição real acontece no envio), a opção 1 precisaria de uma
pequena adaptação: ou o front resolve as variáveis com os dados que já tem em tela (nome do lead,
nome do corretor logado) para preencher o campo, ou criamos um endpoint auxiliar
`GET /api/quick-replies/:id/preview?leadId=...` que devolve o texto já substituído para exibição
antes do envio — vale decidir isso quando chegarmos na tela do chat.

## Fase 10 — Configurações (Gestão de Equipe + Motor/Segurança do WhatsApp)

### RBAC mais restrito que o padrão do resto do sistema

`POST /usuarios` e `PATCH /usuarios/:id` passaram de `requireRole('gestor', 'admin')` para
**`requireRole('admin')` apenas** — decisão explícita da Fase 10, já que criar acessos e definir
senhas temporárias é mais sensível do que as ações do dia a dia (mover lead, transferir
atendimento). `GET /usuarios` **continua** aberto a gestor/admin, porque outras partes do
sistema dependem disso sem serem "Gestão de Equipe" de verdade: o filtro de corretor no Kanban e
o dropdown de transferência de leads na tabela "Meus Leads".

### Limite diário configurável em tempo real (`src/lib/limite-diario.ts`)

Antes, `MAX_DAILY_MESSAGES` só existia como variável de ambiente — mudar o valor exigia
redeploy, o que não serve para "abrir a torneira aos poucos" pelo painel. Agora:
- `obterLimiteDiario()`: lê um override no Redis (`config:max_daily_messages`) se existir,
  senão cai na env var (comportamento original preservado).
- `definirLimiteDiario(novoLimite)`: grava o override — é o que a tela de Configurações chama.
- `reservarSlotDeEnvio()` (a trava anti-ban) já usa `obterLimiteDiario()` em vez da env var
  direto, então a mudança feita pelo Admin tem efeito imediato, sem restart do worker.

Endpoints (`src/modules/sistema/`, restritos a `admin`):
- `GET /api/sistema/limite-diario` → `{ limite, enviadosHoje }`
- `PATCH /api/sistema/limite-diario` → `{ limite: number }`

### Painel de status das integrações — decisão de segurança

`GET /api/sistema/status-integracoes` retorna **só booleanos** (`configurado: true/false`) para
WhatsApp Cloud API, Meta Ads, Imobzi e Pusher — nunca os valores reais dos tokens. Optei
deliberadamente por **não** construir uma tela que aceite e transmita segredos de API via
formulário web: isso adicionaria uma superfície de risco (histórico do navegador, devtools,
logs de acesso) que o `.env`/secrets manager do provedor de hospedagem já resolve corretamente.
Editar os valores reais dos tokens continua sendo feito direto no ambiente de hospedagem
(Railway/Render), não pelo painel.

## Próximos módulos

- **Fase 5**: RBAC (Admin/Corretor), round-robin de distribuição de leads, endpoints de
  transferência/status, e tempo real via Pusher — tudo implementado, ver seção abaixo.
- **Front-end (Next.js)**: ainda não construído neste repositório — fica para quando vocês
  quiserem partir para o painel visual (Kanban + chat).

## Fase 5 — Usuários, Round-Robin, Kanban e Tempo Real

### RBAC

- `corretor`: só vê e só pode mover/responder os leads onde `corretorId` é o próprio usuário
  (aplicado no `LeadsService`, não na query string — o corretor não consegue burlar isso).
- `gestor` / `admin`: visão total, podem transferir leads entre corretores
  (`PATCH /api/leads/:id/atribuir`, restrito por `requireRole`).

### Round-Robin (`src/lib/round-robin.ts`)

Usa `INCR` do Redis (atômico) sobre a lista de corretores ativos, ordenada por `ordemRoleta`.
Isso evita que dois leads chegando ao mesmo tempo (Meta Ads + webhook do Imobzi, por exemplo) caiam no
mesmo corretor por uma condição de corrida. A atribuição acontece dentro do `LeadsService`,
antes mesmo de iniciar a cadência — é por isso que o Passo 1 já sabe qual corretor mencionar.

### Endpoints novos

- `PATCH /api/leads/:id/status` — move o card no Kanban. Corretor só move os próprios leads.
- `PATCH /api/leads/:id/atribuir` — transfere o lead para outro corretor. Só `gestor`/`admin`.

### Pusher (`src/lib/pusher.ts`)

Dois canais privados:
- `private-kanban`: todo usuário autenticado assina. Recebe `lead_atualizado` (mudança de
  status/atribuição) e `mensagem_no_board` (preview curto, para atualizar o card sem abrir o chat).
- `private-lead-{id}`: assinado só quando o chat daquele lead está aberto. Recebe `nova_mensagem`
  com o conteúdo completo.

A autenticação de canal privado passa por `POST /api/pusher/auth` (`src/modules/realtime`),
que aplica o mesmo RBAC: um corretor não consegue assinar o canal de um lead que não é dele.

### Exemplo de integração no Next.js (client-side)

```bash
npm install pusher-js @tanstack/react-query
```

```typescript
// lib/pusher-client.ts
import PusherClient from 'pusher-js';

export function criarPusherClient(tokenJwt: string) {
  return new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    authEndpoint: `${process.env.NEXT_PUBLIC_API_URL}/api/pusher/auth`,
    auth: { headers: { Authorization: `Bearer ${tokenJwt}` } },
  });
}
```

```typescript
// hooks/useKanbanRealtime.ts — atualiza o board sem refetch completo
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useKanbanRealtime(pusherClient: PusherClient) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const canal = pusherClient.subscribe('private-kanban');

    canal.bind('lead_atualizado', ({ lead }: { lead: LeadResumo }) => {
      queryClient.setQueryData(['leads'], (board: any) =>
        atualizarCardNoBoard(board, lead) // função local que só troca o card afetado
      );
    });

    return () => pusherClient.unsubscribe('private-kanban');
  }, [pusherClient, queryClient]);
}
```

```typescript
// hooks/useLeadChatRealtime.ts — só assina o canal quando o chat está aberto
export function useLeadChatRealtime(pusherClient: PusherClient, leadId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const canal = pusherClient.subscribe(`private-lead-${leadId}`);

    canal.bind('nova_mensagem', ({ mensagem }: { mensagem: Mensagem }) => {
      queryClient.setQueryData(['lead', leadId], (atual: any) => ({
        ...atual,
        mensagens: [...atual.mensagens, mensagem],
      }));
    });

    return () => pusherClient.unsubscribe(`private-lead-${leadId}`);
  }, [pusherClient, leadId, queryClient]);
}
```

### Variáveis de ambiente do Pusher (plano gratuito)

Crie um app em [dashboard.pusher.com](https://dashboard.pusher.com) e preencha
`PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` no `.env`. No front-end
Next.js, `NEXT_PUBLIC_PUSHER_KEY` e `NEXT_PUBLIC_PUSHER_CLUSTER` (só a key pública, nunca o secret).
