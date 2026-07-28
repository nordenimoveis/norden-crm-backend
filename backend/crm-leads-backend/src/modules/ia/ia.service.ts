import { PrismaClient } from '@prisma/client';
import { gerarEmbeddings, gerarEmbeddingUnico } from '@/lib/embeddings';
import { gerarRespostaRAG, reestruturarTextoDocumento, reescreverPergunta } from '@/lib/claude-rag';
import { extrairTextoDePdf, extrairTextoDeUrl } from '@/lib/extracao-texto';

const TAMANHO_CHUNK = 1000; // caracteres — aproximação simples, não por token
const SOBREPOSICAO_CHUNK = 150; // evita cortar uma ideia bem no meio entre dois chunks
const TOP_K_CONTEXTO = 5;

// Tamanho máximo de texto bruto processado por chamada de "tradução
// estruturada" — documentos maiores são segmentados, uma chamada por
// segmento, pra não estourar o limite de contexto/saída do modelo.
const TAMANHO_SEGMENTO_REESTRUTURACAO = 12000;

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
   * "Upload Inteligente" — antes de virar chunks+embeddings, o texto bruto
   * (que a extração simples de PDF costuma embaralhar quando tem tabela de
   * preços) passa pelo Claude, que reconstrói tabelas em texto legível
   * ("Unidade 201 - 2 quartos - 85m² - R$ 1.500.000"). É essa versão
   * reestruturada que vira a base de conhecimento, não o texto cru.
   *
   * Documentos grandes são processados em segmentos (uma chamada de IA por
   * pedaço de texto bruto), pra não estourar o limite de saída do modelo —
   * os resultados são concatenados na ordem original.
   */
  private async reestruturarTextoCompleto(textoBruto: string): Promise<string> {
    if (textoBruto.length <= TAMANHO_SEGMENTO_REESTRUTURACAO) {
      return reestruturarTextoDocumento(textoBruto);
    }

    const segmentos: string[] = [];
    for (let i = 0; i < textoBruto.length; i += TAMANHO_SEGMENTO_REESTRUTURACAO) {
      segmentos.push(textoBruto.slice(i, i + TAMANHO_SEGMENTO_REESTRUTURACAO));
    }

    const segmentosReestruturados: string[] = [];
    for (const segmento of segmentos) {
      // Sequencial (não Promise.all) de propósito — evita estourar rate
      // limit da API em documentos muito grandes com muitos segmentos.
      const resultado = await reestruturarTextoDocumento(segmento);
      segmentosReestruturados.push(resultado);
    }

    return segmentosReestruturados.join('\n\n');
  }

  private async extrairTexto(params: { origem: 'pdf' | 'url'; bufferPdf?: Buffer; url?: string }) {
    return params.origem === 'pdf'
      ? await extrairTextoDePdf(params.bufferPdf!)
      : await extrairTextoDeUrl(params.url!);
  }

  /**
   * Indexa um documento inteiro: extrai texto bruto → reestrutura via IA
   * (tabelas viram texto legível) → quebra em chunks → gera os embeddings
   * de todos de uma vez (mais barato que um por um) → salva.
   */
  async ingerirDocumento(params: {
    titulo: string;
    origem: 'pdf' | 'url';
    bufferPdf?: Buffer;
    url?: string;
  }) {
    const textoBruto = await this.extrairTexto(params);

    if (!textoBruto || textoBruto.trim().length < 20) {
      throw new Error('CONTEUDO_VAZIO');
    }

    const textoReestruturado = await this.reestruturarTextoCompleto(textoBruto);

    const chunks = this.dividirEmChunks(textoReestruturado);
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

  async simular(pergunta: string, historico: { autor: 'lead' | 'equipe'; texto: string }[] = []) {
    const perguntaParaBusca = await reescreverPergunta(historico, pergunta);
    const fontes = await this.buscarContextoComFontes(perguntaParaBusca);

    const resposta = await gerarRespostaRAG({
      perguntaDoLead: pergunta,
      contexto: fontes.map((f) => f.conteudo),
      historicoConversa: historico,
    });

    return {
      resposta,
      perguntaReescrita: perguntaParaBusca !== pergunta ? perguntaParaBusca : null,
      fontes: fontes.map((f) => ({
        conteudo: f.conteudo,
        tituloDocumento: f.tituloDocumento,
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

    const historico = lead.mensagens
      .reverse()
      .map((m) => ({ autor: (m.direcao === 'recebida' ? 'lead' : 'equipe') as 'lead' | 'equipe', texto: m.conteudo }));

    // Reescreve a pergunta ANTES de gerar o embedding de busca — evita
    // buscar contexto do imóvel/assunto errado quando o cliente usa
    // pronomes ("ele", "lá") referindo a algo já dito antes.
    const perguntaParaBusca = await reescreverPergunta(historico, mensagemDoLead);
    const contexto = await this.buscarContexto(perguntaParaBusca);

    return gerarRespostaRAG({
      perguntaDoLead: mensagemDoLead,
      contexto,
      historicoConversa: historico,
      nomeDoLead: lead.nome ?? undefined,
    });
  }
}
