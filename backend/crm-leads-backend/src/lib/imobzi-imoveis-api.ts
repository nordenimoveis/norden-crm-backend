import { env } from '@/config/env';

/**
 * Formato do imóvel vindo do Imobzi — os nomes de campo abaixo são uma
 * estimativa razoável baseada no que já vimos da API de LEADS do Imobzi
 * (que usamos na integração original). É bem provável que precisemos
 * ajustar nomes de campo assim que testarmos contra a API de imóveis de
 * verdade — foi exatamente o que aconteceu da primeira vez, quando
 * descobrimos que o telefone do lead vinha aninhado em `cellphone: {number,
 * country_code}` em vez de um campo simples.
 */
export type ImobziImovelRaw = {
  id: string;
  titulo?: string;
  bairro?: string;
  cidade?: string;
  metragem?: number;
  quartos?: number;
  suites?: number;
  valor?: number;
  status?: string; // ex: "disponivel" | "vendido" | "inativo" — confirmar nomes reais
  descricao?: string;
  foto_url?: string;
};

type RespostaListaImobzi = {
  results: ImobziImovelRaw[];
  next_cursor?: string | null;
};

const STATUS_INDISPONIVEL = ['vendido', 'inativo', 'indisponivel', 'reservado'];

export function statusIndicaIndisponivel(status?: string): boolean {
  if (!status) return false;
  return STATUS_INDISPONIVEL.includes(status.toLowerCase());
}

/**
 * Busca TODOS os imóveis do Imobzi, paginando por cursor (mesmo padrão já
 * usado na importação de leads legados). NÃO filtra por status no
 * servidor — trazemos tudo, inclusive vendidos/inativos, porque o próprio
 * sync precisa saber disso pra DESATIVAR esses imóveis no nosso catálogo
 * (não simplesmente ignorá-los).
 */
export async function buscarTodosImoveisImobzi(): Promise<ImobziImovelRaw[]> {
  if (!env.IMOBZI_API_BASE_URL || !env.IMOBZI_API_TOKEN) {
    throw new Error('IMOBZI_NAO_CONFIGURADO');
  }

  const todos: ImobziImovelRaw[] = [];
  let cursor: string | null = null;

  do {
    const baseUrl = env.IMOBZI_API_BASE_URL.replace(/\/+$/, ''); // remove barra(s) sobrando no final
    const url = new URL(`${baseUrl}/properties`);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: { 'X-Imobzi-Secret': env.IMOBZI_API_TOKEN },
    });

    if (!response.ok) {
      const corpoErro = await response.text().catch(() => '');
      throw new Error(`Falha ao buscar imóveis do Imobzi (status ${response.status}): ${corpoErro}`);
    }

    const dados = (await response.json()) as RespostaListaImobzi;
    todos.push(...dados.results);
    cursor = dados.next_cursor ?? null;
  } while (cursor);

  return todos;
}
