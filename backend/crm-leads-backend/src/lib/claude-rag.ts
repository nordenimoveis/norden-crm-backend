import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config/env';

let cliente: Anthropic | null = null;

function obterCliente() {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_NAO_CONFIGURADO');
  if (!cliente) cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cliente;
}

const MODELO = 'claude-sonnet-5';

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
    .slice(-10)
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
 * números" quando o documento tem tabelas). O Claude reconstrói isso em
 * texto legível ANTES do documento virar chunks+embeddings.
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
