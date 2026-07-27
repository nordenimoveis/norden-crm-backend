import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarNotas, criarNota } from '@/lib/notas-api';

export function useNotasInternas(leadId: string) {
  return useQuery({
    queryKey: ['notas-internas', leadId],
    queryFn: () => listarNotas(leadId),
  });
}

export function useCriarNota(leadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (texto: string) => criarNota(leadId, texto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notas-internas', leadId] });
    },
  });
}
