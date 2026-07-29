import { env } from '@/config/env';

/**
 * Formato REAL confirmado contra a API do Imobzi (testado em produção) —
 * bem diferente da estimativa inicial. `neighborhood` = bairro, `bedroom` =
 * quartos, `suite` = suítes, `area` = metragem, `cover_photo.url` = foto.
 * Não existe campo de descrição/diferenciais nessa listagem — o texto rico
 * é montado só com os dados estruturados disponíveis aqui.
 */
export type ImobziImovelRaw = {
  property_id: string;
  db_id: string;
  building_name?: string;
  property_type?: string; // "Apartamento" | "Casa" | ...
  address?: string;
  neighborhood?: string;
  city?: string;
  sale_value?: number;
  rental_value?: number;
  area?: number;
  useful_area?: number;
  bedroom?: number;
  suite?: number;
  bathroom?: number;
  garage?: number;
  status?: string; // "available" confirmado; outros valores (vendido/inativo) ainda não vistos
  active?: boolean;
  cover_photo?: { url?: string };
  code?: string;
};

type RespostaListaImobzi = {
  database: string;
  cursor?: string | null;
  count: number;
  properties: ImobziImovelRaw[];
};

/**
 * "Indisponível" = active explicitamente false, OU status diferente de
 * "available". Ainda não vimos um exemplo real de imóvel vendido/inativo
 * no payload de teste — se os valores reais forem diferentes do esperado,
 * ajustamos aqui.
 */
export function statusIndicaIndisponivel(bruto: ImobziImovelRaw): boolean {
  if (bruto.active === false) return true;
  if (bruto.status && bruto.status !== 'available') return true;
  return false;
}

/**
 * Busca TODOS os imóveis do Imobzi, paginando por cursor. O cursor vem na
 * RAIZ da resposta (`cursor`, não aninhado) — repassamos ele de volta na
 * próxima chamada. Paramos quando: não vier mais cursor, o cursor repetir
 * (proteção contra loop infinito), ou já tivermos coletado `count` itens.
 */
export async function buscarTodosImoveisImobzi(): Promise<ImobziImovelRaw[]> {
  if (!env.IMOBZI_API_BASE_URL || !env.IMOBZI_API_TOKEN) {
    throw new Error('IMOBZI_NAO_CONFIGURADO');
  }

  const todos: ImobziImovelRaw[] = [];
  let cursor: string | null = null;
  let totalEsperado = Infinity;

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
    todos.push(...dados.properties);
    totalEsperado = dados.count;

    const novoCursor = dados.cursor ?? null;
    cursor = !novoCursor || novoCursor === cursor || todos.length >= totalEsperado ? null : novoCursor;
  } while (cursor);

  return todos;
}
