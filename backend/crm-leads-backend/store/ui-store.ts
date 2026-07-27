import { create } from 'zustand';

type MensagemSugerida = {
  leadId: string;
  texto: string;
};

type UiState = {
  sidebarRecolhida: boolean;
  alternarSidebar: () => void;
  // Ponte simples entre o board (que detecta "negócio fechado") e o
  // ChatPanel (que precisa pré-preencher o texto) — efêmero, consumido uma
  // vez e limpo, não é dado de servidor.
  mensagemSugerida: MensagemSugerida | null;
  definirMensagemSugerida: (msg: MensagemSugerida | null) => void;
};

/**
 * Estado global simples do "Shell" da aplicação. Fica em Zustand em vez de
 * React Query porque não é dado de servidor — é preferência de UI, efêmera,
 * sem necessidade de cache/revalidação.
 */
export const useUiStore = create<UiState>((set) => ({
  sidebarRecolhida: false,
  alternarSidebar: () => set((state) => ({ sidebarRecolhida: !state.sidebarRecolhida })),
  mensagemSugerida: null,
  definirMensagemSugerida: (msg) => set({ mensagemSugerida: msg }),
}));
