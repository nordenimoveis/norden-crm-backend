import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Canal } from '@prisma/client';
import { env } from '@/config/env';
import { MetaMessagingService } from './meta-messaging.service';
import {
  metaMessagingPayloadSchema,
  enviarDmSchema,
  responderComentarioSchema,
  listarComentariosQuerySchema,
} from './meta-messaging.schema';

function validarAssinatura(rawBody: string, assinaturaHeader?: string): boolean {
  // Mesmo mecanismo dos webhooks Meta Ads / WhatsApp: HMAC SHA-256 do corpo
  // bruto com o app secret. Em dev, sem secret configurada, não bloqueia.
  if (!env.META_APP_SECRET) return env.NODE_ENV !== 'production';
  if (!assinaturaHeader) return false;

  const esperado = crypto.createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');
  const recebido = assinaturaHeader.replace('sha256=', '');

  const bufEsperado = Buffer.from(esperado, 'hex');
  const bufRecebido = Buffer.from(recebido, 'hex');
  if (bufEsperado.length !== bufRecebido.length) return false;

  return crypto.timingSafeEqual(bufEsperado, bufRecebido);
}

export async function metaMessagingRoutes(app: FastifyInstance) {
  const service = new MetaMessagingService(app.prisma);

  // Corpo bruto para validar assinatura — escopo encapsulado neste plugin,
  // igual aos módulos meta-ads e whatsapp.
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

  // Verificação inicial do webhook (Instagram + Messenger compartilham o mesmo
  // endpoint; o campo `object` do payload distingue a origem no POST).
  app.get('/webhooks/meta-messaging', async (request, reply) => {
    const query = request.query as Record<string, string>;
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === env.META_VERIFY_TOKEN) {
      return reply.code(200).send(query['hub.challenge']);
    }
    return reply.code(403).send({ message: 'Token de verificação inválido' });
  });

  app.post('/webhooks/meta-messaging', async (request, reply) => {
    const assinatura = request.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (request as any).rawBody as string;

    if (!validarAssinatura(rawBody, assinatura)) {
      request.log.warn('Assinatura inválida no webhook de mensageria da Meta');
      return reply.code(401).send({ message: 'Assinatura inválida' });
    }

    const parsed = metaMessagingPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      // Nunca devolve 4xx aqui: a Meta reenvia em cima de erro e um payload
      // com formato novo não deve virar loop de reentrega. Loga e segue.
      request.log.warn({ erro: parsed.error.flatten() }, 'Payload de mensageria inesperado');
      return reply.code(200).send({ recebido: true, ignorado: true });
    }

    // Processa após responder 200 rápido (a Meta exige resposta ágil).
    reply.code(200).send({ recebido: true });
    await service.processarWebhook(parsed.data);
  });

  // -------- Endpoints internos autenticados (usados pelo painel) -------------
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    // Enviar DM (Instagram/Messenger) por um lead.
    protectedRoutes.post('/api/mensageria/leads/:leadId/:canal/texto', async (request, reply) => {
      const { leadId, canal } = request.params as { leadId: string; canal: string };
      if (canal !== 'instagram' && canal !== 'messenger') {
        return reply.code(400).send({ message: 'Canal inválido para este endpoint' });
      }
      const body = enviarDmSchema.parse(request.body);

      // RBAC: corretor só responde por leads atribuídos a ele.
      if (request.user.papel === 'corretor') {
        const lead = await app.prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead || lead.corretorId !== request.user.sub) {
          return reply.code(403).send({ message: 'Você só pode responder por leads atribuídos a você' });
        }
      }

      const mensagem = await service.enviarDm(
        leadId,
        canal as Canal,
        body.texto,
        request.user.sub
      );
      return reply.code(201).send(mensagem);
    });

    // Listar comentários de posts (caixa de entrada de comentários).
    protectedRoutes.get('/api/mensageria/comentarios', async (request, reply) => {
      const query = listarComentariosQuerySchema.parse(request.query);
      const comentarios = await service.listarComentarios(query);
      return reply.send(comentarios);
    });

    // Responder um comentário publicamente.
    protectedRoutes.post('/api/mensageria/comentarios/:comentarioId/responder', async (request, reply) => {
      const { comentarioId } = request.params as { comentarioId: string };
      const body = responderComentarioSchema.parse(request.body);
      const resultado = await service.responderComentario(comentarioId, body.texto, request.user.sub);
      return reply.code(201).send(resultado);
    });
  });
}
