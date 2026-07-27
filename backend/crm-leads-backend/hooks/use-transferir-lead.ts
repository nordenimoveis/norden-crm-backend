import { useMutation, useQueryClient } from '@tanstack/react-query';
import { transferirLead } from '@/lib/leads-api';

export function useTransferirLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ leadId, corretorId }: { leadId: string; corretorId: string }) =>
      transferirLead(leadId, corretorId),
    onSuccess: () => {
      // Transferência muda o "dono" do lead — mais simples e seguro invalidar
      // (não otimista aqui, diferente do drag-and-drop) já que afeta quem
      // pode ver o lead daqui pra frente (RBAC), não só um campo visual.
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
