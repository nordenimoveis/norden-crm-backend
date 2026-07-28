import { PrismaClient } from '@prisma/client';
import { ImoveisService } from '@/modules/imoveis/imoveis.service';
import { LeadsService } from '@/modules/leads/leads.service';
import { buscarContatosImobzi, telefoneDoContato } from '@/lib/imobzi-leads-api';

export type ResultadoSincronizacao = { novos: number; atualizados: number; total: number };

/**
 * Orquestra a integração com o Imobzi — hoje só sincronização manual
 * (POST sob demanda), mas separado em módulo próprio de propósito: dá pra
 * adicionar webhooks aqui no futuro (ex: Imobzi notificando alteração de
 * UM imóvel específico) chamando os mesmos métodos, sem duplicar lógica.
 */
export class ImobziIntegracaoService {
  private imoveisService: ImoveisService;
  private leadsService: LeadsService;

  constructor(private prisma: PrismaClient) {
    this.imoveisService = new ImoveisService(prisma);
    this.leadsService = new LeadsService(prisma);
  }

  /**
   * Sincronização de imóveis — delega pro mesmo motor já usado pelo botão
   * "Sincronizar com Imobzi" do Catálogo (upsert por imobziId + reindexação
   * automática de embedding). Não duplica lógica, só expõe outra porta de
   * entrada (rota `/api/imobzi/sync/imoveis`, além da já existente em
   * `/api/imoveis/sincronizar-imobzi`).
   */
  async syncImoveis(): Promise<ResultadoSincronizacao> {
    return this.imoveisService.sincronizarComImobzi();
  }

  /**
   * Sincronização de leads/contatos. Segue a MESMA regra já estabelecida
   * pra qualquer importação em lote do Imobzi (diferente do webhook em
   * tempo real): passiva, tag `legado_imobzi`, nunca entra em roleta nem
   * dispara cadência automática sozinha.
   *
   * Se o lead já existe (mesmo `imobziId`), atualiza SÓ os dados básicos
   * (nome/telefone/email) — nunca mexe em score, perfil de busca, notas
   * internas, status do Kanban ou corretor responsável.
   */
  async syncLeads(): Promise<ResultadoSincronizacao> {
    const contatos = await buscarContatosImobzi();

    let novos = 0;
    let atualizados = 0;

    for (const contato of contatos) {
      const telefone = telefoneDoContato(contato);
      if (!telefone) continue; // sem telefone não dá pra criar/atualizar um lead de WhatsApp

      const resultado = await this.leadsService.sincronizarContatoImobzi({
        id: contato.id,
        nome: contato.name,
        telefone,
        email: contato.email,
      });

      if (resultado.criado) novos++;
      else atualizados++;
    }

    return { novos, atualizados, total: contatos.length };
  }
}
