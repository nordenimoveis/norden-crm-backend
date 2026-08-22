import { z } from 'zod';
import { leadOrigemEnum, leadStatusEnum, leadTemperaturaEnum } from '@/modules/leads/leads.schema';

/**
 * Filtro de público — os mesmos critérios já usados na tela "Meus Leads"
 * (origem/status/temperatura/busca). Reaproveitar esse vocabulário evita
 * inventar um segundo jeito de filtrar lead que o usuário precisaria
 * aprender de novo.
 */
export const filtroPublicoSchema = z.object({
  origem: leadOrigemEnum.optional(),
  status: leadStatusEnum.optional(),
  temperatura: leadTemperaturaEnum.optional(),
  busca: z.string().optional(),
});

export const criarCampanhaDisparoSchema = z.object({
  nome: z.string().min(1, 'Dê um nome para a campanha'),
  templateMensagemId: z.string().uuid('Selecione um template aprovado'),
  filtroPublico: filtroPublicoSchema,
  midiaUrl: z.string().url().optional(),
  // Valores das variáveis {{1}}, {{2}}... na ordem.
  parametros: z.array(z.string()).optional(),
});

export const atualizarCampanhaDisparoSchema = z.object({
  nome: z.string().min(1).optional(),
  templateMensagemId: z.string().uuid().optional(),
  midiaUrl: z.string().url().nullable().optional(),
  parametros: z.array(z.string()).optional(),
});

// Envio teste avulso — para um número, sem público nem campanha salva.
export const enviarTesteSchema = z.object({
  templateMensagemId: z.string().uuid('Selecione um template aprovado'),
  telefone: z.string().min(8, 'Informe um número de teste válido'),
  midiaUrl: z.string().url().optional(),
  parametros: z.array(z.string()).optional(),
});

// Agendamento — data/hora ISO no futuro.
export const agendarSchema = z.object({
  agendadoPara: z.string().datetime({ message: 'Data/hora inválida' }),
});

export type FiltroPublico = z.infer<typeof filtroPublicoSchema>;
export type CriarCampanhaDisparoInput = z.infer<typeof criarCampanhaDisparoSchema>;
export type AtualizarCampanhaDisparoInput = z.infer<typeof atualizarCampanhaDisparoSchema>;
export type EnviarTesteInput = z.infer<typeof enviarTesteSchema>;
export type AgendarInput = z.infer<typeof agendarSchema>;
