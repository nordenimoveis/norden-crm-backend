import { apiFetch } from './api-client';
import { QuickReply, QuickReplyTipo } from './types';

export type CriarQuickReplyInput = {
  titulo: string;
  textoMensagem: string;
  tipo: QuickReplyTipo;
};

export type AtualizarQuickReplyInput = Partial<Pick<CriarQuickReplyInput, 'titulo' | 'textoMensagem'>> & {
  ativo?: boolean;
  paraAvaliacaoGoogle?: boolean;
};

export async function criarQuickReply(input: CriarQuickReplyInput): Promise<QuickReply> {
  return apiFetch<QuickReply>('/api/quick-replies', { method: 'POST', body: input });
}

export async function atualizarQuickReply(id: string, input: AtualizarQuickReplyInput): Promise<QuickReply> {
  return apiFetch<QuickReply>(`/api/quick-replies/${id}`, { method: 'PATCH', body: input });
}

export async function deletarQuickReply(id: string): Promise<void> {
  return apiFetch<void>(`/api/quick-replies/${id}`, { method: 'DELETE' });
}
