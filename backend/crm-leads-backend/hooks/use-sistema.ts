import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarLimiteDiario, atualizarLimiteDiario, buscarStatusIntegracoes } from '@/lib/sistema-api';

export function useLimiteDiario() {
  return useQuery({
    queryKey: ['sistema', 'limite-diario'],
    queryFn: buscarLimiteDiario,
  });
}

export function useAtualizarLimiteDiario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limite: number) => atualizarLimiteDiario(limite),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sistema', 'limite-diario'] }),
  });
}

export function useStatusIntegracoes() {
  return useQuery({
    queryKey: ['sistema', 'status-integracoes'],
    queryFn: buscarStatusIntegracoes,
    staleTime: 60_000, // status muda raramente — não precisa refetch agressivo
  });
}
