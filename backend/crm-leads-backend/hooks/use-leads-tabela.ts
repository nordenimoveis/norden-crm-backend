import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { buscarLeadsTabela, FiltrosTabelaLeads } from '@/lib/leads-api';

export function useLeadsTabela(filtros: FiltrosTabelaLeads) {
  return useQuery({
    queryKey: ['leads', 'tabela', filtros],
    queryFn: () => buscarLeadsTabela(filtros),
    placeholderData: keepPreviousData, // evita "piscar" a tabela ao trocar de página/filtro
  });
}
