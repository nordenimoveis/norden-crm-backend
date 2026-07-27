import { z } from 'zod';

export const ingerirUrlSchema = z.object({
  titulo: z.string().min(1, 'Dê um título ao documento'),
  url: z.string().url('URL inválida'),
});

export const atualizarStatusIASchema = z.object({
  statusIA: z.enum(['inativa', 'ativa', 'pausada_humano']),
});

export type IngerirUrlInput = z.infer<typeof ingerirUrlSchema>;
export type AtualizarStatusIAInput = z.infer<typeof atualizarStatusIASchema>;
