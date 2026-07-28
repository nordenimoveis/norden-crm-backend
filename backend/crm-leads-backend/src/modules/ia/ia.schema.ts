import { z } from 'zod';

export const ingerirUrlSchema = z.object({
  titulo: z.string().min(1, 'Dê um título ao documento'),
  url: z.string().url('URL inválida'),
});

export const mensagemHistoricoSchema = z.object({
  autor: z.enum(['lead', 'equipe']),
  texto: z.string(),
});

export const simularPerguntaSchema = z.object({
  pergunta: z.string().min(1, 'Digite uma pergunta'),
  // Histórico da conversa simulada até agora — necessário pra reescrita de
  // query funcionar no Playground (sem isso, cada pergunta chegaria
  // isolada, sem saber do que foi falado antes).
  historico: z.array(mensagemHistoricoSchema).optional().default([]),
});

export const atualizarStatusIASchema = z.object({
  statusIA: z.enum(['inativa', 'ativa', 'pausada_humano']),
});

export type IngerirUrlInput = z.infer<typeof ingerirUrlSchema>;
export type SimularPerguntaInput = z.infer<typeof simularPerguntaSchema>;
export type AtualizarStatusIAInput = z.infer<typeof atualizarStatusIASchema>;
