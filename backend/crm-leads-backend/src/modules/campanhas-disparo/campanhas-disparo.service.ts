import { PrismaClient, Prisma } from '@prisma/client';
import { FiltroPublico, CriarCampanhaDisparoInput, AtualizarCampanhaDisparoInput } from './campanhas-disparo.schema';

export class CampanhasDisparoService {
  constructor(private prisma: PrismaClient) {}

  private construirWhere(filtro: FiltroPublico): Prisma.LeadWhereInput {
    const { busca, ...igualdades } = filtro;

    return {
      ...igualdades,
      ...(busca
        ? {
            OR: [
              { nome: { contains: busca, mode: 'insensitive' as const } },
              { telefone: { contains: busca } },
            ],
          }
        : {}),
    };
  }

  async contarPublico(filtro: FiltroPublico): Promise<number> {
    return this.prisma.lead.count({ where: this.construirWhere(filtro) });
  }

  async criar(input: CriarCampanhaDisparoInput, usuarioId: string) {
    const template = await this.prisma.templateMensagem.findUnique({
      where: { id: input.templateMensagemId },
    });

    if (!template) throw new Error('TEMPLATE_NAO_ENCONTRADO');
    if (!template.aprovadoMeta) throw new Error('TEMPLATE_NAO_APROVADO');

    const leadsAlvo = await this.prisma.lead.findMany({
      where: this.construirWhere(input.filtroPublico),
      select: { id: true },
    });

    if (leadsAlvo.length === 0) throw new Error('PUBLICO_VAZIO');

    return this.prisma.campanhaDisparo.create({
      data: {
        nome: input.nome,
        templateMensagemId: input.templateMensagemId,
        criadoPorUsuarioId: usuarioId,
        destinatarios: {
          create: leadsAlvo.map((lead) => ({ leadId: lead.id })),
        },
      },
      include: { templateMensagem: true, _count: { select: { destinatarios: true } } },
    });
  }

  async listar() {
    return this.prisma.campanhaDisparo.findMany({
      orderBy: { criadoEm: 'desc' },
      include: {
        templateMensagem: true,
        criadoPor: { select: { id: true, nome: true } },
        _count: { select: { destinatarios: true } },
      },
    });
  }

  async buscarPorId(id: string) {
    return this.prisma.campanhaDisparo.findUnique({
      where: { id },
      include: {
        templateMensagem: true,
        criadoPor: { select: { id: true, nome: true } },
        _count: { select: { destinatarios: true } },
        destinatarios: {
          take: 20,
          include: { lead: { select: { id: true, nome: true, telefone: true } } },
        },
      },
    });
  }

  async atualizar(id: string, input: AtualizarCampanhaDisparoInput) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'rascunho') throw new Error('CAMPANHA_NAO_EDITAVEL');

    if (input.templateMensagemId) {
      const template = await this.prisma.templateMensagem.findUnique({
        where: { id: input.templateMensagemId },
      });
      if (!template) throw new Error('TEMPLATE_NAO_ENCONTRADO');
      if (!template.aprovadoMeta) throw new Error('TEMPLATE_NAO_APROVADO');
    }

    return this.prisma.campanhaDisparo.update({ where: { id }, data: input });
  }

  async marcarComoPronta(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'rascunho') throw new Error('CAMPANHA_NAO_EDITAVEL');

    return this.prisma.campanhaDisparo.update({ where: { id }, data: { status: 'pronta' } });
  }

  async deletar(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'rascunho') throw new Error('CAMPANHA_NAO_EDITAVEL');

    await this.prisma.campanhaDisparo.delete({ where: { id } });
  }
}
