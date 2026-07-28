import { z } from 'zod';

export const criarImovelSchema = z.object({
  titulo: z.string().min(1, 'Dê um título ao imóvel'),
  bairro: z.string().optional(),
  cidade: z.string().default('Florianópolis'),
  valor: z.coerce.number().positive().optional(),
  metragem: z.coerce.number().int().positive().optional(),
  quartos: z.coerce.number().int().positive().optional(),
  descricao: z.string().optional(),
  fotoUrl: z.string().url().optional(),
  referenciaExterna: z.string().optional(),
  ativo: z.boolean().default(true),
});

export const atualizarImovelSchema = criarImovelSchema.partial();

export type CriarImovelInput = z.infer<typeof criarImovelSchema>;
export type AtualizarImovelInput = z.infer<typeof atualizarImovelSchema>;
