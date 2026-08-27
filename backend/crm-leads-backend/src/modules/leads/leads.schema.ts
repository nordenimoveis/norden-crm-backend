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

// Compromisso agendado com o lead — desacoplado do status do Kanban de
// propósito: um lead "Em Atendimento" pode ter uma ligação marcada pra
// amanhã sem precisar estar na coluna "Visita Agendada".
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

// Cadastro manual pela equipe (telefone, indicação, presencial) — NUNCA
// dispara a cadência automática sozinho (decisão explícita: quem cadastra
// manualmente decide quando e como contatar, sem o sistema mandar mensagem
// por conta própria).
export const criarLeadManualSchema = z.object({
  nome: z.string().min(1, 'Informe o nome do lead'),
  telefone: z.string().min(8, 'Telefone inválido'),
  email: z.string().email().optional(),
  // Se não informado, cai no round-robin normal — mas quem está cadastrando
  // pode escolher atribuir direto a um corretor específico (ex: o próprio).
  corretorId: z.string().uuid().optional(),
});

/**
 * Formato NORMALIZADO interno usado pelo LeadsService — já traduzido a partir
 * da estrutura real do Imobzi (que vive em `imobzi.schema.ts`). Manter o
 * LeadsService desacoplado do formato de campos específico do Imobzi.
 */
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

// Edição de dados básicos do lead — status e corretorId NÃO entram aqui de
// propósito: já existem rotas dedicadas (atualizarStatus/atribuirCorretor)
// com verificação de RBAC própria. Misturar tudo num PATCH genérico sem
// essas checagens seria um jeito de um corretor contornar essas regras.
export const perfilBuscaSchema = z.object({
  bairro: z.string().optional(),
  orcamentoMin: z.number().positive().optional(),
  orcamentoMax: z.number().positive().optional(),
  quartos: z.number().int().positive().optional(),
  finalidade: z.enum(['moradia', 'investimento']).optional(),
});

export const atualizarLeadSchema = z.object({
  nome: z.string().min(1).optional(),
  telefone: z.string().min(8, 'Telefone inválido').optional(),
  email: z.string().email().optional(),
  imovelId: z.string().uuid().nullable().optional(),
  // Data/hora + tipo do próximo compromisso — null explícito serve pra "desmarcar"
  dataAgendamento: z.coerce.date().nullable().optional(),
  tipoAgendamento: tipoAgendamentoEnum.nullable().optional(),
  perfilBusca: perfilBuscaSchema.nullable().optional(),
  perfilSemantico: z.string().nullable().optional(),
});

export const criarNotaInternaSchema = z.object({
  texto: z.string().min(1, 'A nota não pode ficar vazia'),
});

// Fase 5: mudança de coluna no Kanban
export const atualizarStatusSchema = z.object({
  status: leadStatusEnum,
});

// Fase 5: alteração rápida da temperatura do lead (sem abrir o cadastro completo)
export const atualizarTemperaturaSchema = z.object({
  temperatura: leadTemperaturaEnum,
});

// Fase 5: transferência de lead entre corretores (só gestor/admin)
export const atribuirCorretorSchema = z.object({
  corretorId: z.string().uuid(),
});

export const listarLeadsQuerySchema = z.object({
  status: leadStatusEnum.optional(),
  corretorId: z.string().uuid().optional(),
  campanhaId: z.string().uuid().optional(),
  origem: leadOrigemEnum.optional(),
  temperatura: leadTemperaturaEnum.optional(), // suporta os filtros rápidos "Apenas Quentes"/"Apenas Mornos"
  busca: z.string().optional(), // busca livre por nome/telefone (tela "Meus Leads")
  // Por padrão a lista esconde arquivados. `mostrarArquivadas=true` traz só os
  // arquivados (para uma aba/filtro "Arquivados", se quiser).
  mostrarArquivadas: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export const arquivarLeadSchema = z.object({
  arquivada: z.boolean(),
});

export type CriarLeadInput = z.infer<typeof criarLeadSchema>;
export type CriarLeadManualInput = z.infer<typeof criarLeadManualSchema>;
export type ImobziWebhookLeadInput = z.infer<typeof imobziWebhookLeadSchema>;
export type ImobziLeadLegadoInput = z.infer<typeof imobziLeadLegadoSchema>;
export type AtualizarLeadInput = z.infer<typeof atualizarLeadSchema>;
export type CriarNotaInternaInput = z.infer<typeof criarNotaInternaSchema>;
export type AtualizarStatusInput = z.infer<typeof atualizarStatusSchema>;
export type AtualizarTemperaturaInput = z.infer<typeof atualizarTemperaturaSchema>;
export type AtribuirCorretorInput = z.infer<typeof atribuirCorretorSchema>;
export type ListarLeadsQuery = z.infer<typeof listarLeadsQuerySchema>;
export type ArquivarLeadInput = z.infer<typeof arquivarLeadSchema>;
