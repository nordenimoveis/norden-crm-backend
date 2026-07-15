import { FastifyInstance } from 'fastify';
import { env } from '@/config/env';
import { MetaAdsService } from './meta-ads.service';
import { metaWebhookPayloadSchema } from './meta-ads.schema';

export async function metaAdsRoutes(app: FastifyInstance) {
  const service = new MetaAdsService(app.prisma);

  // Content-type parser customizado APENAS neste escopo (Fastify encapsula por padrão),
  // para termos acesso ao corpo bruto (raw) e validar a assinatura HMAC do Meta.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      (request as any).rawBody = body.toString('utf8');
      try {
        const json = body.length ? JSON.parse(body.toString('utf8')) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  /**
   * Passo 1 do setup no Meta: verificação do endpoint do webhook.
   * O Meta chama esse GET uma vez ao configurar, e espera receber de volta
   * o valor de hub.challenge caso o hub.verify_token bata com o nosso.
   */
  app.get('/webhooks/meta', async (request, reply) => {
    const query = request.query as Record<string, string>;

    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }

    return reply.code(403).send({ message: 'Token de verificação inválido' });
  });

  /**
   * Passo 2: recebimento real dos eventos de leadgen.
   */
  app.post('/webhooks/meta', async (request, reply) => {
    const assinatura = request.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (request as any).rawBody as string;

    const assinaturaValida = service.validarAssinatura(rawBody, assinatura);
    if (!assinaturaValida) {
      request.log.warn('Assinatura inválida recebida no webhook do Meta');
      return reply.code(401).send({ message: 'Assinatura inválida' });
    }

    const payload = metaWebhookPayloadSchema.parse(request.body);

    // Responde 200 rapidamente (Meta espera resposta rápida) e processa em seguida.
    // Para volumes altos, o ideal é apenas enfileirar aqui e processar assíncrono —
    // deixamos direto por simplicidade neste estágio inicial.
    const resultados = await service.processarWebhook(payload);

    return reply.code(200).send({ recebido: true, resultados });
  });
}
