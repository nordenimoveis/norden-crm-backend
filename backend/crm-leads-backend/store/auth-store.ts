import { create } from 'zustand';

export type UsuarioAutenticado = {
  id: string;
  nome: string;
  email: string;
  papel: 'gestor' | 'corretor' | 'admin';
};

type AuthState = {
  usuario: UsuarioAutenticado | null;
  hidratado: boolean; // já tentamos carregar a sessão a partir do cookie?
  definirSessao: (usuario: UsuarioAutenticado) => void;
  limparSessao: () => void;
  marcarHidratado: () => void;
};

/**
 * Guarda só os DADOS do usuário (nome, papel, etc.) — o token em si vive no
 * cookie (lib/auth-cookie.ts), não aqui. Isso evita duplicar a fonte da
 * verdade: o cookie é o que o middleware e o apiFetch usam; este store é só
 * para o Layout Base (Sidebar/Topbar) saber quem está logado e renderizar
 * nome/iniciais/papel sem precisar reconsultar a API toda hora.
 */
export const useAuthStore = create<AuthState>((set) => ({
  usuario: null,
  hidratado: false,
  definirSessao: (usuario) => set({ usuario }),
  limparSessao: () => set({ usuario: null }),
  marcarHidratado: () => set({ hidratado: true }),
}));
