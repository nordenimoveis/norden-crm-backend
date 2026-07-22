import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis';
import { proximoHorarioComercial } from '@/utils/horario-comercial';

export const CAMPANHA_QUEUE_NAME = 'campanha-disparo';

export type CampanhaJobPayload = {
  campanhaDisparoId: string;
  campanhaDisparoLeadId: string;
};

export const campanhaQueue = new Queue<CampanhaJobPayload>(CAMPANHA_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

// Espaçamento entre mensagens de uma mesma campanha — mandar centenas de
// mensagens em rajada nos primeiros segundos parece robótico e é exatamente
// o padrão que a Meta usa pra detectar spam. Um intervalo com jitter simula
// um ritmo mais humano. Isso é ADICIONAL à trava diária (MAX_DAILY_MESSAGES);
// aqui o que importa é o espaçamento *dentro* do teto, não o teto em si.
const INTERVALO_BASE_MS = 4000;
const JITTER_MAX_MS = 3000;

/**
 * Enfileira todos os destinatários de uma campanha, escalonados no tempo
 * (não tudo de uma vez) e já ajustados pro próximo horário comercial válido
 * — mesma regra da cadência automática.
 */
export async function enfileirarDestinatarios(
  campanhaDisparoId: string,
  destinatarioIds: string[]
) {
  const agora = new Date();

  for (let i = 0; i < destinatarioIds.length; i++) {
    const offsetMs = i * (INTERVALO_BASE_MS + Math.floor(Math.random() * JITTER_MAX_MS));
    const alvoBruto = new Date(agora.getTime() + offsetMs);
    const alvoAjustado = proximoHorarioComercial(alvoBruto);
    const delayMs = Math.max(0, alvoAjustado.getTime() - agora.getTime());

    await campanhaQueue.add(
      'disparar-campanha-lead',
      { campanhaDisparoId, campanhaDisparoLeadId: destinatarioIds[i] },
      {
        delay: delayMs,
        jobId: `campanha-${campanhaDisparoId}-lead-${destinatarioIds[i]}`,
      }
    );
  }
}
