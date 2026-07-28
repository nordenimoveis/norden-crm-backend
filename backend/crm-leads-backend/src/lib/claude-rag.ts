import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config/env';

let cliente: Anthropic | null = null;

function obterCliente() {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_NAO_CONFIGURADO');
  if (!cliente) cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cliente;
}

// Claude 3.5 Sonnet foi desativado pela Anthropic em 5 de janeiro de 2026 —
// usando o modelo atual da mesma "classe" (Sonnet), que é quem substitui.
const MODELO = 'claude-sonnet-5';
// Reescrita de query é uma tarefa simples e curta — não precisa do modelo
// principal, o Haiku é mais rápido e mais barato pra esse passo intermediário.
const MODELO_RAPIDO = 'claude-haiku-4-5-20251001';

/**
 * Corrige a "amnésia de contexto" do RAG conversacional: se o cliente
 * pergunta "o que o condomínio oferece?" depois de ter falado sobre um
 * imóvel específico, a busca semântica sozinha (só com essa frase isolada)
 * não sabe QUAL condomínio — e pode trazer contexto do imóvel errado.
 *
 * Aqui reescrevemos a pergunta pra ser autossuficiente ANTES de gerar o
 * embedding de busca, substituindo pronomes/referências implícitas pelos
 * nomes reais já citados na conversa. Só afeta a BUSCA — a resposta final
 * ainda é gerada a partir da pergunta original do cliente (soa mais
 * natural manter a pergunta como a pessoa realmente escreveu).
 */
export async function reescreverPergunta(
  historicoConversa: { autor: 'lead' | 'equipe'; texto: string }[],
  perguntaAtual: string
): Promise<string> {
  if (historicoConversa.length === 0) return perguntaAtual;

  const anthropic = obterCliente();

  const historicoFormatado = historicoConversa
    .slice(-8)
    .map((m) => `${m.autor === 'lead' ? 'Cliente' : 'Atendimento'}: ${m.texto}`)
    .join('\n');

  const resposta = await anthropic.messages.create({
    model: MODELO_RAPIDO,
    max_tokens: 200,
    system: `Dada a conversa abaixo, reescreva a ÚLTIMA pergunta do cliente para que ela seja uma pergunta independente e completa, substituindo pronomes e referências implícitas (ex: "ele", "esse imóvel", "lá") pelos nomes reais (ex: nome do imóvel/empreendimento) já citados na conversa.

Se a pergunta já for independente e não depender de nada dito antes, retorne ela exatamente como está.

Retorne APENAS a pergunta reescrita, sem explicação, sem aspas, sem comentário.`,
    messages: [
      {
        role: 'user',
        content: `Conversa:\n${historicoFormatado}\n\nÚltima pergunta do cliente: ${perguntaAtual}`,
      },
    ],
  });

  const bloco = resposta.content.find((b) => b.type === 'text');
  const textoReescrito = bloco && bloco.type === 'text' ? bloco.text.trim() : perguntaAtual;

  return textoReescrito || perguntaAtual;
}

/**
 * Gera a resposta aterrada no contexto recuperado (RAG). O prompt é
 * deliberadamente restritivo: a IA só pode responder com base no que foi
 * recuperado da base de conhecimento — se não tiver contexto suficiente,
 * instruímos ela a dizer isso em vez de inventar (preço, disponibilidade,
 * condição de imóvel são informações caras de errar).
 *
 * Como a IA aqui manda a mensagem direto pro WhatsApp sem revisão humana,
 * essa restrição de "não inventar" é a principal rede de segurança —
 * cumpre o mesmo papel que uma revisão humana cumpriria, sem bloquear o
 * envio automático que foi pedido.
 */
