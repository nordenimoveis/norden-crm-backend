import { PrismaClient, Prisma } from '@prisma/client';
import {
  FiltroPublico,
  CriarCampanhaDisparoInput,
  AtualizarCampanhaDisparoInput,
  EnviarTesteInput,
} from './campanhas-disparo.schema';
import {
  enfileirarDestinatarios,
  agendarInicioCampanha,
  cancelarInicioCampanha,
} from '@/queues/campanha-disparo.queue';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';

export class CampanhasDisparoService {
  private whatsappService: WhatsappService;

  constructor(private prisma: PrismaClient) {
    this.whatsappService = new WhatsappService(prisma);
  }

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
        parametros: (input.parametros ?? undefined) as Prisma.InputJsonValue | undefined,
        criadoPorUsuarioId: usuarioId,
        destinatarios: {
          create: leadsAlvo.map((lead) => ({ leadId: lead.id })),
        },
      },
      include: { templateMensagem: true, _count: { select: { destinatarios: true } } },
    });
  }

  /**
   * Envio TESTE: manda o template para UM número (o seu), sem criar campanha
   * nem tocar no público. Serve para conferir texto/mídia/variáveis antes do
   * disparo real. Aplica as mesmas travas de coerência template x mídia.
   */
  async enviarTeste(input: EnviarTesteInput) {
    const template = await this.prisma.templateMensagem.findUnique({
      where: { id: input.templateMensagemId },
    });
    if (!template) throw new Error('TEMPLATE_NAO_ENCONTRADO');
    if (!template.aprovadoMeta || !template.metaTemplateName) throw new Error('TEMPLATE_NAO_APROVADO');
    if (template.midiaTipo && !input.midiaUrl) throw new Error('MIDIA_OBRIGATORIA');
    if (!template.midiaTipo && input.midiaUrl) throw new Error('TEMPLATE_SEM_CABECALHO_MIDIA');

    const messageId = await this.whatsappService.enviarTemplateTeste({
      telefone: input.telefone,
      nomeTemplate: template.metaTemplateName,
      idioma: template.idioma,
      parametros: input.parametros,
      midiaUrl: input.midiaUrl,
      midiaTipo: template.midiaTipo ?? undefined,
    });

    return { enviado: Boolean(messageId), messageId };
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

    const data: Prisma.CampanhaDisparoUpdateInput = {};
    if (input.nome !== undefined) data.nome = input.nome;
    if (input.templateMensagemId !== undefined) {
      data.templateMensagem = { connect: { id: input.templateMensagemId } };
    }
    if (input.midiaUrl !== undefined) data.midiaUrl = input.midiaUrl;
    if (input.parametros !== undefined) {
      data.parametros = input.parametros as Prisma.InputJsonValue;
    }

    return this.prisma.campanhaDisparo.update({ where: { id }, data });
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
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    // Aceita 'pronta' (envio manual agora) OU 'agendada' (o worker chama isto
    // na hora marcada). Qualquer outro status não pode iniciar disparo.
    if (campanha.status !== 'pronta' && campanha.status !== 'agendada') {
      throw new Error('CAMPANHA_NAO_ESTA_PRONTA');
    }
    return this.dispararAgora(id);
  }

  /**
   * Núcleo do disparo (compartilhado pelo envio manual e pelo agendado):
   * valida o template, marca 'enviando' e enfileira os destinatários.
   */
  private async dispararAgora(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({
      where: { id },
      include: { templateMensagem: true },
    });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (!campanha.templateMensagem.aprovadoMeta || !campanha.templateMensagem.metaTemplateName) {
      throw new Error('TEMPLATE_SEM_NOME_META');
    }

    const destinatarios = await this.prisma.campanhaDisparoLead.findMany({
      where: { campanhaDisparoId: id, status: 'pendente' },
      select: { id: true },
    });
    if (destinatarios.length === 0) throw new Error('PUBLICO_VAZIO');

    await this.prisma.campanhaDisparo.update({
      where: { id },
      data: { status: 'enviando', jobAgendamentoId: null },
    });

    await enfileirarDestinatarios(
      id,
      destinatarios.map((d) => d.id)
    );

    return this.buscarPorId(id);
  }

  /** Chamado pelo worker quando o job de início agendado dispara. */
  async dispararAgendada(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha || campanha.status !== 'agendada') return; // cancelada/alterada nesse meio-tempo
    await this.dispararAgora(id);
  }

  /**
   * Agenda o disparo para uma data/hora futura. A campanha precisa estar
   * 'pronta' (público já congelado e revisado). Cria um job atrasado e guarda
   * o id para permitir cancelar.
   */
  async agendar(id: string, agendadoPara: Date) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'pronta') throw new Error('CAMPANHA_NAO_ESTA_PRONTA');
    if (agendadoPara.getTime() <= Date.now()) throw new Error('DATA_NO_PASSADO');

    const jobId = await agendarInicioCampanha(id, agendadoPara);

    await this.prisma.campanhaDisparo.update({
      where: { id },
      data: { status: 'agendada', agendadoPara, jobAgendamentoId: jobId },
    });

    return this.buscarPorId(id);
  }

  /** Cancela um agendamento (volta para 'pronta'). */
  async cancelarAgendamento(id: string) {
    const campanha = await this.prisma.campanhaDisparo.findUnique({ where: { id } });
    if (!campanha) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (campanha.status !== 'agendada') throw new Error('CAMPANHA_NAO_AGENDADA');

    if (campanha.jobAgendamentoId) await cancelarInicioCampanha(campanha.jobAgendamentoId);

    await this.prisma.campanhaDisparo.update({
      where: { id },
      data: { status: 'pronta', agendadoPara: null, jobAgendamentoId: null },
    });

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
