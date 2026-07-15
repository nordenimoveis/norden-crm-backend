import { PrismaClient } from '@prisma/client';
import { redisConnection } from '@/lib/redis';

const CHAVE_INDICE_ROLETA = 'roleta:indice';

/**
 * Round-Robin (Roleta) de distribuição de leads.
 *
 * Por que um contador no Redis e não simplesmente "pegar o último corretor
 * usado no banco e ir pro próximo": leads podem chegar de duas fontes ao
 * mesmo tempo (webhook do Meta Ads e formulário do site). Se dois leads
 * chegarem no mesmo milissegundo, ler e escrever o "último corretor" no
 * Postgres sem uma trava explícita corre risco de os dois lerem o mesmo
 * valor e caírem no mesmo corretor. O INCR do Redis é atômico por natureza —
 * cada chamada concorrente recebe um número sequencial garantidamente único,
 * sem precisar de lock nem transação explícita.
 */
export class RoundRobinService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Retorna o ID do próximo corretor da fila, ou `null` se não houver
   * nenhum corretor ativo (nesse caso, o lead fica sem atribuição — melhor
   * isso do que travar a criação do lead).
   */
  async proximoCorretor(): Promise<string | null> {
    const corretoresAtivos = await this.prisma.usuario.findMany({
      where: { papel: 'corretor', ativo: true },
      orderBy: { ordemRoleta: 'asc' },
      select: { id: true, nome: true },
    });

    if (corretoresAtivos.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[round-robin] Nenhum corretor ativo — lead será criado sem atribuição');
      return null;
    }

    // INCR é atômico no Redis: mesmo com múltiplas chamadas simultâneas,
    // cada uma recebe um valor sequencial distinto (1, 2, 3, 4...).
    const indiceSequencial = await redisConnection.incr(CHAVE_INDICE_ROLETA);
    const posicao = (indiceSequencial - 1) % corretoresAtivos.length;

    return corretoresAtivos[posicao].id;
  }
}
