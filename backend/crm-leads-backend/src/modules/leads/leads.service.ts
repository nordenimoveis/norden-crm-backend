import { PrismaClient, Lead, Prisma } from '@prisma/client';
import {
  CriarLeadInput,
  ImobziWebhookLeadInput,
  ImobziLeadLegadoInput,
  AtualizarLeadInput,
  AtualizarStatusInput,
  AtualizarTemperaturaInput,
  AtribuirCorretorInput,
  ListarLeadsQuery,
} from './leads.schema';
import { CadenciasService } from '@/modules/cadencias/cadencias.service';
import { RoundRobinService } from '@/lib/round-robin';
import { notificarLeadAtualizado } from '@/lib/pusher';

export type UsuarioAutenticado = { sub: string; papel: 'gestor' | 'corretor' | 'admin' };

export class LeadsService {
  private cadenciasService: CadenciasService;
  private roundRobinService: RoundRobinService;

  constructor(private prisma: PrismaClient) {
    this.cadenciasService = new CadenciasService(prisma);
    this.roundRobinService = new RoundRobinService(prisma);
  }

  /**
   * Fluxo "ativo": round-robin + início imediato da cadência. Usado pelos
   * dois pontos de entrada de lead NOVO (Meta Ads e o webhook do Imobzi) —
   * a lógica de negócio é idêntica, só muda de onde o dado chega.
   */
  private async criarLeadEIniciarFluxoAtivo(dados: {
    nome?: string;
    telefone: string;
    email?: string;
    campanhaId?: string;
    imovelId?: string;
    origem: 'meta_ads' | 'site_imobzi';
    imobziId?: string;
    payloadBruto?: Record<string, unknown>;
  }): Promise<Lead> {
    const corretorId = await this.roundRobinService.proximoCorretor();

    const lead = await this.prisma.lead.create({
      data: {
        ...dados,
        corretorId,
        payloadBruto: dados.payloadBruto as Prisma.InputJsonValue | undefined,
      },
    });

    await this.cadenciasService.iniciarCadenciaParaLead(lead.id);

    await notificarLeadAtualizado({
      id: lead.id,
      status: lead.status,
      atendimentoHumano: lead.atendimentoHumano,
      corretorId: lead.corretorId,
      temperatura: lead.temperatura,
    });

    return lead;
  }

  /** Entrada 1: lead do Meta Ads/Instagram (via meta-ads.service). */
  async criar(input: CriarLeadInput) {
    const existente = await this.prisma.lead.findFirst({
      where: { telefone: input.telefone, campanhaId: input.campanhaId ?? null },
    });
    if (existente) return existente;

    return this.criarLeadEIniciarFluxoAtivo({
      nome: input.nome,
      telefone: input.telefone,
      email: input.email,
      campanhaId: input.campanhaId,
      imovelId: input.imovelId,
      origem: 'meta_ads',
      imobziId: input.imobziId,
      payloadBruto: input.payloadBruto,
    });
  }

  /**
   * Entrada 2 (Imobzi — Rota "Ativa"): novo lead do site, que hoje cai
   * primeiro no Imobzi. Quando o Imobzi nos avisa via webhook, o lead
   * PRECISA passar pelo round-robin e disparar o Passo 1 imediatamente —
   * mesma regra de negócio do Meta Ads, só muda a origem e o identificador.
   */
  async criarDeImobziWebhook(input: ImobziWebhookLeadInput) {
    const existente = await this.prisma.lead.findUnique({ where: { imobziId: input.imobzi_id } });
    if (existente) return existente;

    return this.criarLeadEIniciarFluxoAtivo({
      nome: input.nome,
      telefone: input.telefone,
      email: input.email,
      origem: 'site_imobzi',
      imobziId: input.imobzi_id,
      payloadBruto: input as unknown as Record<string, unknown>,
    });
  }

  /**
   * Entrada 3 (Imobzi — Rota "Passiva"): importação em lote da base antiga.
   * REGRA CRÍTICA DE NEGÓCIO: estes leads NUNCA passam pelo round-robin
   * e NUNCA disparam a cadência do WhatsApp.
   */
  async importarLeadLegado(input: ImobziLeadLegadoInput) {
    const existente = await this.prisma.lead.findUnique({ where: { imobziId: input.id } });
    if (existente) return { lead: existente, criado: false };

    const lead = await this.prisma.lead.create({
      data: {
        nome: input.name ?? undefined,
        telefone: input.phone,
        email: input.email ?? undefined,
        origem: 'legado_imobzi',
        imobziId: input.id,
        status: 'novo',
      },
    });

    return { lead, criado: true };
  }

  async listar(query: ListarLeadsQuery, usuario: UsuarioAutenticado) {
    const { page, pageSize, busca, ...filtros } = query;

    if (usuario.papel === 'corretor') {
      filtros.corretorId = usuario.sub;
    }

    const where = {
      ...filtros,
      ...(busca
        ? {
            OR: [
              { nome: { contains: busca, mode: 'insensitive' as const } },
              { telefone: { contains: busca } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { campanha: true, imovel: true, corretor: true },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async buscarPorId(id: string, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        campanha: true,
        imovel: true,
        corretor: true,
        mensagens: { orderBy: { criadoEm: 'asc' }, include: { enviadaPorUsuario: true } },
        execucoesCadencia: true,
      },
    });

    if (!lead) return null;
    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

    return lead;
  }

  async atualizar(id: string, input: AtualizarLeadInput) {
    return this.prisma.lead.update({ where: { id }, data: input });
  }

  async atualizarStatus(id: string, input: AtualizarStatusInput, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

    const atualizado = await this.prisma.lead.update({
      where: { id },
      data: {
        status: input.status,
        atendimentoHumano: input.status === 'respondeu' ? lead.atendimentoHumano : false,
      },
    });

    await notificarLeadAtualizado({
      id: atualizado.id,
      status: atualizado.status,
      atendimentoHumano: atualizado.atendimentoHumano,
      corretorId: atualizado.corretorId,
      temperatura: atualizado.temperatura,
    });

    return atualizado;
  }

  async atualizarTemperatura(id: string, input: AtualizarTemperaturaInput, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

    const atualizado = await this.prisma.lead.update({
      where: { id },
      data: { temperatura: input.temperatura },
    });

    await notificarLeadAtualizado({
      id: atualizado.id,
      status: atualizado.status,
      atendimentoHumano: atualizado.atendimentoHumano,
      corretorId: atualizado.corretorId,
      temperatura: atualizado.temperatura,
    });

    return atualizado;
  }

  async atribuirCorretor(id: string, input: AtribuirCorretorInput) {
    const corretorDestino = await this.prisma.usuario.findUnique({
      where: { id: input.corretorId },
    });

    if (!corretorDestino || corretorDestino.papel !== 'corretor' || !corretorDestino.ativo) {
      throw new Error('CORRETOR_INVALIDO');
    }

    const atualizado = await this.prisma.lead.update({
      where: { id },
      data: { corretorId: input.corretorId },
    });

    await notificarLeadAtualizado({
      id: atualizado.id,
      status: atualizado.status,
      atendimentoHumano: atualizado.atendimentoHumano,
      corretorId: atualizado.corretorId,
      temperatura: atualizado.temperatura,
    });

    return atualizado;
  }
}
