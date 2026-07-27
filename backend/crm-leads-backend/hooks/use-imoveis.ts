import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listarImoveis,
  criarImovel,
  atualizarImovel,
  deletarImovel,
  extrairImovelDePdf,
  extrairImovelDeUrl,
  ImovelInput,
} from '@/lib/imoveis-api';

export function useImoveis(incluirInativos = false) {
  return useQuery({
    queryKey: ['imoveis', incluirInativos],
    queryFn: () => listarImoveis(incluirInativos),
  });
}

export function useCriarImovel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImovelInput) => criarImovel(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['imoveis'] }),
  });
}

export function useAtualizarImovel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ImovelInput> }) =>
      atualizarImovel(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['imoveis'] }),
  });
}

export function useDeletarImovel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletarImovel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['imoveis'] }),
  });
}

export function useExtrairImovelDePdf() {
  return useMutation({ mutationFn: (arquivo: File) => extrairImovelDePdf(arquivo) });
}

export function useExtrairImovelDeUrl() {
  return useMutation({ mutationFn: (url: string) => extrairImovelDeUrl(url) });
}
