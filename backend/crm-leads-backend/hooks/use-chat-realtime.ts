import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { obterPusherClient } from '@/lib/pusher-client';
import { LeadDetalhado, Mensagem } from '@/lib/types';

/**
 * Assina `private-lead-{leadId}` só enquanto o chat desse lead está aberto —
 * desmonta a assinatura ao trocar de lead ou fechar o painel, evitando
 * acumular canais abertos à toa.
 */
export function useChatRealtime(leadId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!leadId) return;

    const pusher = obterPusherClient();
    const canal = pusher.subscribe(`private-lead-${leadId}`);
    const queryKey = ['lead', leadId];

    canal.bind('nova_mensagem', ({ mensagem }: { mensagem: Mensagem }) => {
      queryClient.setQueryData<LeadDetalhado>(queryKey, (atual) => {
        if (!atual) return atual;
        // Evita duplicar: se o balão já existe (ex: veio do próprio envio
        // otimista + resposta HTTP), não adiciona de novo.
        const jaExiste = atual.mensagens.some((m) => m.id === mensagem.id);
        if (jaExiste) return atual;
        return { ...atual, mensagens: [...atual.mensagens, mensagem] };
      });

      // Regra da Fase 4 (Transbordo Automático): se a mensagem que chegou é
      // do LEAD (recebida), o backend já pausou a cadência e mudou o status
      // — recarrega o lead pra pegar `status`/`atendimentoHumano` atualizados
      // no cabeçalho do chat (mais simples e correto do que tentar adivinhar
      // esses campos manualmente aqui).
      if (mensagem.direcao === 'recebida') {
        queryClient.invalidateQueries({ queryKey });
      }
    });

    canal.bind('status_mensagem', ({ id, status }: { id: string; status: Mensagem['status'] }) => {
      queryClient.setQueryData<LeadDetalhado>(queryKey, (atual) => {
        if (!atual) return atual;
        return {
          ...atual,
          mensagens: atual.mensagens.map((m) => (m.id === id ? { ...m, status } : m)),
        };
      });
    });

    return () => {
      pusher.unsubscribe(`private-lead-${leadId}`);
    };
  }, [leadId, queryClient]);
}
