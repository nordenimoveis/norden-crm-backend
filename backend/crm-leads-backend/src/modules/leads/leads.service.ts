import { PrismaClient, Lead, Prisma } from '@prisma/client';
import {
  CriarLeadInput,
  CriarLeadManualInput,
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
import { normalizarTelefone } from '@/lib/normalizar-telefone';

export type UsuarioAutenticado = { sub: string; papel: 'gestor' | 'corretor' | 'admin' };

export class LeadsService {
  private cadenciasService: CadenciasService;
  private roundRobinService: RoundRobinService;

  constructor(private prisma: PrismaClient) {
    this.cadenciasService = new CadenciasService(prisma);
    this.roundRobinService = new RoundRobinService(prisma);
  }

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

  async criarManual(input: CriarLeadManualInput) {
    const telefoneNormalizado = normalizarTelefone(input.telefone);
    if (!telefoneNormalizado) throw new Error('TELEFONE_INVALIDO');

    const existente = await this.prisma.lead.findFirst({ where: { telefone: telefoneNormalizado } });
    if (existente) throw new Error('LEAD_JA_EXISTE');

    let corretorId: string | null | undefined = input.corretorId;

    if (corretorId) {
      const corretor = await this.prisma.usuario.findUnique({ where: { id: corretorId } });
      if (!corretor || corretor.papel !== 'corretor' || !corretor.ativo) {
        throw new Error('CORRETOR_INVALIDO');
      }
    } else {
      corretorId = await this.roundRobinService.proximoCorretor();
    }

    const lead = await this.prisma.lead.create({
      data: {
        nome: input.nome,
        telefone: telefoneNormalizado,
        email: input.email,
        origem: 'manual',
        status: 'novo',
        corretorId,
      },
    });

    await notificarLeadAtualizado({
      id: lead.id,
      status: lead.status,
      atendimentoHumano: lead.atendimentoHumano,
      corretorId: lead.corretorId,
      temperatura: lead.temperatura,
    });

    return lead;
  }

  private readonly STATUS_SEM_ALERTA = ['perdido', 'negocio_fechado', 'frio_standby'];
  private readonly LIMITE_AGUARDANDO_RESPOSTA_HORAS = 4;
  private readonly LIMITE_SEM_ATIVIDADE_HORAS = 72;

  private calcularAlerta(
    status: string,
    ultimaMensagem: { direcao: string; criadoEm: Date } | null,
    criadoEm: Date
  ): { tipo: 'aguardando_resposta' | 'sem_atividade' | null; horasParado: number | null } {
    if (this.STATUS_SEM_ALERTA.includes(status)) {
      return { tipo: null, horasParado: null };
    }

    const referencia = ultimaMensagem?.criadoEm ?? criadoEm;
    const horasParado = (Date.now() - referencia.getTime()) / (1000 * 60 * 60);

    if (ultimaMensagem?.direcao === 'recebida' && horasParado >= this.LIMITE_AGUARDANDO_RESPOSTA_HORAS) {
      return { tipo: 'aguardando_resposta', horasParado: Math.floor(horasParado) };
    }

    if (horasParado >= this.LIMITE_SEM_ATIVIDADE_HORAS) {
      return { tipo: 'sem_atividade', horasParado: Math.floor(horasParado) };
    }

    return { tipo: null, horasParado: Math.floor(horasParado) };
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

    const [itemsBrutos, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          campanha: true,
          imovel: true,
          corretor: true,
          mensagens: { orderBy: { criadoEm: 'desc' }, take: 1 },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    const items = itemsBrutos.map((lead) => {
      const { mensagens, ...resto } = lead;
      const alerta = this.calcularAlerta(lead.status, mensagens[0] ?? null, lead.criadoEm);
      return { ...resto, alerta: alerta.tipo, horasParado: alerta.horasParado };
    });

    return { items, total, page, pageSize };
  }

  async listarAgendamentos(usuario: UsuarioAutenticado) {
    const where: Prisma.LeadWhereInput = {
      dataAgendamento: { not: null },
    };

    if (usuario.papel === 'corretor') {
      where.corretorId = usuario.sub;
    }

    return this.prisma.lead.findMany({
      where,
      orderBy: { dataAgendamento: 'asc' },
      include: { corretor: true, imovel: true },
    });
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

  async atualizar(id: string, input: AtualizarLeadInput, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

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
