import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const senhaHash = await bcrypt.hash('mude-esta-senha', 10);

  const gestor = await prisma.usuario.upsert({
    where: { email: 'gestor@imobiliaria.com' },
    update: {},
    create: {
      nome: 'Gestor Padrão',
      email: 'gestor@imobiliaria.com',
      senhaHash,
      papel: 'gestor',
    },
  });

  const corretor1 = await prisma.usuario.upsert({
    where: { email: 'corretor1@imobiliaria.com' },
    update: {},
    create: {
      nome: 'Ana Costa',
      email: 'corretor1@imobiliaria.com',
      senhaHash,
      papel: 'corretor',
      ordemRoleta: 1,
    },
  });

  const corretor2 = await prisma.usuario.upsert({
    where: { email: 'corretor2@imobiliaria.com' },
    update: {},
    create: {
      nome: 'Bruno Lima',
      email: 'corretor2@imobiliaria.com',
      senhaHash,
      papel: 'corretor',
      ordemRoleta: 2,
    },
  });

  const templateRecepcao = await prisma.templateMensagem.create({
    data: {
      nome: 'Passo 1 - Recepção Imediata',
      conteudo:
        'Olá {{2}}! Aqui é {{1}}, consultor(a) da Norden Imóveis. Recebi seu contato sobre os imóveis em Jurerê e já fico à sua disposição por aqui para ajudar no que precisar.',
      metaTemplateName: 'recepcao_imediata_v1',
      aprovadoMeta: false,
    },
  });

  const templateQualificacao = await prisma.templateMensagem.create({
    data: {
      nome: 'Passo 2 - Qualificação Suave',
      conteudo:
        'Só para eu te ajudar melhor, {{1}}: você está buscando um imóvel para moradia ou para investimento?',
      metaTemplateName: 'qualificacao_suave_v1',
      aprovadoMeta: false,
    },
  });

  const templateAutoridade = await prisma.templateMensagem.create({
    data: {
      nome: 'Passo 3 - Autoridade / Off-Market',
      conteudo:
        'Fizemos uma curadoria de oportunidades exclusivas na região, que não estão disponíveis publicamente. Gostaria de receber nosso portfólio privado em PDF?',
      metaTemplateName: 'autoridade_off_market_v1',
      aprovadoMeta: false,
    },
  });

  const templateDespedida = await prisma.templateMensagem.create({
    data: {
      nome: 'Passo 4 - Despedida Elegante',
      conteudo:
        'Deixo seu contato salvo por aqui e seguimos à disposição para quando fizer sentido para você avançar. Foi um prazer falar contigo!',
      metaTemplateName: 'despedida_elegante_v1',
      aprovadoMeta: false,
    },
  });

  const cadencia = await prisma.cadencia.create({
    data: {
      nome: 'Cadência Concierge - Alto Padrão',
      padrao: true,
      passos: {
        create: [
          { ordem: 1, atrasoMinutos: 2, condicao: 'sempre', templateMensagemId: templateRecepcao.id },
          { ordem: 2, atrasoMinutos: 24 * 60, condicao: 'sem_resposta', templateMensagemId: templateQualificacao.id },
          { ordem: 3, atrasoMinutos: 3 * 24 * 60, condicao: 'sem_resposta', templateMensagemId: templateAutoridade.id },
          { ordem: 4, atrasoMinutos: 7 * 24 * 60, condicao: 'sem_resposta', templateMensagemId: templateDespedida.id },
        ],
      },
    },
  });

  await prisma.quickReply.create({
    data: {
      titulo: 'Agradecimento inicial',
      textoMensagem: 'Olá {{lead_name}}, aqui é {{broker_name}} da Norden Imóveis! Obrigado pelo contato, já estou vendo os detalhes do seu interesse.',
      tipo: 'global',
    },
  });

  await prisma.quickReply.create({
    data: {
      titulo: 'Envio de portfólio',
      textoMensagem: 'Oi {{lead_name}}! Segue nosso portfólio de imóveis em Jurerê, qualquer dúvida me chama por aqui.',
      tipo: 'pessoal',
      usuarioId: corretor1.id,
    },
  });

  console.log({ gestor: gestor.email, corretores: [corretor1.email, corretor2.email], cadencia: cadencia.nome });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
