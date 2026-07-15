import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { CriarUsuarioInput, AtualizarUsuarioInput } from './usuarios.schema';

const SALT_ROUNDS = 10;

export class UsuariosService {
  constructor(private prisma: PrismaClient) {}

  async criar(input: CriarUsuarioInput) {
    const existente = await this.prisma.usuario.findUnique({ where: { email: input.email } });
    if (existente) {
      throw new Error('Já existe um usuário com este e-mail');
    }

    const senhaHash = await bcrypt.hash(input.senha, SALT_ROUNDS);

    const usuario = await this.prisma.usuario.create({
      data: {
        nome: input.nome,
        email: input.email,
        senhaHash,
        papel: input.papel,
      },
    });

    return this.semSenha(usuario);
  }

  async listar() {
    const usuarios = await this.prisma.usuario.findMany({ orderBy: { nome: 'asc' } });
    return usuarios.map(this.semSenha);
  }

  async buscarPorId(id: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    return usuario ? this.semSenha(usuario) : null;
  }

  async atualizar(id: string, input: AtualizarUsuarioInput) {
    const usuario = await this.prisma.usuario.update({ where: { id }, data: input });
    return this.semSenha(usuario);
  }

  /**
   * Verifica credenciais e retorna o usuário se forem válidas.
   * Não lança erro específico sobre "email não existe" vs "senha errada" de propósito,
   * para não vazar quais e-mails estão cadastrados.
   */
  async validarCredenciais(email: string, senha: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });

    if (!usuario || !usuario.ativo) {
      return null;
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaValida) {
      return null;
    }

    return usuario;
  }

  private semSenha<T extends { senhaHash: string }>(usuario: T) {
    const { senhaHash, ...resto } = usuario;
    return resto;
  }
}
