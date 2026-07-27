import { lerCookieToken, removerCookieToken } from './auth-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Callback registrado pelo AuthProvider — desacopla o cliente HTTP do
 * Zustand/React para evitar import circular (o client não precisa saber
 * como o estado de auth é armazenado, só que precisa ser limpo no 401).
 */
let aoDeslogar: (() => void) | null = null;

export function registrarCallbackDeslogar(callback: () => void) {
  aoDeslogar = callback;
}

type ApiFetchOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  semAuth?: boolean; // para rotas públicas, como o próprio login
};

/**
 * Wrapper de fetch com o "interceptor" de token: anexa o Authorization em
 * toda chamada autenticada, e trata 401 fazendo logout automático.
 *
 * TODO (quando o backend ganhar um endpoint de refresh token): antes de
 * desлогar no 401, tentar `POST /api/auth/refresh` com o refresh token e,
 * se der certo, repetir a chamada original com o novo access token. Hoje
 * isso não existe no backend (só há login com JWT de 8h), então o único
 * comportamento seguro é deslogar.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { semAuth, body, headers, ...resto } = options;

  const headersFinais: Record<string, string> = {
    // Content-Type só entra quando existe corpo de verdade — o Fastify
    // rejeita (FST_ERR_CTP_EMPTY_JSON_BODY) uma requisição que declara
    // JSON no header mas manda corpo vazio, que é exatamente o caso das
    // ações "sem payload" tipo marcar-pronta/iniciar-envio (a informação
    // toda já está na URL, no :id).
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(headers as Record<string, string>),
  };

  if (!semAuth) {
    const token = lerCookieToken();
    if (token) headersFinais['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...resto,
    headers: headersFinais,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !semAuth) {
    removerCookieToken();
    aoDeslogar?.();
    throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload.message ?? 'Erro inesperado na requisição.');
  }

  // 204 No Content não tem corpo para parsear
  if (response.status === 204) return undefined as T;

  return response.json();
}
