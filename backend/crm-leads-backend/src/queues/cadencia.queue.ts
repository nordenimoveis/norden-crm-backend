import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis';
import { proximoHorarioComercial } from '@/utils/horario-comercial';

export const CADENCIA_QUEUE_NAME = 'cadencia-disparo';

export type CadenciaJobPayload = {
  execucaoId: string;
  leadId: string;
};

export const cadenciaQueue = new Queue<CadenciaJobPayload>(CADENCIA_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

/**
 * Calcula o delay em ms para um passo da cadência.
 * Passo 1 (recepção imediata) usa um jitter aleatório de 1-3 minutos — a ideia é
 * simular que "um corretor pegou o celular e digitou", não um robô disparando
 * instantaneamente. Os demais passos usam o atrasoMinutos configurado.
 */
export function calcularDelayBaseMs(ordem: number, atrasoMinutos: number): number {
  if (ordem === 1) {
    const umMinuto = 60_000;
    const tresMinutos = 3 * 60_000;
    return umMinuto + Math.floor(Math.random() * (tresMinutos - umMinuto));
  }
  return atrasoMinutos * 60_000;
}

/**
 * Agenda o disparo de um passo, já ajustando para a próxima janela de horário
 * comercial válida (Regras Globais 1 e 2). Retorna o ID do job criado, que deve
 * ser salvo em `lead_cadencia_execucao.proximoJobId` — é o que permite destruir
 * o job depois, caso o lead responda antes do disparo (Regra 3).
 */
export async function agendarPasso(
  payload: CadenciaJobPayload,
  ordem: number,
  atrasoMinutos: number
) {
  const agora = new Date();
  const alvoBruto = new Date(agora.getTime() + calcularDelayBaseMs(ordem, atrasoMinutos));
  const alvoAjustado = proximoHorarioComercial(alvoBruto);

  const delayMs = Math.max(0, alvoAjustado.getTime() - agora.getTime());

  const job = await cadenciaQueue.add('disparar-passo', payload, {
    delay: delayMs,
    // Prioridade da fila: menor número = maior prioridade no BullMQ.
    // Usar a própria ordem do passo já resolve a Regra 3 (Passo 1 tem
    // prioridade sobre Passo 2/3/4) tanto no dia a dia quanto no backlog.
    priority: ordem,
    jobId: `execucao-${payload.execucaoId}-passo-${ordem}-${Date.now()}`,
  });

  return { jobId: job.id!, agendadoPara: alvoAjustado };
}

/**
 * Agenda um job para uma data específica já calculada (sem passar pelo ajuste
 * de horário comercial de novo — quem chama já deve ter calculado a data certa).
 * Usado pelo backlog do limite diário: quando o teto de hoje é atingido, o passo
 * é reagendado para a próxima janela comercial (amanhã 09h), mantendo a mesma
 * prioridade por ordem de passo.
 */
export async function agendarParaData(
  payload: CadenciaJobPayload,
  ordem: number,
  dataAlvo: Date
) {
  const agora = new Date();
  const delayMs = Math.max(0, dataAlvo.getTime() - agora.getTime());

  const job = await cadenciaQueue.add('disparar-passo', payload, {
    delay: delayMs,
    priority: ordem,
    jobId: `execucao-${payload.execucaoId}-backlog-${ordem}-${Date.now()}`,
  });

  return { jobId: job.id!, agendadoPara: dataAlvo };
}

/**
 * Gatilho de Interrupção Absoluta (Regra 3): remove o job agendado no Redis
 * assim que o lead responde, impedindo que a automação dispare depois disso.
 * Não gera erro se o job já tiver sido processado ou não existir mais.
 */
export async function cancelarJobAgendado(jobId: string | null | undefined) {
  if (!jobId) return;

  const job = await cadenciaQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}
