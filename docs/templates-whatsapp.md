# Templates do WhatsApp para a cadência

A Meta exige templates aprovados para qualquer mensagem enviada a quem não falou com a Norden nas últimas 24 horas. Como o lead do Meta Ads ou do site ainda não iniciou a conversa, **os cinco contatos de WhatsApp da régua precisam ser templates**.

A régua tem **5 contatos de WhatsApp (1 por dia) + 2 tarefas de ligação** para o corretor (dias 2 e 4), criadas automaticamente quando o cliente não respondeu. As ligações **não são templates** — aparecem na tela **Tarefas** do corretor.

Envie os cinco para aprovação logo no início: é a etapa que mais demora e pode ter recusas.

## Como cadastrar

No Gerenciador do WhatsApp (business.facebook.com → WhatsApp Manager → Modelos de mensagem):

- **Categoria:** Marketing
- **Idioma:** Português (BR) — código `pt_BR`
- **Tipo:** Padrão, somente texto
- **Variáveis:** `{{1}}` = primeiro nome do cliente, `{{2}}` = primeiro nome do corretor (nesta ordem em todos)
- Na tela de exemplo, a Meta pede valores de amostra: use `Mariana` e `Pedro`

Os nomes abaixo já são os padrões do sistema. Se mudar algum nome, ajuste as variáveis `TEMPLATE_STEP_1..5` no `.env`.

Regras que costumam causar recusa: começar ou terminar o texto com uma variável, variáveis seguidas (`{{1}} {{2}}`), texto curto demais em relação ao número de variáveis e linguagem que pareça promessa comercial agressiva. Os textos abaixo já evitam esses pontos.

## Ritmo da régua

| Dia | Ação | Canal | Template |
|---|---|---|---|
| 1 | Recepção (1–3 min após a entrada) | WhatsApp | `norden_boas_vindas` |
| 2 | Qualificação suave | WhatsApp | `norden_qualificacao` |
| 2 | Ligação (se o cliente não respondeu) | 📞 Tarefa | — |
| 3 | Autoridade / off-market | WhatsApp | `norden_off_market` |
| 4 | Apoio na decisão | WhatsApp | `norden_apoio` |
| 4 | Ligação (se o cliente não respondeu) | 📞 Tarefa | — |
| 5 | Despedida elegante → "Lead Frio / Standby" | WhatsApp | `norden_despedida` |

Tudo respeita o horário comercial (seg–sáb, 09h–19h). **Qualquer mensagem do cliente cancela a régua e as tarefas pendentes.**

---

## Passo 1 — `norden_boas_vindas`
*Enviado de 1 a 3 minutos após a entrada do lead (dentro do horário comercial).*

```
Olá, {{1}}! Aqui é {{2}}, da Norden Imóveis. Recebi seu interesse e será um prazer acompanhar você pessoalmente. Quando for conveniente, me conte um pouco sobre o que procura.
```

## Passo 2 — `norden_qualificacao`
*Dia 2.*

```
Olá, {{1}}. Para selecionar apenas o que realmente faz sentido para você, posso entender melhor o que imagina? Tipologia, região preferida e o momento da sua busca já me ajudam bastante. Sigo à disposição, {{2}} | Norden Imóveis.
```

## Passo 3 — `norden_off_market`
*Dia 3.*

```
Olá, {{1}}. Parte dos imóveis que acompanhamos em Jurerê não é divulgada publicamente. Se desejar, posso apresentar algumas oportunidades reservadas alinhadas ao seu perfil. {{2}} | Norden Imóveis.
```

## Passo 4 — `norden_apoio`
*Dia 4.*

```
Olá, {{1}}. Sei que uma decisão dessas merece calma. Se ajudar, posso enviar valores, plantas ou combinar uma visita sem compromisso, no seu tempo. Fico à disposição para conversar. {{2}} | Norden Imóveis.
```

## Passo 5 — `norden_despedida`
*Dia 5. Depois dele o lead vai para "Lead Frio / Standby".*

```
Olá, {{1}}. Imagino que o momento talvez não seja agora, e está tudo bem. Vou pausar as mensagens por aqui, mas sigo à disposição sempre que desejar retomar. Um abraço, {{2}} | Norden Imóveis.
```

---

## Tarefas de ligação (dias 2 e 4)

Não são templates. Quando o passo de ligação vence e o cliente ainda não respondeu, o sistema cria uma tarefa **"Ligar para \<cliente\>"** para o corretor dono do lead. Ele executa na tela **Tarefas** (botão de ligar + WhatsApp) e registra o resultado: **"Falei com o cliente"** ou **"Não atendeu"**. A régua segue mesmo se não atender; só para de verdade quando o cliente responde.

## Se alterar algum texto

O texto que aparece no histórico do CRM fica em `crm-api/src/services/cadence.ts` (`TEMPLATE_PREVIEWS`). Mantenha os dois iguais para o corretor ver exatamente o que o cliente recebeu.

## Custo

Cada template de marketing custa cerca de R$ 0,32 (tabela da Meta em reais). Com 30 a 40 leads por mês, o pior cenário (ninguém responde e todos recebem os 5 passos) fica entre R$ 48 e R$ 64 por mês. As ligações não têm custo de template.
