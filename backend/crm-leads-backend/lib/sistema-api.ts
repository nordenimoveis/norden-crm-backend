import { apiFetch } from './api-client';
import { Usuario } from './types';

// --- Gestão de Equipe (Fase 10 — restrito a admin) ---

export type CriarUsuarioInput = {
  nome: string;
  email: string;
  senha: string;
  papel: 'gestor' | 'corretor' | 'admin';
};

export type AtualizarUsuarioInput = {
  nome?: string;
  papel?: 'gestor' | 'corretor' | 'admin';
  ativo?: boolean;
};

export async function listarTodosUsuarios(): Promise<Usuario[]> {
  return apiFetch<Usuario[]>('/api/usuarios');
}

export async function criarUsuario(input: CriarUsuarioInput): Promise<Usuario> {
  return apiFetch<Usuario>('/api/usuarios', { method: 'POST', body: input });
}

export async function atualizarUsuario(id: string, input: AtualizarUsuarioInput): Promise<Usuario> {
  return apiFetch<Usuario>(`/api/usuarios/${id}`, { method: 'PATCH', body: input });
}

// --- Motor e Segurança do WhatsApp (Fase 10 — restrito a admin) ---

export type LimiteDiarioResposta = {
  limite: number;
  enviadosHoje: number;
};

export async function buscarLimiteDiario(): Promise<LimiteDiarioResposta> {
  return apiFetch<LimiteDiarioResposta>('/api/sistema/limite-diario');
}

export async function atualizarLimiteDiario(limite: number): Promise<{ limite: number }> {
  return apiFetch<{ limite: number }>('/api/sistema/limite-diario', {
    method: 'PATCH',
    body: { limite },
  });
}

export type StatusIntegracoes = {
  whatsapp: { configurado: boolean };
  metaAds: { configurado: boolean };
  imobzi: { configurado: boolean };
  pusher: { configurado: boolean };
};

export async function buscarStatusIntegracoes(): Promise<StatusIntegracoes> {
  return apiFetch<StatusIntegracoes>('/api/sistema/status-integracoes');
}
