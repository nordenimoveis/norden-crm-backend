import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listarDocumentos,
  uploadDocumentoPdf,
  ingerirDocumentoUrl,
  deletarDocumento,
} from '@/lib/ia-api';

export function useDocumentos() {
  return useQuery({
    queryKey: ['documentos-ia'],
    queryFn: listarDocumentos,
  });
}

export function useUploadDocumentoPdf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ arquivo, titulo }: { arquivo: File; titulo: string }) =>
      uploadDocumentoPdf(arquivo, titulo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documentos-ia'] }),
  });
}

export function useIngerirDocumentoUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ titulo, url }: { titulo: string; url: string }) => ingerirDocumentoUrl(titulo, url),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documentos-ia'] }),
  });
}

export function useDeletarDocumento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletarDocumento(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documentos-ia'] }),
  });
}
