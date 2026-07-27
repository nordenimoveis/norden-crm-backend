import { env } from '@/config/env';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const MODELO = 'voyage-3'; // 1024 dimensões — precisa bater com o `vector(1024)` do schema

/**
 * Gera embeddings via Voyage AI — a Anthropic não tem API própria de
 * embeddings, e recomenda a Voyage como parceira oficial pra isso.
 * `inputType` importa pra qualidade da busca: 'document' na hora de
 * indexar o conteúdo, 'query' na hora de buscar pela pergunta do lead.
 */
export async function gerarEmbeddings(
  textos: string[],
  inputType: 'document' | 'query'
): Promise<number[][]> {
  if (!env.VOYAGE_API_KEY) throw new Error('VOYAGE_NAO_CONFIGURADO');

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: textos, model: MODELO, input_type: inputType }),
  });

  if (!response.ok) {
    const corpo = await response.text();
    throw new Error(`Falha ao gerar embeddings (Voyage): ${response.status} ${corpo}`);
  }

  const dados = (await response.json()) as { data: { embedding: number[] }[] };
  return dados.data.map((item) => item.embedding);
}

export async function gerarEmbeddingUnico(texto: string, inputType: 'document' | 'query') {
  const [embedding] = await gerarEmbeddings([texto], inputType);
  return embedding;
}
