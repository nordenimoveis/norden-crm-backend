import { apiFetch } from './api-client';
import { LeadDetalhado, Mensagem, QuickReply } from './types';

export async function buscarLeadDetalhado(leadId: string): Promise<LeadDetalhado> {
  return apiFetch<LeadDetalhado>(`/api/leads/${leadId}`);
}

export async function enviarMensagemTexto(
  leadId: string,
  telefone: string,
  texto: string
): Promise<Mensagem> {
  return apiFetch<Mensagem>(`/api/whatsapp/leads/${leadId}/texto`, {
    method: 'POST',
    body: { telefone, texto },
  });
}

export async function buscarQuickReplies(busca?: string): Promise<QuickReply[]> {
  const params = new URLSearchParams();
  if (busca) params.set('busca', busca);
  const query = params.toString();
  return apiFetch<QuickReply[]>(`/api/quick-replies${query ? `?${query}` : ''}`);
}
