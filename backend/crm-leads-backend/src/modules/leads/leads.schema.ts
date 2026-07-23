import { z } from 'zod';

export const leadStatusEnum = z.enum([
  'novo',
  'respondeu',
  'em_atendimento',
  'visita_agendada',
  'proposta',
  'negocio_fechado',
  'perdido',
  'frio_standby',
]);

export const leadOrigemEnum = z.enum([
  'meta_ads',
  'site_imobzi',
  'legado_imobzi',
  'importacao_planilha',
  'manual',
]);

export const leadTemperaturaEnum = z.enum(['nao_avaliado', 'frio', 'morno', 'quente']);

export const tipoAgendamentoEnum = z.enum(['visita', 'reuniao', 'ligacao', 'whatsapp', 'outro']);

export const criarLeadSchema = z.object({
  nome: z.string().min(1).optional(),
  telefone: z.string().min(8, 'Telefone inválido'),
  email: z.string().email().optional(),
  campanhaId: z.string().uuid().optional(),
  imovelId: z.string().uuid().optional(),
  origem: leadOrigemEnum.default('meta_ads'),
  imobziId: z.string().optional(),
  payloadBruto: z.record(z.any()).optional(),
});

export const criarLeadManualSchema = z.object({
  nome: z.string().min(1, 'Informe o nome do lead'),
  telefone: z.string().min(8, 'Telefone inválido'),
  email: z.string().email().optional(),
  corretorId: z.string().uuid().optional(),
});

export const imobziWebhookLeadSchema = z.object({
  imobzi_id: z.string().min(1),
  nome: z.string().min(1).optional(),
  telefone: z.string().min(8, 'Telefone inválido'),
  email: z.string().email().optional(),
});

export const imobziLeadLegadoSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional(),
  phone: z.string().min(8, 'Telefone inválido'),
  email: z.string().email().nullable().optional(),
});

export const atualizarLeadSchema = z.object({
  nome: z.string().min(1).optional(),
  telefone: z.string().min(8, 'Telefone inválido').optional(),
  email: z.string().email().optional(),
  imovelId: z.string().uuid().nullable().optional(),
  dataAgendamento: z.coerce.date().nullable().optional(),
  tipoAgendamento: tipoAgendamentoEnum.nullable().optional(),
});

export const atualizarStatusSchema = z.object({
  status: leadStatusEnum,
});

export const atualizarTemperaturaSchema = z.object({
  temperatura: leadTemperaturaEnum,
});

export const atribuirCorretorSchema = z.object({
  corretorId: z.string().uuid(),
});

export const listarLeadsQuerySchema = z.object({
  status: leadStatusEnum.optional(),
  corretorId: z.string().uuid().optional(),
  campanhaId: z.string().uuid().optional(),
  origem: leadOrigemEnum.optional(),
  temperatura: leadTemperaturaEnum.optional(),
  busca: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export type CriarLeadInput = z.infer<typeof criarLeadSchema>;
export type CriarLeadManualInput = z.infer<typeof criarLeadManualSchema>;
export type ImobziWebhookLeadInput = z.infer<typeof imobziWebhookLeadSchema>;
export type ImobziLeadLegadoInput = z.infer<typeof imobziLeadLegadoSchema>;
export type AtualizarLeadInput = z.infer<typeof atualizarLeadSchema>;
export type AtualizarStatusInput = z.infer<typeof atualizarStatusSchema>;
export type AtualizarTemperaturaInput = z.infer<typeof atualizarTemperaturaSchema>;
export type AtribuirCorretorInput = z.infer<typeof atribuirCorretorSchema>;
export type ListarLeadsQuery = z.infer<typeof listarLeadsQuerySchema>;
