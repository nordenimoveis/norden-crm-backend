import { useQuery } from '@tanstack/react-query';
import { listarUsuarios } from '@/lib/leads-api';

/**
 * Só é chamado quando `habilitado` é true (papel gestor/admin) — um corretor
 * não precisa buscar a lista de usuários, já que nem vê o filtro.
 */
export function useCorretores(habilitado: boolean) {
  return useQuery({
    queryKey: ['usuarios', 'corretores'],
    queryFn: async () => {
      const usuarios = await listarUsuarios();
      return usuarios.filter((u) => u.papel === 'corretor' && u.ativo);
    },
    enabled: habilitado,
  });
}
