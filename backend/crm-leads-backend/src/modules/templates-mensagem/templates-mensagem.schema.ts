import { z } from 'zod';

export const criarTemplateMensagemSchema = z.object({
  nome: z.string().min(1, 'Dê um nome ao template'),
  conteudo: z.string().min(1, 'O texto do template é obrigatório'),
  metaTemplateName: z.string().min(1).optional(),
  aprovadoMeta: z.boolean().default(false),
});

export const atualizarTemplateMensagemSchema = z.object({
  nome: z.string().min(1).optional(),
  conteudo: z.string().min(1).optional(),
  metaTemplateName: z.string().min(1).nullable().optional(),
  aprovadoMeta: z.boolean().optional(),
});

export type CriarTemplateMensagemInput = z.infer<typeof criarTemplateMensagemSchema>;
export type AtualizarTemplateMensagemInput = z.infer<typeof atualizarTemplateMensagemSchema>;
