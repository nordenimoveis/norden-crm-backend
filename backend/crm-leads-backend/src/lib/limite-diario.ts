import { redisConnection } from './redis';
import { env } from '@/config/env';
import { formatarDataBrasil } from '@/utils/horario-comercial';

/**
 * Trava Anti-Ban (Regra de Limite de Disparos):
 *
 * Implementa um "balde de tokens" diário: cada dia tem uma chave própria no Redis
 * (`whatsapp:envios:YYYY-MM-DD`) com um contador que começa em 0 e vai até
 * MAX_DAILY_MESSAGES. Cada tentativa de envio automatizado (Passo 1 a 4 da
 * cadência) precisa "reservar" um slot antes de efetivamente enviar.
 *
 * Por que um script Lua e não um simples GET + INCR em duas chamadas separadas:
 * o worker roda com concurrency: 5 (5 mensagens sendo processadas ao mesmo tempo).
 * Se checássemos "contador < limite" e só depois incrementássemos, duas
 * execuções concorrentes poderiam ler o mesmo valor e ambas passarem, furando
 * o teto por alguns envios. O Lua roda atomicamente dentro do Redis — não há
 * como dois workers "verem" o mesmo estado intermediário.
 */

const SCRIPT_RESERVAR_ENVIO = `
local atual = redis.call('INCR', KEYS[1])
if tonumber(atual) == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if tonumber(atual) > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

// TTL generoso (30h) só para garantir que a chave não fique presa no Redis
// para sempre — o "dia" real é controlado pela própria chave (YYYY-MM-DD),
// não pelo TTL.
const TTL_SEGUNDOS = 60 * 60 * 30;

// Chave onde o Admin pode sobrescrever o teto em tempo real, pela tela de
// Configurações (Fase 10) — sem precisar de redeploy para "abrir a torneira".
// Sem override configurado, cai no valor da env var (comportamento original).
const CHAVE_LIMITE_CONFIGURADO = 'config:max_daily_messages';

function chaveDoDia(data: Date): string {
  return `whatsapp:envios:${formatarDataBrasil(data)}`;
}

/** Lê o teto diário atual: override no Redis (se existir) ou a env var. */
export async function obterLimiteDiario(): Promise<number> {
  const valorConfigurado = await redisConnection.get(CHAVE_LIMITE_CONFIGURADO);
  return valorConfigurado ? parseInt(valorConfigurado, 10) : env.MAX_DAILY_MESSAGES;
}

/** Define um novo teto diário em tempo real (usado pela tela de Configurações). */
export async function definirLimiteDiario(novoLimite: number): Promise<void> {
  await redisConnection.set(CHAVE_LIMITE_CONFIGURADO, String(novoLimite));
}

/**
 * Tenta reservar um slot de envio para hoje. Retorna `true` se o envio pode
 * prosseguir (e já reserva o slot, incrementando o contador), ou `false` se o
 * teto diário já foi atingido.
 */
export async function reservarSlotDeEnvio(dataReferencia: Date = new Date()): Promise<boolean> {
  const chave = chaveDoDia(dataReferencia);
  const limiteAtual = await obterLimiteDiario();

  const resultado = await redisConnection.eval(
    SCRIPT_RESERVAR_ENVIO,
    1,
    chave,
    TTL_SEGUNDOS,
    limiteAtual
  );

  return resultado === 1;
}

/** Útil para expor no painel/dashboard: quantos envios já foram feitos hoje. */
export async function contarEnviosDeHoje(dataReferencia: Date = new Date()): Promise<number> {
  const valor = await redisConnection.get(chaveDoDia(dataReferencia));
  return valor ? parseInt(valor, 10) : 0;
}
