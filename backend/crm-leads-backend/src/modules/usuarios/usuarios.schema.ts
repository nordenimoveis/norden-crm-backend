import { z } from 'zod';

export const papelEnum = z.enum(['gestor', 'corretor', 'admin']);

export const criarUsuarioSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  senha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres'),
  papel: papelEnum.default('corretor'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

export const atualizarUsuarioSchema = z.object({
  nome: z.string().min(1).optional(),
  papel: papelEnum.optional(),
  ativo: z.boolean().optional(),
});

export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AtualizarUsuarioInput = z.infer<typeof atualizarUsuarioSchema>;
