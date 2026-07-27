/**
 * Cookie usado para guardar o JWT.
 *
 * NOTA DE SEGURANÇA: este cookie NÃO é httpOnly, porque o front-end fala
 * diretamente com a API do backend via fetch do lado do cliente (não temos
 * um BFF/proxy no Next.js repassando as chamadas). Um cookie httpOnly não
 * pode ser lido por JavaScript, então o `apiFetch` não conseguiria anexar o
 * token no header Authorization.
 *
 * Trade-off consciente: um cookie não-httpOnly é acessível por um XSS, caso
 * exista uma vulnerabilidade desse tipo na aplicação. Para um CRM interno
 * (não voltado ao público), isso é uma escolha pragmática comum — mas se
 * quiserem endurecer isso depois, o caminho é criar rotas de API no próprio
 * Next.js (app/api/.../route.ts) que funcionam como proxy autenticado para o
 * backend, aí sim usando um cookie httpOnly de verdade.
 */

const NOME_COOKIE_TOKEN = 'norden_token';

export function definirCookieToken(token: string) {
  // 8h de validade — mesmo tempo de expiração do JWT emitido pelo backend
  const maxAgeSegundos = 60 * 60 * 8;
  document.cookie = `${NOME_COOKIE_TOKEN}=${token}; path=/; max-age=${maxAgeSegundos}; SameSite=Lax`;
}

export function lerCookieToken(): string | null {
  if (typeof document === 'undefined') return null; // executando no servidor

  const encontrado = document.cookie
    .split('; ')
    .find((linha) => linha.startsWith(`${NOME_COOKIE_TOKEN}=`));

  return encontrado ? encontrado.split('=')[1] : null;
}

export function removerCookieToken() {
  document.cookie = `${NOME_COOKIE_TOKEN}=; path=/; max-age=0`;
}

export { NOME_COOKIE_TOKEN };
