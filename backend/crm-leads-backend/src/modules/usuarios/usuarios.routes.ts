import { FastifyInstance } from 'fastify';
import { UsuariosService } from './usuarios.service';
import { criarUsuarioSchema, loginSchema, atualizarUsuarioSchema } from './usuarios.schema';
import { requireRole } from '@/plugins/auth';

export async function usuariosRoutes(app: FastifyInstance) {
  const service = new UsuariosService(app.prisma);

  // Login é público (não exige autenticação prévia)
  app.post('/auth/login', async (request, reply) => {
    const { email, senha } = loginSchema.parse(request.body);

    const usuario = await service.validarCredenciais(email, senha);
    if (!usuario) {
      return reply.code(401).send({ message: 'E-mail ou senha inválidos' });
    }

    const token = app.jwt.sign(
      { sub: usuario.id, papel: usuario.papel },
      { expiresIn: '8h' }
    );

    return reply.send({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    });
  });

  // Demais rotas de usuários exigem autenticação
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', app.authenticate);

    protectedRoutes.get('/usuarios', async (_request, reply) => {
      const usuarios = await service.listar();
      return reply.send(usuarios);
    });

    protectedRoutes.get('/usuarios/me', async (request, reply) => {
      const usuario = await service.buscarPorId(request.user.sub);
      return reply.send(usuario);
    });

    // Fase 10: Gestão de Equipe é uma superfície sensível (cria acessos,
    // define senha temporária) — restrita a 'admin', diferente do padrão
    // gestor+admin usado no resto do sistema (ex: transferência de leads).
    // GET /usuarios continua aberto a gestor/admin (usado no filtro do Kanban
    // e no dropdown de transferência de leads).
    protectedRoutes.post(
      '/usuarios',
      { preHandler: [requireRole('admin')] },
      async (request, reply) => {
        const body = criarUsuarioSchema.parse(request.body);
        try {
          const usuario = await service.criar(body);
          return reply.code(201).send(usuario);
        } catch (err) {
          return reply.code(409).send({ message: (err as Error).message });
        }
      }
    );

    protectedRoutes.patch(
      '/usuarios/:id',
      { preHandler: [requireRole('admin')] },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = atualizarUsuarioSchema.parse(request.body);
        const usuario = await service.atualizar(id, body);
        return reply.send(usuario);
      }
    );
  });
}
