import { PrismaClient, Prisma } from '@prisma/client';
import { FiltroPublico, CriarCampanhaDisparoInput, AtualizarCampanhaDisparoInput } from './campanhas-disparo.schema';
import { enfileirarDestinatarios } from '@/queues/campanha-disparo.queue';

export class CampanhasDisparoService {
  constructor(private prisma: PrismaClient) {}

  /** Monta o `where` do Prisma a partir do filtro de público — mesma lógica de "Meus Leads". */
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

  /**
   * Só CONTA quantos leads bateriam com o filtro — usado pelo editor para
   * mostrar "1.234 destinatários" em tempo real, sem criar nada ainda.
   */
  async contarPublico(filtro: FiltroPublico): Promise<number> {
    return this.prisma.lead.count({ where: this.construirWhere(filtro) });
  }

  /**
   * Cria a campanha como rascunho e "congela" o público: os leads que batem
   * com o filtro NESTE MOMENTO viram linhas em `CampanhaDisparoLead`. Se
   * novos leads passarem a bater com o mesmo filtro depois, eles NÃO entram
   * sozinhos — isso mantém o envio prévisível e auditável (quem decidiu
   * revisar antes de mandar sabe exatamente para quem vai).
   */
  async criar(input: CriarCampanhaDisparoInput, usuarioId: string) {
    const template = await this.prisma.templateMensagem.findUnique({
      where: { id: input.templateMensagemId },
    });

    if (!template) throw new Error('TEMPLATE_NAO_ENCONTRADO');
    if (!template.aprovadoMeta) throw new Error('TEMPLATE_NAO_APROVADO');
    if (!template.metaTemplateName) throw new Error('TEMPLATE_SEM_NOME_META');

    // Coerência entre o template e a mídia: se o template TEM cabeçalho de
    // mídia (aprovado assim na Meta), a campanha PRECISA de uma mídia
    // anexada — senão o envio real vai falhar na API do WhatsApp. Se o
    // template NÃO tem cabeçalho, não faz sentido anexar mídia (seria
    // ignorada, ou pior, causaria erro por não bater com o template aprovado).
    if (template.midiaTipo && !input.midiaUrl) {
      throw new Error('MIDIA_OBRIGATORIA');
    }
    if (!template.midiaTipo && input.midiaUrl) {
      throw new Error('TEMPLATE_SEM_CABECALHO_MIDIA');
    }

    const leadsAlvo = await this.prisma.lead.findMany({
      where: this.construirWhere(input.filtroPublico),
      select: { id: true },
    });

    if (leadsAlvo.length === 0) throw new Error('PUBLICO_VAZIO');

    return this.prisma.campanhaDisparo.create({
      data: {
        nome: input.nome,
        templateMensagemId: input.templateMensagemId,
        midiaUrl: input.midiaUrl,
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
          // Amostra dos destinatários — lista completa não é útil na tela,
          // só a contagem e alguns exemplos para conferência visual.
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

  /** Só rascunho pode ser editado — depois de "pronta" o público já foi decidido. */
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

  /** Marca como "pronta" — sinaliza que a revisão terminou (o motor de disparo, Peça 4, consome esse status). */
  async marcarComoPronta(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'rascunho') throw new Error('CAMPANHA_NAO_EDITAVEL');

    return this.prisma.campanhaDisparo.update({ where: { id }, data: { status: 'pronta' } });
  }

  /**
   * Inicia o envio de verdade: marca a campanha como 'enviando' e enfileira
   * cada destinatário (escalonado no tempo — ver campanha-disparo.queue.ts).
   * O worker é quem realmente dispara as mensagens e atualiza o progresso.
   */
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

    return this.buscarPorId(id);
  }

  /** Só rascunho pode ser apagado — depois disso, vira histórico. */
  async deletar(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'rascunho') throw new Error('CAMPANHA_NAO_EDITAVEL');

    await this.prisma.campanhaDisparo.delete({ where: { id } });
  }
}
