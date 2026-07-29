import { FastifyInstance } from 'fastify';
import { LeadsService } from '@/modules/leads/leads.service';
import { env } from '@/config/env';

type WebhookContatoPayload = {
  event?: string;
  contact_id?: string;
  db_id?: string;
  fullname?: string;
  name?: string;
  email?: string;
  cellphone?: { number?: string; country_code?: string };
  data?: WebhookContatoPayload;
  contact?: WebhookContatoPayload;
  person?: WebhookContatoPayload;
};

/**
 * Recebe eventos `contact_created` / `contact_updated` do Imobzi em tempo
 * real — é a substituição do polling manual pro dia a dia (o botão
 * "Sincronizar Leads" continua existindo só pra uma carga inicial dos
 * contatos que já existiam ANTES desse webhook ser configurado).
 *
 * Reaproveita a MESMA lógica de upsert já usada no polling
 * (`sincronizarContatoImobzi`) — nunca sobrescreve score/perfil/notas de
 * um lead que já existe, só dados básicos.
 */
export async function imobziWebhookRoutes(app: FastifyInstance) {
  const leadsService = new LeadsService(app.prisma);

  app.post('/webhooks/imobzi/contato', async (request, reply) => {
    const autorizacao = request.headers['authorization'];
    if (!env.IMOBZI_WEBHOOK_TOKEN || autorizacao !== env.IMOBZI_WEBHOOK_TOKEN) {
      return reply.code(401).send({ message: 'Não autorizado' });
    }

    const payload = request.body as WebhookContatoPayload;
    const registro = payload.data ?? payload.contact ?? payload.person ?? payload;

    const imobziId = registro.contact_id ?? registro.db_id;
    if (!imobziId) {
      return reply.code(400).send({ message: 'Payload sem identificador de contato' });
    }

    const telefone = registro.cellphone?.number
      ? `+${registro.cellphone.country_code ?? '55'}${registro.cellphone.number}`
      : null;

    if (!telefone) {
      return reply.code(200).send({ ignorado: true, motivo: 'sem_telefone' });
    }

    await leadsService.sincronizarContatoImobzi({
      id: imobziId,
      nome: registro.fullname ?? registro.name ?? undefined,
      telefone,
      email: registro.email,
    });

    return reply.code(200).send({ ok: true });
  });
}
