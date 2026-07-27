import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listarTodosUsuarios,
  criarUsuario,
  atualizarUsuario,
  CriarUsuarioInput,
  AtualizarUsuarioInput,
} from '@/lib/sistema-api';

export function useTodosUsuarios() {
  return useQuery({
    queryKey: ['usuarios', 'todos'],
    queryFn: listarTodosUsuarios,
  });
}

export function useCriarUsuario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CriarUsuarioInput) => criarUsuario(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
    },
  });
}

export function useAtualizarUsuario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AtualizarUsuarioInput }) =>
      atualizarUsuario(id, input),
    onSuccess: () => {
      // Invalida ampla ('usuarios') — cobre a lista de todos, o filtro de
      // corretores do Kanban e o dropdown de transferência da tabela de leads.
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
    },
  });
}
