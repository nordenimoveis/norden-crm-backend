import { PrismaClient } from '@prisma/client';

export const PONTOS_EVENTO = {
  mensagem_recebida: 5,
  clique_link: 10,
  solicitacao_visita: 20,
} as const;

export type TipoEventoScore = keyof typeof PONTOS_EVENTO;

/**
 * Soma pontos ao score de engajamento do lead. Nunca deixa o score negativo
 * (não existe "desconto" de pontos por enquanto — só eventos positivos).
 */
export async function incrementarScore(
  prisma: PrismaClient,
  leadId: string,
  evento: TipoEventoScore
) {
  const pontos = PONTOS_EVENTO[evento];

  await prisma.lead.update({
    where: { id: leadId },
    data: { score: { increment: pontos } },
  });
}
