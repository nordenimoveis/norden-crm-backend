import { z } from 'zod';

export const definirLimiteDiarioSchema = z.object({
  limite: z.number().int().positive().max(10000, 'Valor acima do razoável — confirme se é isso mesmo'),
});

export type DefinirLimiteDiarioInput = z.infer<typeof definirLimiteDiarioSchema>;
