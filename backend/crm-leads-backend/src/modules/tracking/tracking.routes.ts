import { FastifyInstance } from 'fastify';
import { incrementarScore } from '@/lib/score.service';

/**
 * Rota PÚBLICA de propósito — quem clica é o LEAD, pelo WhatsApp, sem
 * nenhum login no CRM. Um link enviado numa mensagem, em vez de apontar
 * direto pro destino, aponta pra cá com `?url=<destino real>` (e,
 * opcionalmente, `?imovelId=<id>` quando o link é de um imóvel específico
 * — nesse caso vira histórico de interesse, não só um ponto de score solto).
 */
export async function trackingRoutes(app: FastifyInstance) {
  app.get('/track/:leadId', async (request, reply) => {
    const { leadId } = request.params as { leadId: string };
    const { url, imovelId } = request.query as { url?: string; imovelId?: string };

    if (!url) {
      return reply.code(400).send({ message: 'Parâmetro url é obrigatório' });
    }

    try {
      await incrementarScore(app.prisma, leadId, 'clique_link');
      if (imovelId) {
        await app.prisma.imovelVisualizacao.create({ data: { leadId, imovelId } });
      }
    } catch {
      // Mesmo se o lead não existir mais ou o score falhar por algum
      // motivo, o clique não pode ficar travado — o link tem que abrir.
    }

    return reply.redirect(decodeURIComponent(url));
  });
}
