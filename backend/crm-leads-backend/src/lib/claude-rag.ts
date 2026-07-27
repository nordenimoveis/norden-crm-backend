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
