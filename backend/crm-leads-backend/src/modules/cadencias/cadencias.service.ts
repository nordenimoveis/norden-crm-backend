import { PrismaClient } from '@prisma/client';
import { agendarPasso } from '@/queues/cadencia.queue';

export class CadenciasService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Chamado logo após um lead ser criado (independente da origem: Meta Ads,
   * Instagram ou site próprio). Vincula o lead à cadência marcada como `padrao`
   * e agenda o Passo 1 (recepção imediata, 1-3 min de jitter).
   */
  async iniciarCadenciaParaLead(leadId: string) {
    const cadenciaPadrao = await this.prisma.cadencia.findFirst({
      where: { padrao: true, ativo: true },
      include: { passos: { orderBy: { ordem: 'asc' } } },
    });

    if (!cadenciaPadrao) {
      // eslint-disable-next-line no-console
      console.warn('Nenhuma cadência padrão configurada — lead criado sem cadência automática');
      return null;
    }

    const passo1 = cadenciaPadrao.passos.find((p) => p.ordem === 1);
    if (!passo1) {
      // eslint-disable-next-line no-console
      console.warn(`Cadência padrão "${cadenciaPadrao.nome}" não tem Passo 1 configurado`);
      return null;
    }

    const execucao = await this.prisma.leadCadenciaExecucao.create({
      data: {
        leadId,
        cadenciaId: cadenciaPadrao.id,
        passoAtual: 0,
        status: 'ativa',
      },
    });

    const { jobId, agendadoPara } = await agendarPasso(
      { execucaoId: execucao.id, leadId },
      1,
      passo1.atrasoMinutos
    );

    await this.prisma.leadCadenciaExecucao.update({
      where: { id: execucao.id },
      data: { proximoJobId: jobId, proximoDisparoEm: agendadoPara },
    });

    return execucao;
  }
}
