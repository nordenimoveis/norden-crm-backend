import { useMutation, useQueryClient } from '@tanstack/react-query';
import { atualizarStatusLead, atualizarTemperaturaLead, atualizarStatusIALead } from '@/lib/leads-api';
import { Lead, LeadDetalhado, LeadStatus, LeadTemperatura, StatusIA, ListaLeadsResposta } from '@/lib/types';

/**
 * Diferente do `useAtualizarStatusLead` (que só mexe no cache do board com
 * um filtro específico, pra fazer o drag-and-drop parecer instantâneo),
 * este hook é o genérico: patcheia QUALQUER lugar onde esse lead esteja em
 * cache — o board do Kanban, a lista de conversas de Mensagens, e o
 * detalhe do próprio lead — tudo na mesma chamada, sem precisar saber de
 * antemão qual tela está aberta.
 *
 * Isso é o que faz uma mudança feita no painel direito do Chat aparecer
 * na hora no card do Kanban, sem F5 — sem precisar de um Context novo,
 * porque o React Query já É o estado compartilhado entre as telas.
 */
function patchearLeadEmTodosOsCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  leadId: string,
  mudancas: Partial<Pick<Lead, 'status' | 'temperatura' | 'statusIA'>>
) {
  // Qualquer variação de ['leads', ...] — board com filtro de corretor,
  // lista de Mensagens, tabela de Meus Leads — tudo isso é coberto de uma
  // vez por causa do match parcial de chave do React Query.
  queryClient.setQueriesData<ListaLeadsResposta>({ queryKey: ['leads'] }, (atual) => {
    if (!atual) return atual;
    return {
      ...atual,
      items: atual.items.map((item) => (item.id === leadId ? { ...item, ...mudancas } : item)),
    };
  });

  // O detalhe do lead (usado pelo ChatCentral/PerfilLeadPanel) fica numa
  // chave separada (['lead', id], singular) — precisa de um patch à parte.
  queryClient.setQueryData<LeadDetalhado>(['lead', leadId], (atual) =>
    atual ? { ...atual, ...mudancas } : atual
  );
}

export function useAtualizarStatusGenerico() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId, status }: { leadId: string; status: LeadStatus }) =>
      atualizarStatusLead(leadId, status),
    onSuccess: (_data, { leadId, status }) => {
      patchearLeadEmTodosOsCaches(queryClient, leadId, { status });
    },
  });
}

export function useAtualizarTemperaturaGenerico() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId, temperatura }: { leadId: string; temperatura: LeadTemperatura }) =>
      atualizarTemperaturaLead(leadId, temperatura),
    onSuccess: (_data, { leadId, temperatura }) => {
      patchearLeadEmTodosOsCaches(queryClient, leadId, { temperatura });
    },
  });
}

export function useAtualizarStatusIAGenerico() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId, statusIA }: { leadId: string; statusIA: StatusIA }) =>
      atualizarStatusIALead(leadId, statusIA),
    onSuccess: (_data, { leadId, statusIA }) => {
      patchearLeadEmTodosOsCaches(queryClient, leadId, { statusIA });
    },
  });
}
