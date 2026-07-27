import { useQuery } from '@tanstack/react-query';
import { buscarMatchImoveis } from '@/lib/leads-api';

export function useMatchImoveis(leadId: string) {
  return useQuery({
    queryKey: ['match-imoveis', leadId],
    queryFn: () => buscarMatchImoveis(leadId),
    // Erro de "perfil incompleto" é esperado (nem todo lead tem o perfil
    // preenchido ainda) — não faz sentido ficar tentando de novo sozinho.
    retry: false,
  });
}
