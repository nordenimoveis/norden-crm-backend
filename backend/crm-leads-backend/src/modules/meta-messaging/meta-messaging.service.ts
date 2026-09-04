import { PrismaClient, Canal, Prisma } from '@prisma/client';
import { env } from '@/config/env';
import {
  notificarNovaMensagem,
  notificarLeadAtualizado,
  notificarComentario,
} from '@/lib/pusher';
import { incrementarScore } from '@/lib/score.service';
import { IaService } from '@/modules/ia/ia.service';
import {
  MetaMessagingPayload,
  MessagingEvent,
  CommentChange,
  ListarComentariosQuery,
} from './meta-messaging.schema';

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
// API do Instagram com Login do Instagram: chamadas vão para graph.instagram.com
// com o token do Instagram (META_IG_ACCESS_TOKEN), não para a Graph do Facebook.
const IG_GRAPH_BASE = 'https://graph.instagram.com/v21.0';

/**
 * Serviço da caixa de entrada omnichannel da Meta: Instagram Direct, Messenger
 * e comentários de posts. Fala com a Graph API usando o token da Página
 * (META_PAGE_ACCESS_TOKEN) — o MESMO token atende IG e Messenger, porque a
 * conta comercial do Instagram é vinculada a uma Página do Facebook.
 *
 * Convenção do CRM: cada pessoa é um Lead; a identidade dela em cada canal
 * (telefone/PSID/IGSID) vive em ContatoCanal. Uma DM de IG/Messenger nunca
 * dispara cadência de WhatsApp — o atendimento é sempre humano.
 */
export class MetaMessagingService {
  private iaService: IaService;

  constructor(private prisma: PrismaClient) {
    this.iaService = new IaService(prisma);
  }

  // ---------------------------------------------------------------------------
  // Graph API — chamadas de baixo nível
  // ---------------------------------------------------------------------------
  private get pageToken() {
    return env.META_PAGE_ACCESS_TOKEN;
  }

  // Token da Página (page-scoped) derivado do token configurado. A Send API do
  // Messenger/IG exige o token DA PÁGINA; com um token de System User direto ela
  // costuma responder "(#1) An unknown error has occurred". Derivamos uma vez
  // (GET /{page-id}?fields=access_token) e cacheamos; se não der, caímos no
  // token configurado, para nunca piorar o que já funcionava (ex.: comentários).
  private pageTokenCache?: string;
  private async obterPageToken(): Promise<string | undefined> {
    if (this.pageTokenCache) return this.pageTokenCache;
    const base = this.pageToken;
    if (!base || !env.META_PAGE_ID) return base;
    try {
      const url = `${GRAPH_BASE}/${env.META_PAGE_ID}?fields=access_token&access_token=${base}`;
      const resp = await fetch(url);
      const json = (await resp.json()) as { access_token?: string };
      if (resp.ok && json.access_token) {
        this.pageTokenCache = json.access_token;
        return json.access_token;
      }
    } catch {
      // ignora — usa o token base
    }
    return base;
  }

  /**
   * Escolhe a base e o token conforme o canal:
   *  - Instagram COM META_IG_ACCESS_TOKEN → graph.instagram.com + token do IG
   *    (modelo "Login do Instagram"): é o que faz DM do Instagram enviar/ler perfil.
   *  - Caso contrário (Messenger, ou IG sem token próprio) → Graph do Facebook +
   *    token da Página. Assim nada quebra enquanto o token do IG não estiver setado.
   */
  private async endpointPara(canal: Canal): Promise<{ base: string; token?: string }> {
    if (canal === Canal.instagram && env.META_IG_ACCESS_TOKEN) {
      return { base: IG_GRAPH_BASE, token: env.META_IG_ACCESS_TOKEN };
    }
    return { base: GRAPH_BASE, token: await this.obterPageToken() };
  }

