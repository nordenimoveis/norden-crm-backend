import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { env } from '@/config/env';
import { WhatsappService } from './whatsapp.service';
import { whatsappWebhookPayloadSchema, enviarTextoSchema, enviarTemplateSchema } from './whatsapp.schema';

function validarAssinatura(rawBody: string, assinaturaHeader?: string): boolean {
  if (!env.META_APP_SECRET) return env.NODE_ENV !== 'production';
  if (!assinaturaHeader) return false;

  const esperado = crypto.createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');
  const recebido = assinaturaHeader.replace('sha256=', '');

  const bufEsperado = Buffer.from(esperado, 'hex');
  const bufRecebido = Buffer.from(recebido, 'hex');
  if (bufEsperado.length !== bufRecebido.length) return false;

  return crypto.timingSafeEqual(bufEsperado, bufRecebido);
}

export async function whatsappRoutes(app: FastifyInstance) {
  const service = new WhatsappService(app.prisma);

  // Mesmo padrão do módulo meta-ads: precisamos do corpo bruto para validar a assinatura.
  // O WhatsApp Cloud API usa o MESMO app secret do Meta App (é o mesmo aplicativo).
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

  // Verificação inicial do webhook (mesmo mecanismo do Meta Ads)
  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }

    return reply.code(403).send({ message: 'Token de verificação inválido' });
  });

  // Recebimento de mensagens e atualizações de status
  app.post('/webhooks/whatsapp', async (request, reply) => {
    const assinatura = request.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (request as any).rawBody as string;

    if (!validarAssinatura(rawBody, assinatura)) {
      request.log.warn('Assinatura inválida recebida no webhook do WhatsApp');
      return reply.code(401).send({ message: 'Assinatura inválida' });
    }

    const payload = whatsappWebhookPayloadSchema.parse(request.body);
    await service.processarWebhook(payload);

    return reply.code(200).send({ recebido: true });
  });

  // Endpoints internos (autenticados) para disparo manual — usados pelo chat
  // do painel quando um corretor assume a conversa manualmente.
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    protectedRoutes.post('/api/whatsapp/leads/:leadId/texto', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const body = enviarTextoSchema.parse(request.body);

      // RBAC: corretor só pode responder por leads atribuídos a ele.
      if (request.user.papel === 'corretor') {
        const lead = await app.prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead || lead.corretorId !== request.user.sub) {
          return reply.code(403).send({ message: 'Você só pode responder por leads atribuídos a você' });
        }
      }

      const mensagem = await service.enviarTexto(leadId, body, request.user.sub);
      return reply.code(201).send(mensagem);
    });

    protectedRoutes.post('/api/whatsapp/leads/:leadId/template', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const body = enviarTemplateSchema.parse(request.body);
      const mensagem = await service.enviarTemplate(leadId, body);
      return reply.code(201).send(mensagem);
    });
  });
}
