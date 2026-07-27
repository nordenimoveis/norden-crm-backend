import { useQuery } from '@tanstack/react-query';
import { buscarQuickReplies } from '@/lib/chat-api';

export function useQuickReplies(busca: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['quick-replies', busca],
    queryFn: () => buscarQuickReplies(busca || undefined),
    enabled: habilitado,
    staleTime: 60_000, // lista curta e pouco volátil — não precisa refetch agressivo
  });
}
