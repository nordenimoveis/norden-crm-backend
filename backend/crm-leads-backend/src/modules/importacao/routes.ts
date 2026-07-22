import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { ImportacaoService } from './importacao.service';

export async function importacaoRoutes(app: FastifyInstance) {
  const service = new ImportacaoService(app.prisma);

  app.addHook('preHandler', app.authenticate);

  app.post(
    '/contatos/importar',
    { preHandler: [requireRole('gestor', 'admin')] },
    async (request, reply) => {
      const arquivo = await request.file();

      if (!arquivo) {
        return reply.code(400).send({ message: 'Nenhum arquivo enviado' });
      }

      const nome = arquivo.filename.toLowerCase();
      if (!nome.endsWith('.xlsx') && !nome.endsWith('.csv') && !nome.endsWith('.xls')) {
        return reply.code(400).send({ message: 'Formato inválido. Envie um arquivo .xlsx, .xls ou .csv' });
      }

      const buffer = await arquivo.toBuffer();

      try {
        const resultado = await service.importarContatos(buffer);
        return reply.send(resultado);
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ message: 'Não foi possível processar a planilha. Confira o formato.' });
      }
    }
  );

  app.get(
    '/contatos/exportar',
    { preHandler: [requireRole('gestor', 'admin')] },
    async (request, reply) => {
      const { origem } = request.query as { origem?: string };

      const buffer = await service.exportarContatos(origem);
      const dataHoje = new Date().toISOString().slice(0, 10);

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="contatos-norden-${dataHoje}.xlsx"`)
        .send(buffer);
    }
  );
}
