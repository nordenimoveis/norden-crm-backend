import Pusher from 'pusher';
import { env } from '@/config/env';

/**
 * Cliente Pusher do lado do servidor. Único ponto do código que fala com a
 * API do Pusher — todos os disparos de evento passam pelas funções abaixo.
 */
export const pusher = new Pusher({
  appId: env.PUSHER_APP_ID,
  key: env.PUSHER_KEY,
  secret: env.PUSHER_SECRET,
  cluster: env.PUSHER_CLUSTER,
  useTLS: true,
});

/** Canal único do board Kanban — todo usuário autenticado escuta este canal. */
export const CANAL_KANBAN = 'private-kanban';

/** Canal específico de um lead — só é assinado quando o chat daquele lead está aberto. */
export function canalDoLead(leadId: string): string {
  return `private-lead-${leadId}`;
}

type LeadResumo = {
  id: string;
  status: string;
  atendimentoHumano: boolean;
  corretorId: string | null;
  temperatura?: string;
};

/**
 * Disparado sempre que um lead muda de coluna, é atribuído/transferido, ou
 * entra em "Aguardando Resposta". O front-end usa isso para atualizar o card
 * certo no board sem precisar buscar a lista inteira de novo.
 */
export async function notificarLeadAtualizado(lead: LeadResumo) {
  await pusher.trigger(CANAL_KANBAN, 'lead_atualizado', { lead });
}

type MensagemResumo = {
  id: string;
  leadId: string;
  direcao: 'enviada' | 'recebida';
  conteudo: string;
  criadoEm: Date;
};

/**
 * Disparado quando uma mensagem nova (enviada ou recebida) é registrada.
 * Vai para o canal específico do lead (chat aberto) E para o canal do board
 * (para atualizar o badge/preview do card, mesmo com o chat fechado).
 */
export async function notificarNovaMensagem(mensagem: MensagemResumo) {
  await Promise.all([
    pusher.trigger(canalDoLead(mensagem.leadId), 'nova_mensagem', { mensagem }),
    pusher.trigger(CANAL_KANBAN, 'mensagem_no_board', {
      leadId: mensagem.leadId,
      preview: mensagem.conteudo.slice(0, 80),
    }),
  ]);
}

/**
 * Disparado quando o status de entrega de uma mensagem muda (enviada →
 * entregue → lida), a partir do webhook de status do WhatsApp Cloud API.
 * Só precisa ir para o canal do lead — é o "tique" no chat, não algo que o
 * board precisa saber.
 */
export async function notificarStatusMensagem(payload: {
  id: string;
  leadId: string;
  status: string;
}) {
  await pusher.trigger(canalDoLead(payload.leadId), 'status_mensagem', payload);
}
