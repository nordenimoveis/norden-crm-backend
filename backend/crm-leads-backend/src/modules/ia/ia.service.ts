import { PrismaClient } from '@prisma/client';
import { gerarEmbeddings, gerarEmbeddingUnico } from '@/lib/embeddings';
import { gerarRespostaRAG } from '@/lib/claude-rag';
import { extrairTextoDePdf, extrairTextoDeUrl } from '@/lib/extracao-texto';

const TAMANHO_CHUNK = 1000; // caracteres — aproximação simples, não por token
const SOBREPOSICAO_CHUNK = 150; // evita cortar uma ideia bem no meio entre dois chunks
const TOP_K_CONTEXTO = 5;

export class IaService {
  constructor(private prisma: PrismaClient) {}

  // ---------------------------------------------------------------------
  // Ingestão de documentos
  // ---------------------------------------------------------------------

  private dividirEmChunks(texto: string): string[] {
    const textoLimpo = texto.replace(/\s+/g, ' ').trim();
    const chunks: string[] = [];

    let inicio = 0;
    while (inicio < textoLimpo.length) {
      const fim = Math.min(inicio + TAMANHO_CHUNK, textoLimpo.length);
      chunks.push(textoLimpo.slice(inicio, fim));
      inicio += TAMANHO_CHUNK - SOBREPOSICAO_CHUNK;
    }

    return chunks.filter((c) => c.trim().length > 0);
  }

  /**
   * Indexa um documento inteiro: extrai texto, quebra em chunks, gera os
   * embeddings de todos de uma vez (mais barato que um por um), e salva.
   * `origem` decide se o texto vem de um PDF (buffer) ou de uma URL.
   */
  async ingerirDocumento(params: {
    titulo: string;
    origem: 'pdf' | 'url';
    bufferPdf?: Buffer;
    url?: string;
  }) {
    const texto =
      params.origem === 'pdf'
        ? await extrairTextoDePdf(params.bufferPdf!)
        : await extrairTextoDeUrl(params.url!);

    if (!texto || texto.trim().length < 20) {
      throw new Error('CONTEUDO_VAZIO');
    }

    const chunks = this.dividirEmChunks(texto);
    if (chunks.length === 0) throw new Error('CONTEUDO_VAZIO');

    const embeddings = await gerarEmbeddings(chunks, 'document');

    const documento = await this.prisma.documento.create({
      data: {
        titulo: params.titulo,
        origem: params.origem,
        urlOrigem: params.origem === 'url' ? params.url : null,
      },
    });

    // Insert de vetor precisa ser SQL puro — o Prisma Client não sabe
    // escrever num campo `Unsupported("vector(...)")`.
    for (let i = 0; i < chunks.length; i++) {
      const vetorLiteral = `[${embeddings[i].join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO documento_chunks (id, documento_id, conteudo, embedding, criado_em)
         VALUES (gen_random_uuid(), $1, $2, $3::vector, now())`,
        documento.id,
        chunks[i],
        vetorLiteral
      );
    }

    return { ...documento, totalChunks: chunks.length };
  }

  async listarDocumentos() {
    return this.prisma.documento.findMany({
      orderBy: { criadoEm: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async deletarDocumento(id: string) {
    await this.prisma.documento.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------
  // Busca semântica (equivalente ao `match_documents` do Supabase, só que
  // em SQL puro contra o Postgres do próprio Railway)
  // ---------------------------------------------------------------------

  async buscarContexto(pergunta: string): Promise<string[]> {
    const embeddingPergunta = await gerarEmbeddingUnico(pergunta, 'query');
    const vetorLiteral = `[${embeddingPergunta.join(',')}]`;

    // `<=>` é o operador de distância de cosseno do pgvector — quanto
    // menor, mais parecido. ORDER BY + LIMIT é o "top-K" da busca.
    const resultados = await this.prisma.$queryRawUnsafe<{ conteudo: string }[]>(
      `SELECT conteudo FROM documento_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vetorLiteral,
      TOP_K_CONTEXTO
    );

    return resultados.map((r) => r.conteudo);
  }

  // ---------------------------------------------------------------------
  // Simulador (Playground) — mesma busca semântica + geração usadas no
  // atendimento de verdade, mas SEM tocar em nenhum lead real e devolvendo
  // as fontes exatas usadas (transparência pro admin validar o chunking).
  // ---------------------------------------------------------------------

  private async buscarContextoComFontes(pergunta: string) {
    const embeddingPergunta = await gerarEmbeddingUnico(pergunta, 'query');
    const vetorLiteral = `[${embeddingPergunta.join(',')}]`;

    return this.prisma.$queryRawUnsafe<
      { conteudo: string; tituloDocumento: string; distancia: number }[]
    >(
      `SELECT dc.conteudo, d.titulo AS "tituloDocumento", dc.embedding <=> $1::vector AS distancia
       FROM documento_chunks dc
       JOIN documentos d ON d.id = dc.documento_id
       ORDER BY distancia ASC
       LIMIT $2`,
      vetorLiteral,
      TOP_K_CONTEXTO
    );
  }

  async simular(pergunta: string) {
    const fontes = await this.buscarContextoComFontes(pergunta);

    const resposta = await gerarRespostaRAG({
      perguntaDoLead: pergunta,
      contexto: fontes.map((f) => f.conteudo),
      historicoConversa: [],
    });

    return {
      resposta,
      fontes: fontes.map((f) => ({
        conteudo: f.conteudo,
        tituloDocumento: f.tituloDocumento,
        // Similaridade em % é mais legível pro admin que a distância crua
        similaridade: Math.round(Math.max(0, Math.min(1, 1 - f.distancia)) * 100),
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Geração da resposta para um lead específico
  // ---------------------------------------------------------------------

  async gerarRespostaParaLead(leadId: string, mensagemDoLead: string): Promise<string> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { mensagens: { orderBy: { criadoEm: 'desc' }, take: 10 } },
    });

    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    const contexto = await this.buscarContexto(mensagemDoLead);

    const historico = lead.mensagens
      .reverse()
      .map((m) => ({ autor: (m.direcao === 'recebida' ? 'lead' : 'equipe') as 'lead' | 'equipe', texto: m.conteudo }));

    return gerarRespostaRAG({
      perguntaDoLead: mensagemDoLead,
      contexto,
      historicoConversa: historico,
      nomeDoLead: lead.nome ?? undefined,
    });
  }
}
