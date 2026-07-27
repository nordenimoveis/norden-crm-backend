import { useQuery } from '@tanstack/react-query';
import { buscarAgendamentos } from '@/lib/leads-api';

export function useVisitasAgendadas() {
  return useQuery({
    queryKey: ['leads', 'agendamentos'],
    queryFn: buscarAgendamentos,
  });
}
