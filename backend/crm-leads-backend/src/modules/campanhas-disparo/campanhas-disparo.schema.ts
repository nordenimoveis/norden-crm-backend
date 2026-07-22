import { z } from 'zod';
import { leadOrigemEnum, leadStatusEnum, leadTemperaturaEnum } from '@/modules/leads/leads.schema';

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
});

export const atualizarCampanhaDisparoSchema = z.object({
  nome: z.string().min(1).optional(),
  templateMensagemId: z.string().uuid().optional(),
});

export type FiltroPublico = z.infer<typeof filtroPublicoSchema>;
export type CriarCampanhaDisparoInput = z.infer<typeof criarCampanhaDisparoSchema>;
export type AtualizarCampanhaDisparoInput = z.infer<typeof atualizarCampanhaDisparoSchema>;
