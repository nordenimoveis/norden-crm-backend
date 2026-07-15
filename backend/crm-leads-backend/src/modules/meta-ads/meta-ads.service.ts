import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { LeadsService } from '@/modules/leads/leads.service';
import { MetaWebhookPayload, MetaLeadFields, metaLeadFieldsSchema } from './meta-ads.schema';

const GRAPH_API_VERSION = 'v19.0';

export class MetaAdsService {
  private leadsService: LeadsService;

  constructor(private prisma: PrismaClient) {
    this.leadsService = new LeadsService(prisma);
  }

  /**
   * Valida a assinatura HMAC SHA-256 enviada pelo Meta no header x-hub-signature-256,
   * usando o corpo bruto (raw) da requisição. Essencial para garantir que a chamada
   * realmente veio do Meta e não de um terceiro forjando o payload.
   */
  validarAssinatura(rawBody: string, assinaturaHeader?: string): boolean {
    if (!env.META_APP_SECRET) {
      // Em desenvolvimento, se a secret não estiver configurada, não bloqueia —
      // mas isso NUNCA deve acontecer em produção.
      return env.NODE_ENV !== 'production';
    }

    if (!assinaturaHeader) return false;

    const esperado = crypto
      .createHmac('sha256', env.META_APP_SECRET)
      .update(rawBody)
      .digest('hex');

    const recebido = assinaturaHeader.replace('sha256=', '');

    // timingSafeEqual evita ataques de timing na comparação
    const bufEsperado = Buffer.from(esperado, 'hex');
    const bufRecebido = Buffer.from(recebido, 'hex');

    if (bufEsperado.length !== bufRecebido.length) return false;

    return crypto.timingSafeEqual(bufEsperado, bufRecebido);
  }

  /**
   * Busca os campos completos do lead na Graph API a partir do leadgen_id.
   * O webhook em si só avisa "um lead chegou" — os dados (nome, telefone, email)
   * precisam ser buscados separadamente.
   */
  async buscarDadosDoLead(leadgenId: string): Promise<MetaLeadFields> {
    if (!env.META_PAGE_ACCESS_TOKEN) {
      throw new Error('META_PAGE_ACCESS_TOKEN não configurado');
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?access_token=${env.META_PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url);

    if (!response.ok) {
      const erro = await response.text();
      throw new Error(`Falha ao buscar lead na Graph API: ${response.status} - ${erro}`);
    }

    const json = await response.json();
    return metaLeadFieldsSchema.parse(json);
  }

  /** Extrai um campo específico (ex: 'phone_number', 'full_name', 'email') do field_data */
  private extrairCampo(fields: MetaLeadFields, nomeCampo: string): string | undefined {
    return fields.field_data.find((f) => f.name === nomeCampo)?.values?.[0];
  }

  /**
   * Encontra a campanha correspondente ao form_id do Meta. Se não existir ainda
   * (ex: você esqueceu de cadastrar a campanha antes de subir o anúncio), cria
   * um registro básico para não perder o lead — é melhor ter uma campanha "sem nome"
   * do que descartar o lead.
   */
  private async encontrarOuCriarCampanha(formId: string, campaignId?: string) {
    let campanha = await this.prisma.campanha.findFirst({ where: { metaFormId: formId } });

    if (!campanha) {
      campanha = await this.prisma.campanha.create({
        data: {
          nome: `Campanha não cadastrada (form ${formId})`,
          metaFormId: formId,
          metaCampaignId: campaignId,
        },
      });
    }

    return campanha;
  }

  /**
   * Processa um evento de webhook completo: para cada leadgen recebido,
   * busca os dados na Graph API e cria o lead no banco via LeadsService.
   */
  async processarWebhook(payload: MetaWebhookPayload) {
    const resultados = [];

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const { leadgen_id, form_id, campaign_id } = change.value;

        const dadosLead = await this.buscarDadosDoLead(leadgen_id);
        const campanha = await this.encontrarOuCriarCampanha(form_id, campaign_id);

        const nome = this.extrairCampo(dadosLead, 'full_name');
        const telefone = this.extrairCampo(dadosLead, 'phone_number');
        const email = this.extrairCampo(dadosLead, 'email');

        if (!telefone) {
          // Sem telefone não há como iniciar cadência no WhatsApp — registra e segue
          resultados.push({ leadgen_id, status: 'ignorado', motivo: 'sem telefone' });
          continue;
        }

        const lead = await this.leadsService.criar({
          nome,
          telefone,
          email,
          campanhaId: campanha.id,
          origem: 'meta_ads',
          payloadBruto: { leadgen_id, form_id, campo_bruto: dadosLead.field_data },
        });

        resultados.push({ leadgen_id, status: 'criado', leadId: lead.id });
      }
    }

    return resultados;
  }
}
