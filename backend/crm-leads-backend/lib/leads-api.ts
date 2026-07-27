import { apiFetch } from './api-client';
import { Lead, ListaLeadsResposta, LeadStatus, LeadOrigem, LeadTemperatura, Usuario, TipoAgendamento, StatusIA, PerfilBusca, MatchImovel } from './types';

export type FiltrosLeads = {
  corretorId?: string;
};

/**
 * Busca os leads para o board Kanban. Não filtramos por `status` aqui —
 * trazemos tudo de uma vez e agrupamos nas colunas no cliente, já que o
 * board precisa ver todas as colunas simultaneamente.
 *
 * `pageSize: 100` é um ponto de partida razoável para o volume de uma
 * imobiliária boutique. Se o board crescer além disso, o próximo passo é
 * paginação por coluna (scroll infinito) — o backend já suporta `page`/`pageSize`.
 */
export async function buscarLeadsDoBoard(filtros: FiltrosLeads = {}): Promise<ListaLeadsResposta> {
  const params = new URLSearchParams({ pageSize: '100' });
  if (filtros.corretorId) params.set('corretorId', filtros.corretorId);

  return apiFetch<ListaLeadsResposta>(`/api/leads?${params.toString()}`);
}

export async function atualizarStatusLead(id: string, status: LeadStatus): Promise<Lead> {
  return apiFetch<Lead>(`/api/leads/${id}/status`, {
    method: 'PATCH',
    body: { status },
  });
}

export async function atualizarTemperaturaLead(id: string, temperatura: LeadTemperatura): Promise<Lead> {
  return apiFetch<Lead>(`/api/leads/${id}/temperatura`, {
    method: 'PATCH',
    body: { temperatura },
  });
}

export async function atualizarStatusIALead(id: string, statusIA: StatusIA): Promise<Lead> {
  return apiFetch<Lead>(`/api/leads/${id}/status-ia`, {
    method: 'PATCH',
    body: { statusIA },
  });
}

export async function listarUsuarios(): Promise<Usuario[]> {
  return apiFetch<Usuario[]>('/api/usuarios');
}

// --- Tela "Meus Leads" (tabela paginada com busca e filtros) ---

export type FiltrosTabelaLeads = {
  busca?: string;
  status?: LeadStatus;
  origem?: LeadOrigem;
  temperatura?: LeadTemperatura;
  corretorId?: string;
  page?: number;
  pageSize?: number;
};

export async function buscarLeadsTabela(filtros: FiltrosTabelaLeads): Promise<ListaLeadsResposta> {
  const params = new URLSearchParams({
    page: String(filtros.page ?? 1),
    pageSize: String(filtros.pageSize ?? 15),
  });

  if (filtros.busca) params.set('busca', filtros.busca);
  if (filtros.status) params.set('status', filtros.status);
  if (filtros.origem) params.set('origem', filtros.origem);
  if (filtros.temperatura) params.set('temperatura', filtros.temperatura);
  if (filtros.corretorId) params.set('corretorId', filtros.corretorId);

  return apiFetch<ListaLeadsResposta>(`/api/leads?${params.toString()}`);
}

export async function transferirLead(leadId: string, corretorId: string): Promise<Lead> {
  return apiFetch<Lead>(`/api/leads/${leadId}/atribuir`, {
    method: 'PATCH',
    body: { corretorId },
  });
}

export type AtualizarLeadInput = {
  nome?: string;
  telefone?: string;
  email?: string;
  dataAgendamento?: string | null;
  tipoAgendamento?: TipoAgendamento | null;
  perfilBusca?: PerfilBusca | null;
  perfilSemantico?: string | null;
};

export async function buscarMatchImoveis(leadId: string): Promise<MatchImovel[]> {
  return apiFetch<MatchImovel[]>(`/api/leads/${leadId}/match-imoveis`);
}

export async function atualizarLead(leadId: string, input: AtualizarLeadInput): Promise<Lead> {
  return apiFetch<Lead>(`/api/leads/${leadId}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function buscarAgendamentos(): Promise<Lead[]> {
  return apiFetch<Lead[]>('/api/leads/agendamentos');
}

export type CriarLeadManualInput = {
  nome: string;
  telefone: string;
  email?: string;
  corretorId?: string;
};

export async function criarLeadManual(input: CriarLeadManualInput): Promise<Lead> {
  return apiFetch<Lead>('/api/leads/manual', {
    method: 'POST',
    body: input,
  });
}
