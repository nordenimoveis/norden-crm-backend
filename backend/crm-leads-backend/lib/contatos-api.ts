import { lerCookieToken } from './auth-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type ResultadoImportacao = {
  totalLinhas: number;
  importados: number;
  duplicados: number;
  invalidos: number;
  exemplosInvalidos: { linha: number; motivo: string }[];
};

/**
 * Upload da planilha via FormData (não JSON) — por isso não usa o apiFetch
 * padrão, que assume corpo JSON. O token é anexado manualmente.
 */
export async function importarContatos(arquivo: File): Promise<ResultadoImportacao> {
  const token = lerCookieToken();
  const formData = new FormData();
  formData.append('file', arquivo);

  const response = await fetch(`${API_URL}/api/contatos/importar`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const erro = await response.json().catch(() => ({}));
    throw new Error(erro.message ?? 'Falha ao importar a planilha');
  }

  return response.json();
}

/**
 * Download da planilha de contatos. Como é um arquivo binário (não JSON),
 * baixa o blob e dispara o download no navegador manualmente.
 */
export async function exportarContatos(origem?: string): Promise<void> {
  const token = lerCookieToken();
  const params = origem ? `?origem=${origem}` : '';

  const response = await fetch(`${API_URL}/api/contatos/exportar${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error('Falha ao exportar contatos');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `contatos-norden-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
