import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listarCampanhas,
  buscarCampanha,
  previewPublico,
  criarCampanha,
  marcarCampanhaComoPronta,
  iniciarEnvioCampanha,
  deletarCampanha,
  CriarCampanhaInput,
} from '@/lib/campanhas-api';
import { FiltroPublico } from '@/lib/types';

export function useCampanhas() {
  return useQuery({
    queryKey: ['campanhas-disparo'],
    queryFn: listarCampanhas,
    // Enquanto alguma campanha estiver "enviando", atualiza sozinho a cada 5s
    // pra refletir o progresso sem o usuário precisar recarregar a página.
    refetchInterval: (query) => {
      const dados = query.state.data;
      return dados?.some((c) => c.status === 'enviando') ? 5000 : false;
    },
  });
}

export function useCampanhaDetalhe(id: string | null) {
  return useQuery({
    queryKey: ['campanhas-disparo', id],
    queryFn: () => buscarCampanha(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === 'enviando' ? 3000 : false),
  });
}

/** Contagem ao vivo do público — alimenta o "X destinatários" no editor, enquanto o usuário ajusta os filtros. */
export function usePreviewPublico(filtro: FiltroPublico, habilitado: boolean) {
  return useQuery({
    queryKey: ['campanhas-disparo', 'preview-publico', filtro],
    queryFn: () => previewPublico(filtro),
    enabled: habilitado,
  });
}

export function useCriarCampanha() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CriarCampanhaInput) => criarCampanha(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campanhas-disparo'] }),
  });
}

export function useMarcarCampanhaComoPronta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => marcarCampanhaComoPronta(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campanhas-disparo'] }),
  });
}

export function useIniciarEnvioCampanha() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => iniciarEnvioCampanha(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campanhas-disparo'] }),
  });
}

export function useDeletarCampanha() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletarCampanha(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campanhas-disparo'] }),
  });
}
