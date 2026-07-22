import { PrismaClient, Prisma } from '@prisma/client';
import { FiltroPublico, CriarCampanhaDisparoInput, AtualizarCampanhaDisparoInput } from './campanhas-disparo.schema';
import { enfileirarDestinatarios } from '@/queues/campanha-disparo.queue';

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
    if (!template.metaTemplateName) throw new Error('TEMPLATE_SEM_NOME_META');

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
    const [campanha, contagemPorStatus] = await Promise.all([
      this.prisma.campanhaDisparo.findUnique({
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
      }),
      this.prisma.campanhaDisparoLead.groupBy({
        by: ['status'],
        where: { campanhaDisparoId: id },
        _count: true,
      }),
    ]);

    if (!campanha) return null;

    const progresso = { pendente: 0, enviado: 0, falhou: 0 };
    for (const grupo of contagemPorStatus) {
      progresso[grupo.status as keyof typeof progresso] = grupo._count;
    }

    return { ...campanha, progresso };
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

  async iniciarEnvio(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({
      where: { id },
      include: { templateMensagem: true },
    });

    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'pronta') throw new Error('CAMPANHA_NAO_ESTA_PRONTA');
    if (!campanha.templateMensagem.aprovadoMeta || !campanha.templateMensagem.metaTemplateName) {
      throw new Error('TEMPLATE_SEM_NOME_META');
    }

    const destinatarios = await this.prisma.campanhaDisparoLead.findMany({
      where: { campanhaDisparoId: id, status: 'pendente' },
      select: { id: true },
    });

    if (destinatarios.length === 0) throw new Error('PUBLICO_VAZIO');

    await this.prisma.campanhaDisparo.update({ where: { id }, data: { status: 'enviando' } });

    await enfileirarDestinatarios(
      id,
      destinatarios.map((d) => d.id)
    );

    return
