import { z } from 'zod';

export const quickReplyTipoEnum = z.enum(['global', 'pessoal']);

export const criarQuickReplySchema = z.object({
  titulo: z.string().min(1, 'Título é obrigatório'),
  textoMensagem: z.string().min(1, 'Texto da mensagem é obrigatório'),
  tipo: quickReplyTipoEnum,
});

export const atualizarQuickReplySchema = z.object({
  titulo: z.string().min(1).optional(),
  textoMensagem: z.string().min(1).optional(),
  ativo: z.boolean().optional(),
  paraAvaliacaoGoogle: z.boolean().optional(),
});

export const buscarQuickReplyQuerySchema = z.object({
  busca: z.string().optional(),
});

export type CriarQuickReplyInput = z.infer<typeof criarQuickReplySchema>;
export type AtualizarQuickReplyInput = z.infer<typeof atualizarQuickReplySchema>;
export type BuscarQuickReplyQuery = z.infer<typeof buscarQuickReplyQuerySchema>;
