import { PrismaClient } from '@prisma/client';
import { gerarEmbeddingUnico } from '@/lib/embeddings';
import { extrairTextoDePdf, extrairTextoDeUrl } from '@/lib/extracao-texto';
import { extrairDadosImovel, DadosImovelExtraidos } from '@/lib/claude-rag';
import { CriarImovelInput, AtualizarImovelInput } from './imoveis.schema';

export class ImoveisService {
  constructor(private prisma: PrismaClient) {}

  private textoParaEmbedding(dados: {
    titulo: string;
    bairro?: string | null;
    cidade?: string | null;
    metragem?: number | null;
    quartos?: number | null;
    descricao?: string | null;
  }): string {
    return [
      dados.titulo,
      dados.bairro ? `Bairro: ${dados.bairro}` : null,
      dados.cidade ? `Cidade: ${dados.cidade}` : null,
      dados.metragem ? `${dados.metragem}m²` : null,
      dados.quartos ? `${dados.quartos} quartos` : null,
      dados.descricao,
    ]
      .filter(Boolean)
      .join('. ');
  }

  /**
   * Recalcula o embedding do imóvel a partir dos campos que descrevem ele
   * (título, bairro, quartos, descrição). Chamada depois de criar/editar —
   * se a Voyage não estiver configurada, não quebra o cadastro, só deixa
   * esse imóvel de fora do match até a chave ser configurada.
   */
  private async reindexar(imovelId: string, dados: Parameters<typeof this.textoParaEmbedding>[0]) {
    try {
      const texto = this.textoParaEmbedding(dados);
      const embedding = await gerarEmbeddingUnico(texto, 'document');
      const vetorLiteral = `[${embedding.join(',')}]`;

      await this.prisma.$executeRawUnsafe(
        `UPDATE imoveis SET embedding = $1::vector WHERE id = $2`,
        vetorLiteral,
        imovelId
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[imoveis] Falha ao reindexar embedding do imóvel ${imovelId}:`, err);
    }
  }

  async listar(incluirInativos = false) {
    return this.prisma.imovel.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: { criadoEm: 'desc' },
    });
  }

  async buscarPorId(id: string) {
    return this.prisma.imovel.findUnique({ where: { id } });
  }

  async criar(input: CriarImovelInput) {
    const imovel = await this.prisma.imovel.create({ data: input });
    await this.reindexar(imovel.id, imovel);
    return imovel;
  }

  async atualizar(id: string, input: AtualizarImovelInput) {
    const imovel = await this.prisma.imovel.update({ where: { id }, data: input });

    // Só reindexar se algum campo que entra no texto do embedding mudou —
    // evita chamada desnecessária à Voyage quando só o `ativo` ou o preço
    // (que não entra no texto) foi alterado. Simplificação razoável: sempre
    // que qualquer um dos campos relevantes vier no input, reindexar.
    if (
      input.titulo !== undefined ||
      input.bairro !== undefined ||
      input.cidade !== undefined ||
      input.metragem !== undefined ||
      input.quartos !== undefined ||
      input.descricao !== undefined
    ) {
      await this.reindexar(imovel.id, imovel);
    }

    return imovel;
  }

  async deletar(id: string) {
    await this.prisma.imovel.delete({ where: { id } });
  }

  /**
   * Lê um PDF/URL de anúncio e devolve os campos já extraídos pela IA —
   * NÃO salva sozinho no catálogo. O front usa isso pra pré-preencher o
   * formulário de cadastro, e o corretor revisa/ajusta antes de confirmar.
   */
  async extrairDadosDeDocumento(params: {
    origem: 'pdf' | 'url';
    bufferPdf?: Buffer;
    url?: string;
  }): Promise<DadosImovelExtraidos> {
    const texto =
      params.origem === 'pdf'
        ? await extrairTextoDePdf(params.bufferPdf!)
        : await extrairTextoDeUrl(params.url!);

    if (!texto || texto.trim().length < 20) {
      throw new Error('CONTEUDO_VAZIO');
    }

    return extrairDadosImovel(texto);
  }

  /** Registra que um LEAD específico visualizou um imóvel — soma score e vira histórico de interesse. */
  async registrarVisualizacao(leadId: string, imovelId: string) {
    await this.prisma.imovelVisualizacao.create({ data: { leadId, imovelId } });
  }
}
