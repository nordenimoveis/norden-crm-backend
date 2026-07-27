import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  criarQuickReply,
  atualizarQuickReply,
  deletarQuickReply,
  CriarQuickReplyInput,
  AtualizarQuickReplyInput,
} from '@/lib/scripts-api';

/**
 * As três mutações invalidam `['quick-replies']` de forma ampla (cobre todas
 * as variações de busca em cache) — a lista é curta o bastante para um
 * refetch completo ser imperceptível, não precisa de optimistic update aqui.
 */
export function useCriarQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CriarQuickReplyInput) => criarQuickReply(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quick-replies'] }),
  });
}

export function useAtualizarQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AtualizarQuickReplyInput }) =>
      atualizarQuickReply(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quick-replies'] }),
  });
}

export function useDeletarQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletarQuickReply(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quick-replies'] }),
  });
}
