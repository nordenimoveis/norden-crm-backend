import { useQuery } from '@tanstack/react-query';
import { buscarLeadsDoBoard, FiltrosLeads } from '@/lib/leads-api';

export function useLeadsDoBoard(filtros: FiltrosLeads) {
  return useQuery({
    queryKey: ['leads', 'board', filtros],
    queryFn: () => buscarLeadsDoBoard(filtros),
  });
}
