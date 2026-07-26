import { PrismaClient } from '@prisma/client';
import { ImobziService } from '@/modules/imobzi/imobzi.service';

/**
 * Script de sincronização em lote da base antiga do Imobzi.
 *
 * Rode manualmente ou via cron:
 *   npm run sync:imobzi
 *
 * Regra de negócio (repetindo, porque é crítica): os leads importados por
 * este script NUNCA passam pelo round-robin e NUNCA disparam a cadência do
 * WhatsApp — ficam apenas salvos com origem 'legado_imobzi' ("Base Antiga").
 * Isso é garantido pelo `LeadsService.importarLeadLegado`, não por nada
 * neste script — então mesmo rodando este script várias vezes, ou chamando
 * o endpoint HTTP equivalente, o comportamento é sempre o mesmo.
 */
async function main() {
  const prisma = new PrismaClient();
  const imobziService = new ImobziService(prisma);

  console.log('[sync:imobzi] Iniciando sincronização da base legada...');
  const inicio = Date.now();

  const resumo = await imobziService.sincronizarBaseLegada();

  const duracaoSegundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    `[sync:imobzi] Concluído em ${duracaoSegundos}s — processados: ${resumo.processados}, criados: ${resumo.criados}, ignorados/duplicados: ${resumo.ignorados}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[sync:imobzi] Falha na sincronização:', err);
  process.exit(1);
});
