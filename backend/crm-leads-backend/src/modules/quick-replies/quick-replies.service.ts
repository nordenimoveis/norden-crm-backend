import { PrismaClient } from '@prisma/client';
import { CriarQuickReplyInput, AtualizarQuickReplyInput, BuscarQuickReplyQuery } from './quick-replies.schema';
import { substituirVariaveis } from '@/lib/template-variaveis';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { MetaMessagingService } from '@/modules/meta-messaging/meta-messaging.service';

export type UsuarioAutenticado = { sub: string; papel: 'gestor' | 'corretor' | 'admin' };

export class QuickRepliesService {
  private whatsappService: WhatsappService;
  private metaMessagingService: MetaMessagingService;

  constructor(private prisma: PrismaClient) {
    this.whatsappService = new WhatsappService(prisma);
    this.metaMessagingService = new MetaMessagingService(prisma);
  }

  /**
   * Lista os quick replies visíveis para o usuário: todos os `global` +
   * só os `pessoal` que são dele. Isso é o que alimenta o popover do "/"
   * no chat do Next.js — por isso o filtro por `busca` (título) já vem pronto.
   */
  async listar(query: BuscarQuickReplyQuery, usuario: UsuarioAutenticado) {
    return this.prisma.quickReply.findMany({
      where: {
        ativo: true,
        OR: [{ tipo: 'global' }, { tipo: 'pessoal', usuarioId: usuario.sub }],
        ...(query.busca
          ? { titulo: { contains: query.busca, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { titulo: 'asc' },
    });
  }

  /**
   * Cria um quick reply. `global` só pode ser criado por gestor/admin (a
   * checagem de papel acontece na rota, via requireRole — aqui só definimos
   * o dono corretamente conforme o tipo).
   */
  async criar(input: CriarQuickReplyInput, usuario: UsuarioAutenticado) {
    return this.prisma.quickReply.create({
      data: {
        titulo: input.titulo,
        textoMensagem: input.textoMensagem,
        tipo: input.tipo,
        usuarioId: input.tipo === 'pessoal' ? usuario.sub : null,
      },
    });
  }

  private async verificarPermissaoDeEdicao(id: string, usuario: UsuarioAutenticado) {
    const quickReply = await this.prisma.quickReply.findUnique({ where: { id } });
    if (!quickReply) throw new Error('QUICK_REPLY_NAO_ENCONTRADO');

    const podeEditar =
      usuario.papel !== 'corretor' || // gestor/admin pode editar qualquer um
      (quickReply.tipo === 'pessoal' && quickReply.usuarioId === usuario.sub); // corretor só o próprio pessoal

    if (!podeEditar) throw new Error('SEM_PERMISSAO');

    return quickReply;
  }

  async atualizar(id: string, input: AtualizarQuickReplyInput, usuario: UsuarioAutenticado) {
    await this.verificarPermissaoDeEdicao(id, usuario);
    return this.prisma.quickReply.update({ where: { id }, data: input });
  }

  async deletar(id: string, usuario: UsuarioAutenticado) {
    await this.verificarPermissaoDeEdicao(id, usuario);
    await this.prisma.quickReply.delete({ where: { id } });
  }

  /**
   * Dispara um quick reply para um lead, já com as variáveis substituídas
   * ({{lead_name}}, {{broker_name}}). Usa o mesmo `WhatsappService.enviarTexto`
   * do envio manual comum — precisa estar dentro da janela de 24h, já que é
   * texto livre (não é template pré-aprovado).
   */
  async enviarParaLead(leadId: string, quickReplyId: string, usuario: UsuarioAutenticado) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, include: { corretor: true } });
    if (!lead) throw new Error('LEAD_NAO_ENCONTRADO');

    if (usuario.papel === 'corretor' && lead.corretorId !== usuario.sub) {
      throw new Error('SEM_PERMISSAO');
    }

    const quickReply = await this.prisma.quickReply.findFirst({
      where: {
        id: quickReplyId,
        ativo: true,
        OR: [{ tipo: 'global' }, { tipo: 'pessoal', usuarioId: usuario.sub }],
      },
    });

    if (!quickReply) throw new Error('QUICK_REPLY_NAO_ENCONTRADO');

    const textoFinal = substituirVariaveis(quickReply.textoMensagem, {
      lead_name: lead.nome ?? undefined,
      broker_name: lead.corretor?.nome ?? undefined,
    });

    // Roteia pelo canal do lead: com telefone, vai por WhatsApp; sem telefone
    // (lead de Instagram/Messenger), vai como DM pelo canal principal dele.
    if (lead.telefone) {
      return this.whatsappService.enviarTexto(
        leadId,
        { telefone: lead.telefone, texto: textoFinal },
        usuario.sub
      );
    }

    if (lead.canalPrincipal === 'instagram' || lead.canalPrincipal === 'messenger') {
      return this.metaMessagingService.enviarDm(
        leadId,
        lead.canalPrincipal,
        textoFinal,
        usuario.sub
      );
    }

    throw new Error('LEAD_SEM_CANAL_PARA_ENVIO');
  }
}
