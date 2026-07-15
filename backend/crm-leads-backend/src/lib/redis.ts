import IORedis from 'ioredis';
import { env } from '@/config/env';

// maxRetriesPerRequest null é exigido pelo BullMQ para conexões usadas em filas/workers
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
