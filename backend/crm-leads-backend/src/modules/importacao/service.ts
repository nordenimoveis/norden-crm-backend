import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { normalizarTelefone } from '@/lib/normalizar-telefone';

export type ResultadoImportacao = {
  totalLinhas: number;
  importados: number;
  duplicados: number;
  invalidos: number;
  exemplosInvalidos: { linha: number; motivo: string }[];
};

type LinhaPlanilha = {
  nome?: string;
  telefone?: string;
  email?: string;
};

export class ImportacaoService {
  constructor(private prisma: PrismaClient) {}

  private parsearPlanilha(buffer: Buffer): LinhaPlanilha[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const primeiraAba = workbook.SheetNames[0];
    if (!primeiraAba) return [];

    const sheet = workbook.Sheets[primeiraAba];
    const linhasBrutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    return linhasBrutas.map((linha) => {
      const chaves = Object.keys(linha);
      const acharColuna = (sinonimos: string[]) => {
        const chave = chaves.find((k) =>
          sinonimos.includes(
            k
              .toString()
              .trim()
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
          )
        );
        return chave ? String(linha[chave]).trim() : undefined;
      };

      return {
        nome: acharColuna(['nome', 'name', 'cliente', 'contato']),
        telefone: acharColuna(['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'tel']),
        email: acharColuna(['email', 'e-mail', 'mail']),
      };
    });
  }

  async importarContatos(buffer: Buffer): Promise<ResultadoImportacao> {
    const linhas = this.parsearPlanilha(buffer);

    const resultado: ResultadoImportacao = {
      totalLinhas: linhas.length,
      importados: 0,
      duplicados: 0,
      invalidos: 0,
      exemplosInvalidos: [],
    };

    const telefonesNestaPlanilha = new Set<string>();

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const numeroLinha = i + 2;

      const telefoneNormalizado = normalizarTelefone(linha.telefone);

      if (!telefoneNormalizado) {
        resultado.invalidos++;
        if (resultado.exemplosInvalidos.length < 10) {
          resultado.exemplosInvalidos.push({
            linha: numeroLinha,
            motivo: linha.telefone ? `Telefone inválido: "${linha.telefone}"` : 'Telefone vazio',
          });
        }
        continue;
      }

      if (telefonesNestaPlanilha.has(telefoneNormalizado)) {
        resultado.duplicados++;
        continue;
      }
      telefonesNestaPlanilha.add(telefoneNormalizado);

      const jaExiste = await this.prisma.lead.findFirst({
        where: { telefone: telefoneNormalizado },
      });

      if (jaExiste) {
        resultado.duplicados++;
        continue;
      }

      await this.prisma.lead.create({
        data: {
          nome: linha.nome || undefined,
          telefone: telefoneNormalizado,
          email: linha.email || undefined,
          origem: 'importacao_planilha',
          status: 'novo',
        },
      });

      resultado.importados++;
    }

    return resultado;
  }

  async exportarContatos(filtroOrigem?: string): Promise<Buffer> {
    const leads = await this.prisma.lead.findMany({
      where: filtroOrigem ? { origem: filtroOrigem as never } : undefined,
      orderBy: { criadoEm: 'desc' },
      include: { corretor: true },
    });

    const dados = leads.map((lead) => ({
      Nome: lead.nome ?? '',
      Telefone: lead.telefone,
      Email: lead.email ?? '',
      Status: lead.status,
      Temperatura: lead.temperatura,
      Origem: lead.origem,
      Corretor: lead.corretor?.nome ?? '',
      'Criado em': lead.criadoEm.toLocaleDateString('pt-BR'),
    }));

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Contatos');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