export async function gerarRespostaRAG(params: {
  perguntaDoLead: string;
  contexto: string[];
  historicoConversa: { autor: 'lead' | 'equipe'; texto: string }[];
  nomeDoLead?: string;
}): Promise<string> {
  const anthropic = obterCliente();

  const contextoFormatado =
    params.contexto.length > 0
      ? params.contexto.map((c, i) => `[Trecho ${i + 1}]\n${c}`).join('\n\n')
      : '(nenhum trecho relevante encontrado na base de conhecimento)';

  const historicoFormatado = params.historicoConversa
    .slice(-10) // últimas 10 mensagens são suficientes de contexto conversacional
    .map((m) => `${m.autor === 'lead' ? 'Cliente' : 'Norden'}: ${m.texto}`)
    .join('\n');

  const systemPrompt = `Você é o atendimento da Norden Imóveis, uma imobiliária de alto padrão em Jurerê e região, respondendo pelo WhatsApp.

REGRAS ABSOLUTAS:
- Responda SOMENTE com base nos trechos de contexto fornecidos abaixo. Se a pergunta não puder ser respondida com esses trechos, diga educadamente que vai verificar essa informação com a equipe e volta em breve — NUNCA invente preço, disponibilidade, metragem, condição de imóvel ou qualquer dado factual que não esteja explicitamente no contexto.
- Tom "Concierge": elegante, consultivo, sem pressão de vendas — cordial e direto, sem soar robótico.
- Respostas curtas (2-4 frases), adequadas ao formato de WhatsApp.
- Nunca mencione que você é uma IA, um modelo de linguagem, ou o nome "Claude" — você é "o atendimento da Norden".

CONTEXTO RECUPERADO DA BASE DE CONHECIMENTO:
${contextoFormatado}`;

  const mensagemUsuario = `${historicoFormatado ? `Histórico recente da conversa:\n${historicoFormatado}\n\n` : ''}Mensagem atual do cliente${params.nomeDoLead ? ` (${params.nomeDoLead})` : ''}: ${params.perguntaDoLead}`;

  const resposta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: mensagemUsuario }],
  });

  const bloco = resposta.content.find((b) => b.type === 'text');
  return bloco && bloco.type === 'text' ? bloco.text : '';
}

/**
 * Reestrutura o texto bruto extraído de um PDF (frequentemente "sopa de
 * números" quando o documento tem tabelas — a extração simples não sabe
 * onde termina uma coluna e começa outra). O Claude reconstrói isso em
 * texto legível/Markdown ANTES do documento virar chunks+embeddings — é
 * essa versão reestruturada que fica na base de conhecimento, não o texto
 * bruto original.
 */
export async function reestruturarTextoDocumento(textoBruto: string): Promise<string> {
  const anthropic = obterCliente();

  const resposta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 4000,
    system: `Você está recebendo os dados brutos extraídos de um PDF de imobiliária. Se identificar uma tabela de preços, disponibilidade de unidades, ou qualquer dado estruturado que a extração de texto tenha "embaralhado" (números e colunas fora de ordem), reconstrua esses dados em texto legível, um item por linha — por exemplo: "Unidade 201 - 2 quartos - 85m² - R$ 1.500.000".

Descarte códigos de indexação inúteis, cabeçalhos/rodapés repetidos, e qualquer lixo de formatação do PDF. Preserve o conteúdo textual normal (descrições, condições, texto corrido) como está, só reorganizando o que estiver claramente bagunçado.

Retorne APENAS o conteúdo reorganizado, sem introdução, sem comentário seu, sem explicar o que você fez.`,
    messages: [{ role: 'user', content: textoBruto }],
  });

  const bloco = resposta.content.find((b) => b.type === 'text');
  return bloco && bloco.type === 'text' ? bloco.text : textoBruto;
}

export type DadosImovelExtraidos = {
  titulo: string;
  bairro: string | null;
  cidade: string | null;
  valor: number | null;
  metragem: number | null;
  quartos: number | null;
  descricao: string;
};

/**
 * Lê o texto de um anúncio/documento de imóvel e extrai os campos
 * estruturados do nosso catálogo — a "cereja do bolo" do cadastro: em vez
 * do corretor digitar tudo, ele sobe o PDF/URL e a IA pré-preenche. O
 * corretor ainda revisa e confirma antes de salvar (erro de preço/metragem
 * é caro, não convém confiar 100% sem um humano olhar).
 */
export async function extrairDadosImovel(textoDocumento: string): Promise<DadosImovelExtraidos> {
  const anthropic = obterCliente();

  const resposta = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 1000,
    system: `Você extrai dados estruturados de anúncios ou documentos de imóveis. Responda APENAS com um JSON válido, sem nenhum texto antes ou depois, exatamente neste formato:
{"titulo": string, "bairro": string ou null, "cidade": string ou null, "valor": number ou null (em reais, só o número, sem "R$" nem pontuação), "metragem": number ou null (em m², só o número), "quartos": number ou null, "descricao": string (resumo de 2-3 frases com as características e diferenciais do imóvel)}
Se um dado não estiver claramente no texto, use null nesse campo — NUNCA invente valor, metragem ou qualquer dado factual.`,
    messages: [{ role: 'user', content: textoDocumento.slice(0, 8000) }],
  });

  const bloco = resposta.content.find((b) => b.type === 'text');
  const textoResposta = bloco && bloco.type === 'text' ? bloco.text : '{}';
  const jsonLimpo = textoResposta.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(jsonLimpo);
  } catch {
    throw new Error('FALHA_AO_INTERPRETAR_RESPOSTA_IA');
  }
}
