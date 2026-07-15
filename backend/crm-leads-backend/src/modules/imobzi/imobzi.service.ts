import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { LeadsService } from '@/modules/leads/leads.service';
import {
  imobziContatoSchema,
  imobziListaContatosSchema,
  extrairTelefone,
  paraLeadNormalizado,
  ImobziContato,
} from './imobzi.schema';

export class ImobziService {
  private leadsService: LeadsService;

  constructor(private prisma: PrismaClient) {
    this.leadsService = new LeadsService(prisma);
  }

  /**
   * Rota 1 (Ativa): processa o payload recebido no webhook `lead_created`
   * do Imobzi — que é o registro completo do contato. Traduz para o formato
   * normalizado e delega ao LeadsService, que garante round-robin + Passo 1.
   */
  async processarWebhookNovoLead(contatoBruto: unknown) {
    const contato = imobziContatoSchema.parse(contatoBruto);
    const telefone = extrairTelefone(contato);

    if (!telefone) {
      throw new Error('LEAD_SEM_TELEFONE');
    }

    const normalizado = paraLeadNormalizado(contato);
    return this.leadsService.criarDeImobziWebhook({
      imobzi_id: normalizado.imobziId,
      nome: normalizado.nome,
      telefone: normalizado.telefone!,
      email: normalizado.email,
    });
  }

  private async buscarPaginaContatos(cursor: string | null) {
    if (!env.IMOBZI_API_BASE_URL || !env.IMOBZI_API_TOKEN) {
      throw new Error('IMOBZI_API_BASE_URL / IMOBZI_API_TOKEN não configurados');
    }

    // GET /v1/contacts?contact_type=lead&cursor=... — paginação por CURSOR,
    // confirmada no OpenAPI oficial do Imobzi (schema ResponseContact).
    const url = new URL(`${env.IMOBZI_API_BASE_URL}/contacts`);
    url.searchParams.set('contact_type', 'lead');
    url.searchParams.set('order', 'recently_created');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: {
        // Autenticação real do Imobzi: header X-Imobzi-Secret (não Bearer).
        'X-Imobzi-Secret': env.IMOBZI_API_TOKEN,
      },
    });

    if (!response.ok) {
      throw new Error(`Falha ao buscar contatos do Imobzi: ${response.status}`);
    }

    const json = await response.json();
    return imobziListaContatosSchema.parse(json);
  }

  /**
   * Rota 2 (Passiva): varre toda a base antiga do Imobzi via cursor,
   * importando cada lead com `LeadsService.importarLeadLegado` — que NUNCA
   * aciona round-robin nem cadência.
   */
  async sincronizarBaseLegada(): Promise<{ processados: number; criados: number; ignorados: number }> {
    let cursor: string | null = null;
    let processados = 0;
    let criados = 0;
    let ignorados = 0;

    do {
      const pagina = await this.buscarPaginaContatos(cursor);

      for (const contato of pagina.contacts) {
        processados++;

        const telefone = extrairTelefone(contato as ImobziContato);
        if (!telefone) {
          // eslint-disable-next-line no-console
          console.warn(`[imobzi] Contato ${contato.db_id} sem telefone, pulando importação`);
          ignorados++;
          continue;
        }

        const { criado } = await this.leadsService.importarLeadLegado({
          id: String(contato.db_id),
          name: contato.fullname ?? contato.name ?? null,
          phone: telefone,
          email: contato.email ?? null,
        });

        if (criado) criados++;
        else ignorados++;
      }

      cursor = pagina.cursor ?? null;
    } while (cursor);

    return { processados, criados, ignorados };
  }
}