  private async graph(canal: Canal, path: string, body: Record<string, unknown>) {
    const { base, token } = await this.endpointPara(canal);
    if (!token) {
      throw new Error('Token da Meta não configurado para este canal');
    }

    const response = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      // Extrai a mensagem legível da Meta em vez de despejar o JSON cru, para
      // o painel mostrar algo compreensível ao corretor (ex.: janela de 24h).
      const erro = json.error as
        | { message?: string; error_user_msg?: string; code?: number }
        | undefined;
      const detalhe = erro?.error_user_msg || erro?.message || JSON.stringify(json);
      // Distingue os erros pela MENSAGEM (não só pelo código): code 10 pode ser
      // tanto a janela de 24h quanto "sem permissão" (Acesso Padrão), e tratar
      // todo code 10 como 24h confundia o usuário.
      let amigavel = detalhe;
      if (/24 hours|allowed window|outside.*window|standard messaging/i.test(detalhe)) {
        amigavel =
          'Não é possível enviar mensagem livre: já se passaram mais de 24h desde a última mensagem do cliente. Use um template/anúncio para reabrir a conversa.';
      } else if (
        erro?.code === 200 ||
        /does not have permission|permission for this action|not have access/i.test(detalhe)
      ) {
        amigavel =
          'Ainda sem Acesso Avançado: por enquanto só é possível responder pessoas que têm papel no app (admin/testador). Isso é liberado para qualquer pessoa quando a Revisão do App for aprovada.';
      }
      throw new Error(amigavel);
    }
    return json;
  }

  /** Busca nome/foto/@ de um usuário de canal. Best-effort: se a permissão não
   * estiver liberada ou o id não resolver, retorna vazio sem quebrar o fluxo. */
  private async buscarPerfil(
    canal: Canal,
    identidadeExterna: string
  ): Promise<{ nome?: string; username?: string; fotoUrl?: string }> {
    const { base, token } = await this.endpointPara(canal);
    if (!token) return {};
    try {
      const campos = canal === Canal.instagram ? 'name,username,profile_pic' : 'name,profile_pic';
      const url = `${base}/${identidadeExterna}?fields=${campos}&access_token=${token}`;
      const resp = await fetch(url);
      if (!resp.ok) return {};
      const json = (await resp.json()) as {
        name?: string;
        username?: string;
        profile_pic?: string;
      };
      return { nome: json.name, username: json.username, fotoUrl: json.profile_pic };
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook — entrada
  // ---------------------------------------------------------------------------
  async processarWebhook(payload: MetaMessagingPayload) {
    // `object` diz o produto: "instagram" → DMs/comentários do Instagram;
    // "page" → Messenger/comentários do Facebook. É o que decide o Canal.
    const canalPadrao: Canal = payload.object === 'instagram' ? Canal.instagram : Canal.messenger;

    for (const entry of payload.entry) {
      const eventos = [...(entry.messaging ?? []), ...(entry.standby ?? [])];
      // eslint-disable-next-line no-console
      console.log(
        `[meta-msg] webhook object=${payload.object} canal=${canalPadrao} entry=${entry.id} msgs=${eventos.length} changes=${(entry.changes ?? []).length}`
      );
      for (const evento of eventos) {
        await this.processarEventoMensagem(canalPadrao, entry.id, evento).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[meta-messaging] Falha ao processar DM:', err);
        });
      }

      for (const change of entry.changes ?? []) {
        await this.processarComentario(canalPadrao, change).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[meta-messaging] Falha ao processar comentário:', err);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DMs (Instagram Direct / Messenger)
  // ---------------------------------------------------------------------------
  private async processarEventoMensagem(canal: Canal, contaId: string, evento: MessagingEvent) {
    const message = evento.message;
    // Log de diagnóstico: mostra por que uma DM foi (ou não) virou conversa.
    // eslint-disable-next-line no-console
    console.log(
      `[meta-msg] DM canal=${canal} de=${evento.sender?.id} para=${evento.recipient?.id} entry=${contaId} temMsg=${!!message} echo=${message?.is_echo ?? false} texto="${(message?.text ?? '').slice(0, 40)}"`
    );

    if (!message) return; // recibo de entrega/leitura — ignoramos

    // is_echo = mensagem que nós mesmos enviamos, devolvida pelo webhook. Já
    // registramos no envio, então ignoramos para não duplicar.
    if (message.is_echo) {
      // eslint-disable-next-line no-console
      console.log(`[meta-msg] ignorado: is_echo (mensagem enviada pela própria conta)`);
      return;
    }

    const identidadeExterna = evento.sender.id;
    if (identidadeExterna === contaId) {
      // eslint-disable-next-line no-console
      console.log(`[meta-msg] ignorado: remetente == conta (${contaId}) — mensagem da própria conta`);
      return; // proteção extra contra eco
    }

    const conteudo = this.extrairConteudo(message);

    const { contatoCanal, lead } = await this.garantirContatoELead(canal, identidadeExterna);

    const mensagem = await this.prisma.mensagem.create({
      data: {
        leadId: lead.id,
        direcao: 'recebida',
        canal,
        conteudo,
        status: 'entregue',
        externalId: message.mid,
        contatoCanalId: contatoCanal.id,
      },
    });

    await this.prisma.contatoCanal.update({
      where: { id: contatoCanal.id },
      data: { ultimaRecebidaEm: new Date() },
    });

    await notificarNovaMensagem({
      id: mensagem.id,
      leadId: mensagem.leadId,
      direcao: mensagem.direcao,
      conteudo: mensagem.conteudo,
      criadoEm: mensagem.criadoEm,
      canal,
    });

    incrementarScore(this.prisma, lead.id, 'mensagem_recebida').catch(() => {});

    // --- Ramo da IA (mesma regra do WhatsApp) --------------------------
    // Se a IA está ativa pra esse lead, ela gera E MANDA a resposta pelo
    // MESMO canal social (Instagram/Messenger) — a IaService é agnóstica de
    // canal: usa o histórico do lead + base de conhecimento. Se falhar por
    // qualquer motivo, cai pro fluxo humano abaixo, pra nunca deixar o lead
    // sem resposta por um erro técnico.
    if (lead.statusIA === 'ativa') {
      try {
        const respostaIA = await this.iaService.gerarRespostaParaLead(lead.id, conteudo);

        if (respostaIA.trim()) {
          // enviadaPorUsuarioId ausente = resposta automática (não pausa a IA).
          await this.enviarDm(lead.id, canal, respostaIA);
        }

        const leadIA = await this.prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'respondeu' },
        });

        await notificarLeadAtualizado({
          id: leadIA.id,
          status: leadIA.status,
          atendimentoHumano: leadIA.atendimentoHumano,
          corretorId: leadIA.corretorId,
        });

        return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[ia] Falha ao responder DM automática do lead ${lead.id}:`, err);
        // Cai pro fluxo humano abaixo.
      }
    }

    // Sem IA (ou IA falhou): marca a conversa como precisando de humano e
    // aparece no board como "aguardando resposta".
    const leadAtualizado = await this.prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'respondeu', atendimentoHumano: true },
    });

    await notificarLeadAtualizado({
      id: leadAtualizado.id,
      status: leadAtualizado.status,
      atendimentoHumano: leadAtualizado.atendimentoHumano,
      corretorId: leadAtualizado.corretorId,
    });
  }

  private extrairConteudo(message: NonNullable<MessagingEvent['message']>): string {
    if (message.text) return message.text;
    const anexo = message.attachments?.[0];
    if (anexo) {
      const tipo = anexo.type ?? 'arquivo';
      return `[${tipo}]${anexo.payload?.url ? ` ${anexo.payload.url}` : ''}`;
    }
    return '[mensagem sem texto]';
  }

  /**
   * Garante que exista um ContatoCanal (identidade nesse canal) e o Lead por
   * trás dele. Se for a primeira vez que essa pessoa fala nesse canal, cria os
   * dois e tenta enriquecer com nome/foto via Graph API.
   */
  private async garantirContatoELead(canal: Canal, identidadeExterna: string) {
    const existente = await this.prisma.contatoCanal.findUnique({
      where: { canal_identidadeExterna: { canal, identidadeExterna } },
      include: { lead: true },
    });
    if (existente) {
      // Backfill do nome: conversas criadas antes do token da Página ficaram sem
      // nome. Se o contato/lead ainda não tem nome, tenta buscar de novo agora
      // (best-effort) e atualiza — corrige conversas antigas na próxima mensagem.
      if (!existente.nomeExibicao || !existente.lead.nome) {
        const perfil = await this.buscarPerfil(canal, identidadeExterna);
        if (perfil.nome || perfil.username || perfil.fotoUrl) {
          const [contatoCanal, lead] = await Promise.all([
            this.prisma.contatoCanal.update({
              where: { id: existente.id },
              data: {
                nomeExibicao: existente.nomeExibicao ?? perfil.nome ?? null,
                username: existente.username ?? perfil.username ?? null,
                fotoUrl: existente.fotoUrl ?? perfil.fotoUrl ?? null,
              },
            }),
            existente.lead.nome
              ? Promise.resolve(existente.lead)
              : this.prisma.lead.update({
                  where: { id: existente.lead.id },
                  data: { nome: perfil.nome ?? perfil.username ?? null },
                }),
          ]);
          return { contatoCanal, lead };
        }
      }
      return { contatoCanal: existente, lead: existente.lead };
    }

    const perfil = await this.buscarPerfil(canal, identidadeExterna);
    const origem = canal === Canal.instagram ? 'instagram' : 'messenger';

    const lead = await this.prisma.lead.create({
      data: {
        nome: perfil.nome ?? perfil.username ?? null,
        canalPrincipal: canal,
        origem,
        atendimentoHumano: true,
      },
    });

    const contatoCanal = await this.prisma.contatoCanal.create({
      data: {
        leadId: lead.id,
        canal,
        identidadeExterna,
        nomeExibicao: perfil.nome ?? null,
        username: perfil.username ?? null,
        fotoUrl: perfil.fotoUrl ?? null,
      },
    });

    await notificarLeadAtualizado({
      id: lead.id,
      status: lead.status,
      atendimentoHumano: lead.atendimentoHumano,
      corretorId: lead.corretorId,
    });

    return { contatoCanal, lead };
  }

  // ---------------------------------------------------------------------------
  // Envio de DM pelo painel
  // ---------------------------------------------------------------------------
  /**
   * Envia uma resposta livre por Instagram Direct ou Messenger. Só funciona
   * dentro da janela de 24h após a última mensagem do cliente (regra da Meta) —
   * fora dela a Graph API rejeita e o erro é propagado para o painel.
   */
  async enviarDm(leadId: string, canal: Canal, texto: string, enviadaPorUsuarioId?: string) {
    const contatoCanal = await this.prisma.contatoCanal.findFirst({
      where: { leadId, canal },
    });
    if (!contatoCanal) {
      throw new Error(`Lead não tem contato no canal ${canal}`);
    }

    // Instagram (Login do Instagram): POST me/messages em graph.instagram.com
    // com o token do IG — `me` = a própria conta do Instagram. Sem messaging_type.
    // Messenger: POST /{page-id}/messages na Graph do Facebook (id explícito da
    // Página porque o token de System User não resolve o atalho `me`).
    const usaIgLogin = canal === Canal.instagram && !!env.META_IG_ACCESS_TOKEN;
    const path = usaIgLogin
      ? 'me/messages'
      : canal === Canal.instagram && env.META_IG_ACCOUNT_ID
        ? `${env.META_IG_ACCOUNT_ID}/messages`
        : env.META_PAGE_ID
          ? `${env.META_PAGE_ID}/messages`
          : 'me/messages';

    const corpo: Record<string, unknown> = {
      recipient: { id: contatoCanal.identidadeExterna },
      message: { text: texto },
    };
    // messaging_type é do Messenger/Graph do Facebook; a API do IG não usa.
    if (!usaIgLogin) corpo.messaging_type = 'RESPONSE';

    const resposta = await this.graph(canal, path, corpo);

    const externalId =
      (resposta.message_id as string | undefined) ?? (resposta.mid as string | undefined);

    // Humano assumiu — pausa a IA se estivesse ativa (consistente com WhatsApp).
    if (enviadaPorUsuarioId) {
      await this.prisma.lead.updateMany({
        where: { id: leadId, statusIA: 'ativa' },
        data: { statusIA: 'pausada_humano' },
      });
    }

    const mensagem = await this.prisma.mensagem.create({
      data: {
        leadId,
        direcao: 'enviada',
        canal,
        conteudo: texto,
        status: externalId ? 'enviada' : 'falhou',
        externalId,
        contatoCanalId: contatoCanal.id,
        enviadaPorUsuarioId,
        enviadaEm: new Date(),
      },
      include: { enviadaPorUsuario: true },
    });

    await notificarNovaMensagem({
      id: mensagem.id,
      leadId: mensagem.leadId,
      direcao: mensagem.direcao,
      conteudo: mensagem.conteudo,
      criadoEm: mensagem.criadoEm,
      canal,
    });

    return mensagem;
  }

  // ---------------------------------------------------------------------------
  // Comentários de posts
  // ---------------------------------------------------------------------------
  private async processarComentario(canal: Canal, change: CommentChange) {
    const v = change.value;
    // Só nos interessa comentário. No FB o feed traz vários item types.
    if (change.field === 'feed' && v.item && v.item !== 'comment') return;
    // Ignora remoções/edições no processamento de "novo comentário".
    if (v.verb && v.verb !== 'add') return;

    const comentarioExternoId = v.id ?? v.comment_id;
    if (!comentarioExternoId) return;

    const texto = v.text ?? v.message ?? '';
    const autorExternoId = v.from?.id;

    // Se o autor é a própria conta, é a NOSSA resposta ecoada — não recria.
    const nossaConta = canal === Canal.instagram ? env.META_IG_ACCOUNT_ID : env.META_PAGE_ID;
    const ehNossa = !!autorExternoId && !!nossaConta && autorExternoId === nossaConta;

    // Idempotência: se já registramos esse comentário, não duplica.
    const jaExiste = await this.prisma.comentarioSocial.findUnique({
      where: { comentarioExternoId },
    });
    if (jaExiste) return;

    // Tenta casar o autor com um Lead que já conversou nesse canal.
    let leadId: string | null = null;
    if (autorExternoId && !ehNossa) {
      const contato = await this.prisma.contatoCanal.findUnique({
        where: { canal_identidadeExterna: { canal, identidadeExterna: autorExternoId } },
      });
      leadId = contato?.leadId ?? null;
    }

    const comentario = await this.prisma.comentarioSocial.create({
      data: {
        canal,
        comentarioExternoId,
        postId: v.post_id ?? v.media?.id ?? 'desconhecido',
        parentId: v.parent_id ?? null,
        permalink: v.permalink ?? null,
        direcao: ehNossa ? 'enviado' : 'recebido',
        autorExternoId: autorExternoId ?? null,
        autorNome: v.from?.name ?? null,
        autorUsername: v.from?.username ?? null,
        texto,
        respondido: ehNossa, // nossa própria resposta já entra respondida
        leadId,
        recebidoEm: new Date(),
      },
    });

    await notificarComentario({
      id: comentario.id,
      canal: comentario.canal as 'instagram' | 'messenger',
      postId: comentario.postId,
      texto: comentario.texto,
      autorNome: comentario.autorNome,
      direcao: comentario.direcao,
      respondido: comentario.respondido,
      criadoEm: comentario.criadoEm,
    });
  }

  /** Responde publicamente a um comentário — cria um comentário-filho na thread. */
  async responderComentario(comentarioId: string, texto: string, usuarioId?: string) {
    const comentario = await this.prisma.comentarioSocial.findUnique({
      where: { id: comentarioId },
    });
    if (!comentario) throw new Error('Comentário não encontrado');

    // IG usa /{comment-id}/replies; FB usa /{comment-id}/comments. Ambos
    // aceitam { message }.
    const sub = comentario.canal === Canal.instagram ? 'replies' : 'comments';
    const resposta = await this.graph(comentario.canal, `${comentario.comentarioExternoId}/${sub}`, {
      message: texto,
    });
    const novoId = (resposta.id as string | undefined) ?? undefined;

    await this.prisma.comentarioSocial.update({
      where: { id: comentario.id },
      data: { respondido: true, respondidoPorUsuarioId: usuarioId ?? null },
    });

    // Registra a nossa resposta como um comentário-filho (direcao enviado).
    const filho = novoId
      ? await this.prisma.comentarioSocial.create({
          data: {
            canal: comentario.canal,
            comentarioExternoId: novoId,
            postId: comentario.postId,
            parentId: comentario.comentarioExternoId,
            direcao: 'enviado',
            texto,
            respondido: true,
            respondidoPorUsuarioId: usuarioId ?? null,
            leadId: comentario.leadId,
            recebidoEm: new Date(),
          },
        })
      : null;

    await notificarComentario({
      id: comentario.id,
      canal: comentario.canal as 'instagram' | 'messenger',
      postId: comentario.postId,
      texto: comentario.texto,
      autorNome: comentario.autorNome,
      direcao: comentario.direcao,
      respondido: true,
      criadoEm: comentario.criadoEm,
    });

    return { comentario: { ...comentario, respondido: true }, resposta: filho };
  }

  async listarComentarios(query: ListarComentariosQuery) {
    const where: Prisma.ComentarioSocialWhereInput = {
      direcao: 'recebido',
    };
    if (query.canal) where.canal = query.canal as Canal;
    if (query.respondido !== undefined) where.respondido = query.respondido;
    if (query.busca) {
      where.OR = [
        { texto: { contains: query.busca, mode: 'insensitive' } },
        { autorNome: { contains: query.busca, mode: 'insensitive' } },
        { autorUsername: { contains: query.busca, mode: 'insensitive' } },
      ];
    }

    return this.prisma.comentarioSocial.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: 100,
      include: {
        lead: { select: { id: true, nome: true } },
      },
    });
  }
}
