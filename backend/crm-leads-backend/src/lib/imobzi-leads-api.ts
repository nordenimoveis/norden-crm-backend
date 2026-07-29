import { env } from '@/config/env';

/**
 * Formato confirmado contra a especificação oficial (OpenAPI) do Imobzi.
 * IMPORTANTE: a LISTAGEM de contatos (`GET /v1/contacts`) NÃO inclui
 * telefone — só o endpoint de detalhe (`GET /v1/person/{id}`) traz o
 * campo `cellphone`. Por isso, pra cada contato sem telefone na listagem,
 * fazemos uma chamada extra de detalhe (mais lento, mas é o único jeito
 * de ter o telefone real pra criar o lead de WhatsApp).
 */
export type ImobziContatoRaw = {
  contact_id?: string;
  db_id?: string;
  fullname?: string;
  name?: string;
  email?: string;
  contact_type?: 'lead' | 'person' | 'organization' | null;
  cellphone?: {
    number?: string;
    country_code?: string;
  };
};

type RespostaListaContatosImobzi = {
  contacts: ImobziContatoRaw[];
  count?: string | null;
  cursor?: string | null;
};

export function telefoneDoContato(bruto: ImobziContatoRaw): string | null {
  if (!bruto.cellphone?.number) return null;
  const ddi = bruto.cellphone.country_code ?? '55';
  return `+${ddi}${bruto.cellphone.number}`;
}

function idDoContato(bruto: ImobziContatoRaw): string | undefined {
  return bruto.contact_id ?? bruto.db_id;
}

/**
 * Busca o telefone de UM contato específico via detalhe — usado como
 * fallback quando a listagem não trouxe telefone (o caso normal). Devolve
 * o objeto `cellphone` bruto (não formatado), pra passar pela MESMA
 * função `telefoneDoContato` depois, evitando formatar o número duas vezes.
 */
async function buscarCellphoneDetalhe(contatoId: string): Promise<ImobziContatoRaw['cellphone'] | null> {
  const baseUrl = env.IMOBZI_API_BASE_URL!.replace(/\/+$/, '');
  const url = `${baseUrl}/person/${contatoId}`;
  const response = await fetch(url, {
    headers: { 'X-Imobzi-Secret': env.IMOBZI_API_TOKEN! },
  });

  if (!response.ok) return null;

  const dados = (await response.json()) as ImobziContatoRaw;
  return dados.cellphone ?? null;
}

/**
 * Busca todos os contatos do tipo "lead" do Imobzi, paginando por cursor
 * (que vem na raiz da resposta). Pra cada contato sem telefone na
 * listagem, busca o detalhe individual — é lento pra um catálogo grande,
 * mas é uma operação de carga inicial (o dia a dia passa a ser feito via
 * webhook, que já vem com o registro completo).
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
    url.searchParams.set('contact_type', 'lead');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: { 'X-Imobzi-Secret': env.IMOBZI_API_TOKEN },
    });

    if (!response.ok) {
      const corpoErro = await response.text().catch(() => '');
      throw new Error(`Falha ao buscar contatos do Imobzi (status ${response.status}): ${corpoErro}`);
    }

    const dados = (await response.json()) as RespostaListaContatosImobzi;
    todos.push(...dados.contacts);

    const novoCursor = dados.cursor ?? null;
    cursor = !novoCursor || novoCursor === cursor ? null : novoCursor;
  } while (cursor);

  // Enriquece com telefone via detalhe, um de cada vez (sequencial, pra
  // não estourar rate limit da API do Imobzi numa carga grande).
  const enriquecidos: ImobziContatoRaw[] = [];
  for (const contato of todos) {
    if (telefoneDoContato(contato)) {
      enriquecidos.push(contato);
      continue;
    }

    const id = idDoContato(contato);
    if (!id) continue;

    const cellphoneDetalhe = await buscarCellphoneDetalhe(id);
    enriquecidos.push({ ...contato, cellphone: cellphoneDetalhe ?? undefined });
  }

  return enriquecidos;
}
