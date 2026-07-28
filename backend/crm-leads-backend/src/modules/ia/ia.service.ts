import { PrismaClient } from '@prisma/client';
import { gerarEmbeddings, gerarEmbeddingUnico } from '@/lib/embeddings';
import { gerarRespostaRAG, reestruturarTextoDocumento } from '@/lib/claude-rag';
import { extrairTextoDePdf, extrairTextoDeUrl } from '@/lib/extracao-texto';

const TAMANHO_CHUNK = 1000;
const SOBREPOSICAO_CHUNK = 150;
const TOP_K_CONTEXTO = 5;
const TAMANHO_SEGMENTO_REESTRUTURACAO = 12000;

export class IaService {
  constructor(private prisma: PrismaClient) {}

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

  private async buscarContextoComFontes(pergunta: string) {
    const embeddingPergunta = await gerarEmbeddingUnico(pergunta, 'query');
    const vetorLiteral = `[${embeddingPergunta.join(',')}]`;

    type LinhaFonte = { conteudo: string; tituloDocumento: string; distancia: number };

    return this.prisma.$queryRawUnsafe<LinhaFonte[]>(
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
        similaridade: Math.round(Math.max(0, Math.min(1, 1 - f.distancia)) * 100),
      })),
    };
  }

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
