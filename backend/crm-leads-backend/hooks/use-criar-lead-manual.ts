import { useMutation, useQueryClient } from '@tanstack/react-query';
import { criarLeadManual, CriarLeadManualInput } from '@/lib/leads-api';

export function useCriarLeadManual() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CriarLeadManualInput) => criarLeadManual(input),
    onSuccess: () => {
      // Afeta tanto o board do Kanban quanto a tabela Meus Leads
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
