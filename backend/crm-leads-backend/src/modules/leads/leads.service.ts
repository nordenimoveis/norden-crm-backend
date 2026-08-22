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
import { incrementarScore } from '@/lib/score.service';
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
        // Prisma tipa campos Json como Prisma.InputJsonValue, que não aceita
        // diretamente um Record<string, unknown> genérico — cast explícito
        // é a forma correta (não um "any" escondido: o valor real já é um
        // objeto JSON serializável, só a tipagem do Prisma é mais estrita).
        payloadBruto: dados.payloadBruto as Prisma.InputJsonValue | undefined,
      },
    });

    // Regra de negócio explícita (Fase 5 + Imobzi): todo lead que passa por
    // aqui DEVE ser distribuído (já feito acima) e DEVE disparar o Passo 1
    // imediatamente — diferente do fluxo passivo de importação da base antiga.
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
   *
   * Deduplicação por `imobziId` (não por telefone): o Imobzi pode reenviar
   * o mesmo ping mais de uma vez (retry de webhook é comum), e o `imobzi_id`
   * é o identificador estável para evitar processar o mesmo lead duas vezes.
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
   * (ficam sem corretor atribuído — ou podem ser distribuídos manualmente
   * depois) e NUNCA disparam a cadência do WhatsApp, para não arriscar
   * banimento do número com envios em massa para uma base antiga e fria.
   * A tag "Base Antiga" é o próprio `origem = 'legado_imobzi'`.
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
        // corretorId e execução de cadência propositalmente NÃO são criados aqui
      },
    });

    return { lead, criado: true };
  }

  /**
   * Cadastro manual pela equipe — telefone que ligou, indicação, contato
   * presencial. Diferente do fluxo ativo (Meta Ads/site): NÃO dispara a
   * cadência automática sozinho (decisão explícita de negócio — quem
   * cadastra decide quando/como contatar). Se um `corretorId` for informado,
   * usa ele; senão, cai no round-robin normal, pra manter a distribuição
   * justa mesmo pra leads que entram por fora dos canais digitais.
   */
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

  // Status que já saíram do fluxo ativo de propósito — nunca geram alerta
  // de estagnação (não faz sentido cobrar resposta de um lead perdido).
  private readonly STATUS_SEM_ALERTA = ['perdido', 'negocio_fechado', 'frio_standby'];
  private readonly LIMITE_AGUARDANDO_RESPOSTA_HORAS = 4;
  private readonly LIMITE_SEM_ATIVIDADE_HORAS = 72;

  /**
   * Alerta de lead estagnado (inspirado na detecção de leads "esfriados" de
   * ferramentas como a Lais, adaptado pro nosso modelo — aqui é um ALERTA
   * pro corretor agir, não uma retomada automática por IA).
   */
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

    // `busca` é livre (nome OU telefone), então precisa de um OR separado dos
    // filtros de igualdade (status, origem, temperatura, corretorId...), que
    // continuam se comportando como AND entre si.
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
          // Só a última mensagem — o suficiente pra calcular o alerta de
          // estagnação, sem trazer o histórico inteiro numa lista.
          mensagens: { orderBy: { criadoEm: 'desc' }, take: 1 },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    const items = itemsBrutos.map((lead) => {
      const { mensagens, ...resto } = lead;
      const ultimaMensagem = mensagens[0] ?? null;
      const alerta = this.calcularAlerta(lead.status, ultimaMensagem, lead.criadoEm);

      // "Não lida" = a última mensagem foi do LEAD (não da equipe) e chegou
      // depois da última vez que alguém da equipe abriu essa conversa.
      const naoLida = Boolean(
        ultimaMensagem?.direcao === 'recebida' &&
          (!resto.ultimaVisualizacaoEm || ultimaMensagem.criadoEm > resto.ultimaVisualizacaoEm)
      );

      return {
        ...resto,
        alerta: alerta.tipo,
        horasParado: alerta.horasParado,
        naoLida,
        ultimaMensagemEm: ultimaMensagem?.criadoEm ?? null,
      };
    });

    return { items, total, page, pageSize };
  }

  /**
   * Lista os compromissos agendados (dataAgendamento definida), ordenados
   * pela data mais próxima primeiro. DE PROPÓSITO não filtra por status do
   * Kanban — um lead pode estar em qualquer coluna e ainda ter uma ligação/
   * reunião/visita marcada; as duas coisas são independentes.
   */
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
        // Identidades por canal — permite ao chat saber por quais canais dá
        // pra responder e exibir @username/foto do Instagram/Messenger.
        contatosCanais: true,
      },
    });

    if (!lead) return null;
    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

    // Abrir a conversa marca como "vista" pra equipe toda — próxima vez que
    // alguém listar os leads, essa conversa não aparece mais como não lida.
    // Não precisa bloquear a resposta por causa disso (fire-and-forget).
    this.prisma.lead
      .update({ where: { id }, data: { ultimaVisualizacaoEm: new Date() } })
      .catch(() => {
        // eslint-disable-next-line no-console
        console.error(`Falha ao marcar lead ${id} como visualizado`);
      });

    return lead;
  }

  /** Corretor só corretorId=si mesmo; gestor/admin qualquer lead. Reaproveitada pelas notas. */
  private async verificarAcessoAoLead(leadId: string, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');
    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }
    return lead;
  }

  async listarNotas(leadId: string, usuario: UsuarioAutenticado) {
    await this.verificarAcessoAoLead(leadId, usuario);

    return this.prisma.notaInterna.findMany({
      where: { leadId },
      orderBy: { criadoEm: 'desc' },
      include: { usuario: { select: { id: true, nome: true } } },
    });
  }

  async criarNota(leadId: string, texto: string, usuario: UsuarioAutenticado) {
    await this.verificarAcessoAoLead(leadId, usuario);

    return this.prisma.notaInterna.create({
      data: { leadId, texto, usuarioId: usuario.sub },
      include: { usuario: { select: { id: true, nome: true } } },
    });
  }

  /**
   * Liga/desliga a IA pra esse lead específico. Sempre que um humano manda
   * mensagem manual pelo chat, o status volta pra `pausada_humano`
   * automaticamente (ver `whatsapp.service.ts`) — aqui é só a troca manual,
   * feita explicitamente pela equipe.
   */
  async atualizarStatusIA(
    leadId: string,
    statusIA: 'inativa' | 'ativa' | 'pausada_humano',
    usuario: UsuarioAutenticado
  ) {
    await this.verificarAcessoAoLead(leadId, usuario);
    return this.prisma.lead.update({ where: { id: leadId }, data: { statusIA } });
  }

  /** Edição de dados básicos (nome/telefone/email/imóvel). Corretor só edita os próprios leads. */
  async atualizar(id: string, input: AtualizarLeadInput, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

    const atualizado = await this.prisma.lead.update({
      where: { id },
      data: input as Prisma.LeadUncheckedUpdateInput,
    });

    // Inteligência Norden — marcar uma VISITA (não qualquer compromisso)
    // pela primeira vez conta como sinal forte de intenção de compra.
    const virouVisitaNova =
      input.tipoAgendamento === 'visita' &&
      !!input.dataAgendamento &&
      lead.tipoAgendamento !== 'visita';

    if (virouVisitaNova) {
      incrementarScore(this.prisma, id, 'solicitacao_visita').catch(() => {});
    }

    return atualizado;
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

  /**
   * Atualização RÁPIDA da temperatura (FRIO/MORNO/QUENTE) — pensada para o
   * dropdown direto no card do Kanban ou no cabeçalho do chat, sem precisar
   * abrir a ficha completa do lead. Mesma regra de dono que o resto: corretor
   * só altera a temperatura dos próprios leads.
   */
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

  /**
   * Usado pela sincronização em lote com o Imobzi (diferente do webhook em
   * tempo real): se o lead já existe (mesmo imobziId), atualiza SÓ nome/
   * telefone/email — nunca mexe em score, perfil de busca, notas internas,
   * status do Kanban ou corretor responsável. Se não existe, cria como
   * importação passiva (mesma regra do importarLeadLegado — sem roleta,
   * sem cadência automática).
   */
  async sincronizarContatoImobzi(input: {
    id: string;
    nome?: string;
    telefone: string;
    email?: string;
  }): Promise<{ criado: boolean }> {
    const existente = await this.prisma.lead.findUnique({ where: { imobziId: input.id } });

    if (existente) {
      await this.prisma.lead.update({
        where: { id: existente.id },
        data: {
          nome: input.nome ?? existente.nome,
          telefone: input.telefone,
          email: input.email ?? existente.email,
        },
      });
      return { criado: false };
    }

    await this.importarLeadLegado({
      id: input.id,
      name: input.nome ?? null,
      phone: input.telefone,
      email: input.email ?? null,
    });

    return { criado: true };
  }
}
