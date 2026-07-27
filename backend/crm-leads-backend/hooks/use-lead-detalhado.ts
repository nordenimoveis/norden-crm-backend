import { useQuery } from '@tanstack/react-query';
import { buscarLeadDetalhado } from '@/lib/chat-api';

export function useLeadDetalhado(leadId: string | null) {
  return useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => buscarLeadDetalhado(leadId!),
    enabled: !!leadId,
  });
}
