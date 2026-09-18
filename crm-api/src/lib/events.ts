import { EventEmitter } from 'node:events';

/**
 * Barramento de eventos em memória para o tempo real (SSE).
 * Funciona com uma única instância da API, que é o cenário da Norden.
 * Se um dia houver várias instâncias, trocar por Redis pub/sub.
 */
export interface CrmEvent {
  type:
    | 'lead.created'
    | 'lead.updated'
    | 'lead.assigned'
    | 'message.created'
    | 'ai.suggestion';
  leadId: string;
  brokerId: string | null;
  data?: Record<string, unknown>;
}

class Bus extends EventEmitter {
  publish(evt: CrmEvent) {
    this.emit('event', evt);
  }
}

export const bus = new Bus();
bus.setMaxListeners(200);
