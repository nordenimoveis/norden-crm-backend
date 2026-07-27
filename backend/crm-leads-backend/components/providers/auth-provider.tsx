'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch, registrarCallbackDeslogar } from '@/lib/api-client';
import { lerCookieToken, removerCookieToken } from '@/lib/auth-cookie';

/**
 * Ao montar a aplicação:
 * 1. Se existe um cookie de token, busca os dados do usuário logado
 *    (GET /api/usuarios/me) para hidratar o store — é o que faz a Sidebar/
 *    Topbar saberem nome, iniciais e papel sem precisar guardar isso no
 *    cookie (o cookie só tem o JWT).
 * 2. Registra o callback de logout automático no cliente HTTP — quando
 *    qualquer chamada apiFetch tomar 401, este provider limpa a sessão e
 *    redireciona para /login.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { hidratado, definirSessao, limparSessao, marcarHidratado } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    registrarCallbackDeslogar(() => {
      limparSessao();
      router.replace('/login');
    });
  }, [limparSessao, router]);

  useEffect(() => {
    if (hidratado) return;

    const token = lerCookieToken();
    if (!token) {
      marcarHidratado();
      return;
    }

    apiFetch<{ id: string; nome: string; email: string; papel: 'gestor' | 'corretor' | 'admin' }>(
      '/api/usuarios/me'
    )
      .then((usuarioLogado) => {
        definirSessao(usuarioLogado);
      })
      .catch(() => {
        // Token inválido/expirado — apiFetch já limpa o cookie no 401
        removerCookieToken();
      })
      .finally(() => {
        marcarHidratado();
      });
  }, [hidratado, definirSessao, marcarHidratado]);

  // Evita um "flash" da UI sem dados de usuário enquanto a sessão carrega
  if (!hidratado) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
      </div>
    );
  }

  return <>{children}</>;
}
