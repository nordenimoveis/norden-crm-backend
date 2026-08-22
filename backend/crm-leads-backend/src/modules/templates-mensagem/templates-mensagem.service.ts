import { PrismaClient, TipoMidiaTemplate } from '@prisma/client';
import { env } from '@/config/env';

const GRAPH_API_VERSION = 'v19.0';

type MetaComponent = {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // para HEADER: TEXT | IMAGE | VIDEO | DOCUMENT
  text?: string;
};

type MetaTemplate = {
  name: string;
  language: string;
  status: string; // APPROVED | PENDING | REJECTED | ...
  category?: string;
  components?: MetaComponent[];
};

export class TemplatesMensagemService {
  constructor(private prisma: PrismaClient) {}

  private mapearMidia(format?: string): TipoMidiaTemplate | null {
    switch ((format ?? '').toUpperCase()) {
      case 'IMAGE':
        return 'image';
      case 'VIDEO':
        return 'video';
      case 'DOCUMENT':
        return 'document';
      default:
        return null; // TEXT header ou sem header
    }
  }

  /** Conta quantas variáveis posicionais {{1}}, {{2}}... o corpo usa (maior índice). */
  private contarVariaveis(texto: string): number {
    const matches = [...texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
    return matches.reduce((max, m) => Math.max(max, Number(m[1])), 0);
  }

  /**
   * Sincroniza os templates aprovados direto da Meta para o nosso banco.
   * Busca /{WABA_ID}/message_templates (paginado) e faz upsert por nome+idioma.
   * Retorna um resumo do que foi criado/atualizado.
   */
  async sincronizarComMeta(): Promise<{ criados: number; atualizados: number; total: number }> {
    if (!env.WHATSAPP_WABA_ID) throw new Error('WHATSAPP_WABA_ID não configurado');
    if (!env.META_PAGE_ACCESS_TOKEN && !env.WHATSAPP_TOKEN) {
      throw new Error('Token da Meta/WhatsApp não configurado');
    }
    const token = env.WHATSAPP_TOKEN ?? env.META_PAGE_ACCESS_TOKEN;

    let url:
      | string
      | null = `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_WABA_ID}/message_templates?limit=100&access_token=${token}`;

    const coletados: MetaTemplate[] = [];
    // Paginação: segue paging.next até acabar (com um teto de segurança).
    for (let pagina = 0; url && pagina < 20; pagina++) {
      const resp = await fetch(url);
      if (!resp.ok) {
        const erro = await resp.text();
        throw new Error(`Falha ao buscar templates na Meta: ${resp.status} - ${erro}`);
      }
      const json = (await resp.json()) as { data?: MetaTemplate[]; paging?: { next?: string } };
      coletados.push(...(json.data ?? []));
      url = json.paging?.next ?? null;
    }

    let criados = 0;
    let atualizados = 0;

    for (const tpl of coletados) {
      const header = tpl.components?.find((c) => c.type === 'HEADER');
      const body = tpl.components?.find((c) => c.type === 'BODY');
      const footer = tpl.components?.find((c) => c.type === 'FOOTER');

      const conteudo = body?.text ?? '';
      const dados = {
        nome: tpl.name,
        conteudo,
        metaTemplateName: tpl.name,
        aprovadoMeta: tpl.status === 'APPROVED',
        midiaTipo: this.mapearMidia(header?.format),
        idioma: tpl.language,
        numVariaveis: this.contarVariaveis(conteudo),
        categoria: tpl.category ?? null,
        metaStatus: tpl.status,
        rodape: footer?.text ?? null,
      };

      // Upsert manual por (metaTemplateName, idioma) — não há constraint única
      // no banco de propósito (templates manuais legados podem repetir nome).
      const existente = await this.prisma.templateMensagem.findFirst({
        where: { metaTemplateName: tpl.name, idioma: tpl.language },
      });

      if (existente) {
        await this.prisma.templateMensagem.update({ where: { id: existente.id }, data: dados });
        atualizados++;
      } else {
        await this.prisma.templateMensagem.create({ data: dados });
        criados++;
      }
    }

    return { criados, atualizados, total: coletados.length };
  }
}
