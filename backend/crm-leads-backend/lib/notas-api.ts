import { apiFetch } from './api-client';
import { NotaInterna } from './types';

export async function listarNotas(leadId: string): Promise<NotaInterna[]> {
  return apiFetch<NotaInterna[]>(`/api/leads/${leadId}/notas`);
}

export async function criarNota(leadId: string, texto: string): Promise<NotaInterna> {
  return apiFetch<NotaInterna>(`/api/leads/${leadId}/notas`, {
    method: 'POST',
    body: { texto },
  });
}
