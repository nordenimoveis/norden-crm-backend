import { PrismaClient } from '@prisma/client';
import { gerarEmbeddingUnico } from '@/lib/embeddings';
import { extrairTextoDePdf, extrairTextoDeUrl } from '@/lib/extracao-texto';
import { extrairDadosImovel, DadosImovelExtraidos } from '@/lib/claude-rag';
import {
  buscarTodosImoveisImobzi,
  statusIndicaIndisponivel,
  ImobziImovelRaw,
} from '@/lib/imobzi-imoveis-api';
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

  async registrarVisualizacao(leadId: string, imovelId: string) {
    await this.prisma.imovelVisualizacao.create({ data: { leadId, imovelId } });
  }

  // ---------------------------------------------------------------------
  // Integração Imobzi -> Norden CRM (unidirecional)
  // ---------------------------------------------------------------------

  /**
   * Monta a "string rica" descritiva usada como texto-fonte do embedding —
   * é isso que faz o motor de busca semântica conseguir responder sobre
   * imóveis vindos do Imobzi com a mesma qualidade dos cadastrados manualmente.
   */
  private montarDescricaoRica(bruto: ImobziImovelRaw): string {
    const caracteristicas = [
      `Apartamento localizado no bairro ${bruto.bairro ?? 'não informado'}`,
      bruto.metragem ? `com ${bruto.metragem} metros quadrados` : null,
      bruto.quartos ? `${bruto.quartos} quartos` : null,
      bruto.suites ? `sendo ${bruto.suites} suítes` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const valorTexto = bruto.valor
      ? `Valor de venda: R$ ${bruto.valor.toLocaleString('pt-BR')}.`
      : '';
    const diferenciais = bruto.descricao ? `Diferenciais: ${bruto.descricao}` : '';

    return [`${caracteristicas}.`, valorTexto, diferenciais].filter(Boolean).join(' ');
  }

  /**
   * Sincronização unidirecional: Imobzi é a fonte da verdade, nosso
   * catálogo é o espelho. Upsert por `imobziId` — se já existe, atualiza;
   * se não existe, cria. Imóveis marcados como vendido/inativo no Imobzi
   * são desativados aqui (não excluídos — o histórico de match continua
   * íntegro), e o motor de match já ignora tudo que `ativo = false`.
   */
  async sincronizarComImobzi() {
    const imoveisRemotos = await buscarTodosImoveisImobzi();

    let novos = 0;
    let atualizados = 0;

    for (const bruto of imoveisRemotos) {
      const indisponivel = statusIndicaIndisponivel(bruto.status);
      const descricaoRica = this.montarDescricaoRica(bruto);

      const dados = {
        titulo: bruto.titulo || `Imóvel ${bruto.id}`,
        bairro: bruto.bairro,
        cidade: bruto.cidade || 'Florianópolis',
        valor: bruto.valor,
        metragem: bruto.metragem,
        quartos: bruto.quartos,
        descricao: descricaoRica,
        fotoUrl: bruto.foto_url,
        ativo: !indisponivel,
        imobziId: bruto.id,
      };

      const existente = await this.prisma.imovel.findUnique({ where: { imobziId: bruto.id } });

      const imovelSalvo = existente
        ? await this.prisma.imovel.update({ where: { id: existente.id }, data: dados })
        : await this.prisma.imovel.create({ data: dados });

      if (existente) atualizados++;
      else novos++;

      // Reindexa sempre — a descrição rica muda a cada sync (preço,
      // disponibilidade), então o embedding precisa acompanhar.
      await this.reindexar(imovelSalvo.id, imovelSalvo);
    }

    return { novos, atualizados, total: imoveisRemotos.length };
  }
}
