import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { criarTemplateMensagemSchema, atualizarTemplateMensagemSchema } from './templates-mensagem.schema';
import { TemplatesMensagemService } from './templates-mensagem.service';

/**
 * CRUD simples de templates de mensagem. A criação/aprovação de um template
 * de verdade acontece no Meta Business Suite — esta tela só REGISTRA no
 * nosso banco o que já foi aprovado lá (ou permite deixar um rascunho
 * marcado como não aprovado, para organizar candidatos a template antes de
 * submeter para aprovação).
 */
export async function templatesMensagemRoutes(app: FastifyInstance) {
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);
    protectedRoutes.addHook('preHandler', requireRole('gestor', 'admin'));

    const service = new TemplatesMensagemService(app.prisma);

    protectedRoutes.get('/api/templates-mensagem', async (_request, reply) => {
      const templates = await app.prisma.templateMensagem.findMany({ orderBy: { criadoEm: 'desc' } });
      return reply.send(templates);
    });

    // Puxa os templates aprovados direto da Meta (Graph API) e faz upsert.
    protectedRoutes.post('/api/templates-mensagem/sincronizar-meta', async (_request, reply) => {
      try {
        const resumo = await service.sincronizarComMeta();
        return reply.send(resumo);
      } catch (err) {
        return reply.code(400).send({ message: (err as Error).message });
      }
    });

    protectedRoutes.post('/api/templates-mensagem', async (request, reply) => {
      const body = criarTemplateMensagemSchema.parse(request.body);
      const template = await app.prisma.templateMensagem.create({ data: body });
      return reply.code(201).send(template);
    });

    protectedRoutes.patch('/api/templates-mensagem/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = atualizarTemplateMensagemSchema.parse(request.body);
      const template = await app.prisma.templateMensagem.update({ where: { id }, data: body });
      return reply.send(template);
    });
  });
}
