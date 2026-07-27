import { NextRequest, NextResponse } from 'next/server';

const NOME_COOKIE_TOKEN = 'norden_token';

/**
 * Middleware roda no servidor (edge), então só consegue verificar SE existe
 * um token no cookie — não valida a assinatura/expiração do JWT (isso exigiria
 * o mesmo JWT_SECRET do backend aqui, o que não faz sentido duplicar).
 *
 * A validação "de verdade" acontece no backend: se o token estiver expirado
 * ou inválido, qualquer chamada autenticada (ex: GET /api/usuarios/me no
 * AuthProvider) recebe 401, e o apiFetch já cuida de limpar a sessão e
 * redirecionar para /login nesse caso. O middleware é a primeira barreira
 * (evita renderizar a tela protegida sem token nenhum); o apiFetch é a
 * segunda (cobre o token que existe mas não é mais válido).
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get(NOME_COOKIE_TOKEN)?.value;
  const { pathname } = request.nextUrl;

  const ehRotaDeLogin = pathname.startsWith('/login');

  if (!token && !ehRotaDeLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirecionarPara', pathname);
    return NextResponse.redirect(url);
  }

  if (token && ehRotaDeLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/kanban';
    url.searchParams.delete('redirecionarPara');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Roda em tudo, exceto assets estáticos e arquivos internos do Next.js
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
