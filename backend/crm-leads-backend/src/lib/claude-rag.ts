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
