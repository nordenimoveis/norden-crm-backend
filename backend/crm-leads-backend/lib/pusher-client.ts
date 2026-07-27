import PusherClient from 'pusher-js';
import { lerCookieToken } from './auth-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

let instancia: PusherClient | null = null;

/**
 * Singleton do cliente Pusher. Usamos um `authorizer` customizado (em vez de
 * `auth.headers` estático) para ler o token do cookie NO MOMENTO da
 * assinatura do canal, não na criação do client — importante porque o
 * client é criado uma vez só, mas o usuário pode logar/deslogar depois.
 */
export function obterPusherClient(): PusherClient {
  if (instancia) return instancia;

  instancia = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    authorizer: (channel) => ({
      authorize: async (socketId, callback) => {
        try {
          const token = lerCookieToken();
          const response = await fetch(`${API_URL}/api/pusher/auth`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ socket_id: socketId, channel_name: channel.name }),
          });

          if (!response.ok) {
            callback(new Error(`Falha ao autorizar canal ${channel.name}`), null);
            return;
          }

          const data = await response.json();
          callback(null, data);
        } catch (err) {
          callback(err as Error, null);
        }
      },
    }),
  });

  return instancia;
}
