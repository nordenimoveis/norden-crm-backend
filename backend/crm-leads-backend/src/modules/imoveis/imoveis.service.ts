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
   * Monta a "string rica" descritiva usada como texto-fonte do embedding.
   * Baseada só em dados estruturados — a listagem de imóveis do Imobzi não
   * traz um campo de descrição/diferenciais (confirmado testando a API
   * real), então não há "texto livre" pra incluir aqui por enquanto.
   */
  private montarDescricaoRica(bruto: ImobziImovelRaw): string {
    const tipo = bruto.property_type || 'Imóvel';
    const nomeEmpreendimento = bruto.building_name ? ` no ${bruto.building_name}` : '';

    const caracteristicas = [
      `${tipo}${nomeEmpreendimento} localizado no bairro ${bruto.neighborhood ?? 'não informado'}`,
      bruto.area ? `com ${bruto.area} metros quadrados` : null,
      bruto.bedroom ? `${bruto.bedroom} quartos` : null,
      bruto.suite ? `sendo ${bruto.suite} suítes` : null,
      bruto.garage ? `${bruto.garage} vagas de garagem` : null,
    ]
      .filter(Boolean)
      .join(', ');

    // Alguns imóveis são só de aluguel (sale_value = 0, rental_value > 0)
    const ehAluguel = !bruto.sale_value && !!bruto.rental_value;
    const valorPrincipal = bruto.sale_value || bruto.rental_value || 0;
    const valorTexto = valorPrincipal
      ? `Valor de ${ehAluguel ? 'aluguel' : 'venda'}: R$ ${valorPrincipal.toLocaleString('pt-BR')}${ehAluguel ? '/mês' : ''}.`
      : '';

    return [`${caracteristicas}.`, valorTexto].filter(Boolean).join(' ');
  }

  /**
   * Sincronização unidirecional: Imobzi é a fonte da verdade, nosso
   * catálogo é o espelho. Upsert por `imobziId` (usamos `property_id` do
   * Imobzi) — se já existe, atualiza; se não existe, cria. Imóveis
   * marcados como indisponíveis são desativados aqui (não excluídos), e o
   * motor de match já ignora tudo que `ativo = false`.
   */
  async sincronizarComImobzi() {
    const imoveisRemotos = await buscarTodosImoveisImobzi();

    let novos = 0;
    let atualizados = 0;

    for (const bruto of imoveisRemotos) {
      const indisponivel = statusIndicaIndisponivel(bruto);
      const descricaoRica = this.montarDescricaoRica(bruto);
      const valorPrincipal = bruto.sale_value || bruto.rental_value || undefined;

      const dados = {
        titulo:
          bruto.building_name ||
          `${bruto.property_type ?? 'Imóvel'} - ${bruto.neighborhood ?? bruto.code ?? bruto.property_id}`,
        bairro: bruto.neighborhood,
        cidade: bruto.city || 'Florianópolis',
        valor: valorPrincipal,
        metragem: bruto.area ? Math.round(bruto.area) : undefined,
        quartos: bruto.bedroom,
        descricao: descricaoRica,
        fotoUrl: bruto.cover_photo?.url,
        ativo: !indisponivel,
        imobziId: bruto.property_id,
      };

      const existente = await this.prisma.imovel.findUnique({
        where: { imobziId: bruto.property_id },
      });

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
