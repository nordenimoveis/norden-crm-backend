import { env } from '@/config/env';

/**
 * Formato do contato/negócio vindo do Imobzi. O telefone aninhado
 * (`cellphone: { number, country_code }`) segue o MESMO formato que já
 * confirmamos funcionando no webhook de leads novos — reaproveitamos essa
 * suposição aqui também. Os demais nomes de campo são estimativa, sujeitos
 * a ajuste assim que testarmos contra a API real (mesmo aviso de sempre).
 */
export type ImobziContatoRaw = {
  id: string;
  name?: string;
  email?: string;
  cellphone?: {
    number?: string;
    country_code?: string;
  };
};

type RespostaListaContatosImobzi = {
  results: ImobziContatoRaw[];
  next_cursor?: string | null;
};

export function telefoneDoContato(bruto: ImobziContatoRaw): string | null {
  if (!bruto.cellphone?.number) return null;
  const ddi = bruto.cellphone.country_code ?? '55';
  return `+${ddi}${bruto.cellphone.number}`;
}

/**
 * Busca TODOS os contatos/negócios recentes do Imobzi, paginando por
 * cursor (mesmo padrão da importação de imóveis e da importação legada
 * de leads).
 */
export async function buscarContatosImobzi(): Promise<ImobziContatoRaw[]> {
  if (!env.IMOBZI_API_BASE_URL || !env.IMOBZI_API_TOKEN) {
    throw new Error('IMOBZI_NAO_CONFIGURADO');
  }

  const todos: ImobziContatoRaw[] = [];
  let cursor: string | null = null;

  do {
    const baseUrl = env.IMOBZI_API_BASE_URL.replace(/\/+$/, '');
    const url = new URL(`${baseUrl}/contacts`);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: { 'X-Imobzi-Secret': env.IMOBZI_API_TOKEN },
    });

    if (!response.ok) {
      const corpoErro = await response.text().catch(() => '');
      throw new Error(`Falha ao buscar contatos do Imobzi (status ${response.status}): ${corpoErro}`);
    }

    const dados = (await response.json()) as RespostaListaContatosImobzi;
    todos.push(...dados.results);
    cursor = dados.next_cursor ?? null;
  } while (cursor);

  return todos;
}
