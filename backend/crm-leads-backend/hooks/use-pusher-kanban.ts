import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { obterPusherClient } from '@/lib/pusher-client';
import { Lead, ListaLeadsResposta } from '@/lib/types';

type LeadAtualizadoPayload = {
  lead: Pick<Lead, 'id' | 'status' | 'atendimentoHumano' | 'corretorId'> & { temperatura?: string };
};

type MensagemNoBoardPayload = {
  leadId: string;
  preview: string;
  direcao: 'enviada' | 'recebida';
  criadoEm: string;
};

/**
 * Assina o canal compartilhado do board (`private-kanban`) uma vez, pelo
 * tempo de vida do board. Ao receber `lead_atualizado`, faz um patch
 * cirúrgico no card certo em QUALQUER variação de filtro já em cache
 * (`setQueriesData` com chave parcial `['leads']` cobre `['leads', {corretorId: 'x'}]`
 * e `['leads', {corretorId: undefined}]` ao mesmo tempo) — sem refetch da lista inteira.
 *
 * É isso que faz o card virar "Aguardando Resposta" sozinho quando o lead
 * responde no WhatsApp, mesmo com o corretor de olho no board.
 *
 * `mensagem_no_board` já existia no backend, mas nunca tinha um ouvinte no
 * front — é o que acende o indicador de "não lida" em tempo real, sem
 * esperar um refresh da página.
 */
export function usePusherKanban() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const pusher = obterPusherClient();
    const canal = pusher.subscribe('private-kanban');

    canal.bind('lead_atualizado', ({ lead }: LeadAtualizadoPayload) => {
      queryClient.setQueriesData<ListaLeadsResposta>({ queryKey: ['leads'] }, (atual) => {
        if (!atual) return atual;
        return {
          ...atual,
          items: atual.items.map((item) =>
            item.id === lead.id
              ? {
                  ...item,
                  status: lead.status,
                  atendimentoHumano: lead.atendimentoHumano,
                  corretorId: lead.corretorId,
                }
              : item
          ),
        };
      });
    });

    canal.bind('mensagem_no_board', (payload: MensagemNoBoardPayload) => {
      queryClient.setQueriesData<ListaLeadsResposta>({ queryKey: ['leads'] }, (atual) => {
        if (!atual) return atual;
        return {
          ...atual,
          items: atual.items.map((item) =>
            item.id === payload.leadId
              ? {
                  ...item,
                  ultimaMensagemEm: payload.criadoEm,
                  // Só marca como não lida se a mensagem for do LEAD — uma
                  // mensagem que a própria equipe mandou não devia acender
                  // o indicador de "não lida" pra ninguém.
                  naoLida: payload.direcao === 'recebida' ? true : item.naoLida,
                }
              : item
          ),
        };
      });
    });

    return () => {
      pusher.unsubscribe('private-kanban');
    };
  }, [queryClient]);
}
