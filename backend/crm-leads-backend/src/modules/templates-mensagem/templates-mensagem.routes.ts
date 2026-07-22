import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { criarTemplateMensagemSchema, atualizarTemplateMensagemSchema } from './templates-mensagem.schema';

export async function templatesMensagemRoutes(app: FastifyInstance) {
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);
    protectedRoutes.addHook('preHandler', requireRole('gestor', 'admin'));

    protectedRoutes.get('/api/templates-mensagem', async (_request, reply) => {
      const templates = await app.prisma.templateMensagem.findMany({ orderBy: { criadoEm: 'desc' } });
      return reply.send(templates);
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
