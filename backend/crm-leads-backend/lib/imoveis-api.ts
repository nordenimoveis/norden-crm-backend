import { apiFetch } from './api-client';
import { lerCookieToken } from './auth-cookie';
import { Imovel, DadosImovelExtraidos } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type ImovelInput = {
  titulo: string;
  bairro?: string;
  cidade?: string;
  valor?: number;
  metragem?: number;
  quartos?: number;
  descricao?: string;
  fotoUrl?: string;
  referenciaExterna?: string;
  ativo?: boolean;
};

export async function listarImoveis(incluirInativos = false): Promise<Imovel[]> {
  const params = incluirInativos ? '?incluirInativos=true' : '';
  return apiFetch<Imovel[]>(`/api/imoveis${params}`);
}

export async function criarImovel(input: ImovelInput): Promise<Imovel> {
  return apiFetch<Imovel>('/api/imoveis', { method: 'POST', body: input });
}

export async function atualizarImovel(id: string, input: Partial<ImovelInput>): Promise<Imovel> {
  return apiFetch<Imovel>(`/api/imoveis/${id}`, { method: 'PATCH', body: input });
}

export async function deletarImovel(id: string): Promise<void> {
  return apiFetch<void>(`/api/imoveis/${id}`, { method: 'DELETE' });
}

export async function extrairImovelDePdf(arquivo: File): Promise<DadosImovelExtraidos> {
  const token = lerCookieToken();
  const formData = new FormData();
  formData.append('file', arquivo);

  const response = await fetch(`${API_URL}/api/imoveis/extrair-pdf`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const erro = await response.json().catch(() => ({}));
    throw new Error(erro.message ?? 'Falha ao extrair dados do PDF');
  }

  return response.json();
}

export async function extrairImovelDeUrl(url: string): Promise<DadosImovelExtraidos> {
  return apiFetch<DadosImovelExtraidos>('/api/imoveis/extrair-url', {
    method: 'POST',
    body: { url },
  });
}
