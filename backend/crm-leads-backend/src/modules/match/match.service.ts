import { PrismaClient, Imovel } from '@prisma/client';
import { gerarEmbeddingUnico } from '@/lib/embeddings';

type PerfilBusca = {
  bairro?: string;
  orcamentoMin?: number;
  orcamentoMax?: number;
  quartos?: number;
  finalidade?: 'moradia' | 'investimento';
} | null;

export type MatchImovel = {
  imovel: Imovel;
  matchScore: number; // 0-100
  motivo: string;
};

const TOP_K_MATCHES = 3;

export class MatchService {
  constructor(private prisma: PrismaClient) {}

  private construirTextoDeBusca(perfilBusca: PerfilBusca, perfilSemantico: string | null): string {
    const partes = [
      perfilSemantico,
      perfilBusca?.bairro ? `Busca em: ${perfilBusca.bairro}` : null,
      perfilBusca?.orcamentoMin || perfilBusca?.orcamentoMax
        ? `Orçamento: ${perfilBusca.orcamentoMin ?? 0} a ${perfilBusca.orcamentoMax ?? 'sem limite'}`
        : null,
      perfilBusca?.quartos ? `${perfilBusca.quartos} quartos` : null,
      perfilBusca?.finalidade ? `Finalidade: ${perfilBusca.finalidade}` : null,
    ].filter(Boolean);

    return partes.join('. ');
  }

  /**
   * Motivo do match é DETERMINÍSTICO (comparação direta de campos
   * estruturados), não gerado por LLM — mais barato, auditável, e não
   * depende de mais uma chamada de IA por card exibido. A similaridade
   * semântica (pgvector) já cuidou de achar os imóveis parecidos; aqui só
   * explicamos em palavras o que bateu.
   */
  private gerarMotivo(perfilBusca: PerfilBusca, imovel: Imovel): string {
    const motivos: string[] = [];

    if (perfilBusca?.bairro && imovel.bairro?.toLowerCase().includes(perfilBusca.bairro.toLowerCase())) {
      motivos.push(`fica em ${imovel.bairro}, que é onde você busca`);
    }

    if (perfilBusca?.quartos && imovel.quartos === perfilBusca.quartos) {
      motivos.push(`tem exatamente ${imovel.quartos} quartos`);
    }

    const valorImovel = imovel.valor ? Number(imovel.valor) : null;
    if (valorImovel && (perfilBusca?.orcamentoMin || perfilBusca?.orcamentoMax)) {
      const dentroDoOrcamento =
        (!perfilBusca.orcamentoMin || valorImovel >= perfilBusca.orcamentoMin) &&
        (!perfilBusca.orcamentoMax || valorImovel <= perfilBusca.orcamentoMax);
      if (dentroDoOrcamento) motivos.push('está dentro do seu orçamento');
    }

    if (motivos.length === 0) {
      return 'Compatível com o perfil de busca, considerando as características descritas';
    }

    // "fica em X, que é onde você busca, tem exatamente 3 quartos, e está dentro do seu orçamento"
    const combinado = motivos.join(', ');
    return `Combina porque ${combinado}`;
  }

  async buscarMatches(leadId: string): Promise<MatchImovel[]> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    const perfilBusca = lead.perfilBusca as PerfilBusca;
    const textoBusca = this.construirTextoDeBusca(perfilBusca, lead.perfilSemantico);

    if (!textoBusca.trim()) {
      throw new Error('PERFIL_INCOMPLETO');
    }

    const embeddingBusca = await gerarEmbeddingUnico(textoBusca, 'query');
    const vetorLiteral = `[${embeddingBusca.join(',')}]`;

    const resultados = await this.prisma.$queryRawUnsafe<
      (Omit<Imovel, 'embedding'> & { distancia: number })[]
    >(
      `SELECT id, titulo, bairro, cidade, valor, metragem, quartos, descricao,
              foto_url AS "fotoUrl", referencia_externa AS "referenciaExterna",
              ativo, criado_em AS "criadoEm",
              embedding <=> $1::vector AS distancia
       FROM imoveis
       WHERE ativo = true AND embedding IS NOT NULL
       ORDER BY distancia ASC
       LIMIT $2`,
      vetorLiteral,
      TOP_K_MATCHES
    );

    return resultados.map((imovel) => {
      const { distancia, ...dadosImovel } = imovel;
      const matchScore = Math.round(Math.max(0, Math.min(1, 1 - distancia)) * 100);
      return {
        imovel: dadosImovel as Imovel,
        matchScore,
        motivo: this.gerarMotivo(perfilBusca, dadosImovel as Imovel),
      };
    });
  }
}
