'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api-client';
import { definirCookieToken } from '@/lib/auth-cookie';
import { useAuthStore } from '@/store/auth-store';

type RespostaLogin = {
  token: string;
  usuario: {
    id: string;
    nome: string;
    email: string;
    papel: 'gestor' | 'corretor' | 'admin';
  };
};

function FormularioLogin() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const definirSessao = useAuthStore((state) => state.definirSessao);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);

    try {
      const resposta = await apiFetch<RespostaLogin>('/api/auth/login', {
        method: 'POST',
        body: { email, senha },
        semAuth: true,
      });

      definirCookieToken(resposta.token);
      definirSessao(resposta.usuario);

      const destino = searchParams.get('redirecionarPara') || '/kanban';
      router.replace(destino);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErro('E-mail ou senha inválidos.');
      } else {
        setErro('Não foi possível entrar agora. Tente novamente em instantes.');
      }
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="mb-10 text-center">
          <span className="font-display text-3xl font-medium tracking-tight text-sidebar-foreground">
            Norden<span className="text-accent">.</span>
          </span>
          <p className="mt-2 text-sm text-sidebar-muted">Painel de atendimento e leads</p>
        </div>

        <form
          onSubmit={aoEnviar}
          className="rounded-lg border border-sidebar-border bg-card p-8 shadow-xl shadow-black/20"
        >
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.nome@norden.com.br"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {erro && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {erro}
              </p>
            )}

            <Button type="submit" variant="accent" className="w-full" disabled={carregando}>
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-sidebar-muted">
          Acesso restrito à equipe Norden Imóveis.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <FormularioLogin />
    </Suspense>
  );
}
