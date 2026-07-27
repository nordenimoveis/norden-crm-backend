import { apiFetch } from './api-client';
import { lerCookieToken } from './auth-cookie';
import { Documento } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function listarDocumentos(): Promise<Documento[]> {
  return apiFetch<Documento[]>('/api/ia/documentos');
}

export async function uploadDocumentoPdf(arquivo: File, titulo: string): Promise<Documento> {
  const token = lerCookieToken();
  const formData = new FormData();
  formData.append('file', arquivo);

  const params = new URLSearchParams({ titulo });

  const response = await fetch(`${API_URL}/api/ia/documentos/upload?${params.toString()}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const erro = await response.json().catch(() => ({}));
    throw new Error(erro.message ?? 'Falha ao enviar o documento');
  }

  return response.json();
}

export async function ingerirDocumentoUrl(titulo: string, url: string): Promise<Documento> {
  return apiFetch<Documento>('/api/ia/documentos/url', {
    method: 'POST',
    body: { titulo, url },
  });
}

export async function deletarDocumento(id: string): Promise<void> {
  return apiFetch<void>(`/api/ia/documentos/${id}`, { method: 'DELETE' });
}
