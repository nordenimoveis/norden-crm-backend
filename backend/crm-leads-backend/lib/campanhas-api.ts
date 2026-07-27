import { apiFetch } from './api-client';
import { lerCookieToken } from './auth-cookie';
import { CampanhaDisparo, CampanhaDisparoDetalhado, FiltroPublico, MidiaTipo } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type CriarCampanhaInput = {
  nome: string;
  templateMensagemId: string;
  filtroPublico: FiltroPublico;
  midiaUrl?: string;
};

export async function listarCampanhas(): Promise<CampanhaDisparo[]> {
  return apiFetch<CampanhaDisparo[]>('/api/campanhas-disparo');
}

export async function buscarCampanha(id: string): Promise<CampanhaDisparoDetalhado> {
  return apiFetch<CampanhaDisparoDetalhado>(`/api/campanhas-disparo/${id}`);
}

export async function previewPublico(filtro: FiltroPublico): Promise<{ total: number }> {
  const params = new URLSearchParams();
  if (filtro.origem) params.set('origem', filtro.origem);
  if (filtro.status) params.set('status', filtro.status);
  if (filtro.temperatura) params.set('temperatura', filtro.temperatura);
  if (filtro.busca) params.set('busca', filtro.busca);

  return apiFetch<{ total: number }>(`/api/campanhas-disparo/preview-publico?${params.toString()}`);
}

export async function criarCampanha(input: CriarCampanhaInput): Promise<CampanhaDisparo> {
  return apiFetch<CampanhaDisparo>('/api/campanhas-disparo', { method: 'POST', body: input });
}

export async function marcarCampanhaComoPronta(id: string): Promise<CampanhaDisparo> {
  return apiFetch<CampanhaDisparo>(`/api/campanhas-disparo/${id}/marcar-pronta`, { method: 'POST' });
}

export async function iniciarEnvioCampanha(id: string): Promise<CampanhaDisparo> {
  return apiFetch<CampanhaDisparo>(`/api/campanhas-disparo/${id}/iniciar-envio`, { method: 'POST' });
}

export async function deletarCampanha(id: string): Promise<void> {
  return apiFetch<void>(`/api/campanhas-disparo/${id}`, { method: 'DELETE' });
}

export type ResultadoUploadMidia = { url: string; tipo: MidiaTipo };

/**
 * Upload via FormData — não usa o apiFetch padrão (que assume JSON), mesmo
 * padrão já usado na importação de planilhas.
 */
export async function uploadMidiaCampanha(arquivo: File): Promise<ResultadoUploadMidia> {
  const token = lerCookieToken();
  const formData = new FormData();
  formData.append('file', arquivo);

  const response = await fetch(`${API_URL}/api/campanhas-disparo/upload-midia`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const erro = await response.json().catch(() => ({}));
    throw new Error(erro.message ?? 'Falha ao enviar o arquivo');
  }

  return response.json();
}
