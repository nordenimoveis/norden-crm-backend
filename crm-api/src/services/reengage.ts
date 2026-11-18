import { env } from '../config.js';
import type { TemplateContext } from '../lib/template.js';

/**
 * Variações de "retomada de contato" (envio fora da janela de 24h).
 * Cada uma corresponde a um template aprovado na Meta com 3 variáveis numeradas:
 *   {{1}} = primeiro nome do cliente
 *   {{2}} = primeiro nome do corretor
 *   {{3}} = assunto escrito pelo corretor (ex.: "o book do Origem Jurerê")
 *
 * O texto aqui deve espelhar EXATAMENTE o corpo aprovado na Meta, porque é a
 * fonte do preview mostrado ao corretor e do que será efetivamente enviado.
 */
export type ReengageVariant = 'leve' | 'material' | 'novidade' | 'despedida' | 'livre';

export const REENGAGE_VARIANTS: ReengageVariant[] = ['leve', 'material', 'novidade', 'despedida', 'livre'];

interface VariantDef {
  /** Rótulo curto para o seletor no painel. */
  label: string;
  /** Qual nome de template (vindo do .env) usar nesta variação. */
  templateName: () => string;
  /** Corpo com as variáveis numeradas, idêntico ao aprovado na Meta. */
  body: string;
  /** Valor de amostra do {{3}} enviado à Meta na aprovação do template. */
  sample: string;
  /** Variação de texto livre: {{3}} é a frase inteira (campo maior no painel). */
  free?: boolean;
}

const DEFS: Record<ReengageVariant, VariantDef> = {
  leve: {
    label: 'Retomada leve',
    templateName: () => env().TEMPLATE_RETOMADA,
    body:
      'Olá, {{1}}. Aqui é {{2}}, da Norden Imóveis. Passando para retomar nossa conversa sobre {{3}} e saber como você está nesse momento. Qualquer dúvida, é só me dizer que acompanho com você.',
    sample: 'o apartamento na Beira-Mar',
  },
  material: {
    label: 'Material enviado',
    templateName: () => env().TEMPLATE_RETOMADA_MATERIAL,
    body:
      'Olá, {{1}}. Aqui é {{2}}, da Norden Imóveis. Sem pressa — sei que a rotina corre. Queria saber se o material que te enviei sobre {{3}} fez sentido, ou se tem algo que eu possa ajustar para ficar mais a sua cara.',
    sample: 'o apartamento na Beira-Mar',
  },
  novidade: {
    label: 'Novidade para mostrar',
    templateName: () => env().TEMPLATE_RETOMADA_NOVIDADE,
    body:
      'Olá, {{1}}. Aqui é {{2}}, da Norden Imóveis. Lembrei de você: surgiu algo novo que pode ter a ver com {{3}}. Se achar que vale, te mostro sem compromisso para vermos juntos.',
    sample: 'o apartamento na Beira-Mar',
  },
  despedida: {
    label: 'Último toque, respeitoso',
    templateName: () => env().TEMPLATE_RETOMADA_DESPEDIDA,
    body:
      'Olá, {{1}}. Aqui é {{2}}, da Norden Imóveis. Respeito totalmente o seu tempo e não quero insistir. Só queria entender se {{3}} ainda faz parte dos seus planos, ou se prefere retomar mais adiante. Como for melhor para você, eu acompanho.',
    sample: 'o apartamento na Beira-Mar',
  },
  livre: {
    label: 'Mensagem livre',
    templateName: () => env().TEMPLATE_RETOMADA_LIVRE,
    body:
      'Olá, {{1}}. Aqui é {{2}}, da Norden Imóveis. {{3}} Fico à disposição para seguirmos quando for melhor para você.',
    sample: 'Consegui a condição que comentei e lembrei de você.',
    free: true,
  },
};

/**
 * Preview da variação: corpo com {{1}}/{{2}}/{{3}} preenchidos pelo contexto e
 * assunto. Função pura (não lê env), para espelhar exatamente o que será enviado.
 */
export function reengagePreview(variant: ReengageVariant, ctx: TemplateContext, subject: string): string {
  const lead = (ctx.lead_first_name ?? '').trim();
  const broker = (ctx.broker_first_name ?? '').trim() || 'a Norden';
  const out = DEFS[variant].body
    .replace(/\{\{\s*1\s*\}\}/g, lead)
    .replace(/\{\{\s*2\s*\}\}/g, broker)
    .replace(/\{\{\s*3\s*\}\}/g, subject);
  // Sem primeiro nome do cliente: "Olá, . Aqui é" vira "Olá! Aqui é".
  return out.replace(/Olá,\s*\.\s*/g, 'Olá! ');
}

/**
 * Resolve a variação escolhida em: nome do template, parâmetros numerados
 * (na ordem que o Chatwoot espera) e o preview para a linha do tempo/painel.
 */
export function renderReengage(
  variant: ReengageVariant,
  ctx: TemplateContext,
  subject: string,
): { name: string; params: string[]; preview: string } {
  return {
    name: DEFS[variant].templateName(),
    params: [ctx.lead_first_name ?? '', ctx.broker_first_name ?? '', subject],
    preview: reengagePreview(variant, ctx, subject),
  };
}

/** Catálogo das variações (para o painel montar o seletor e o preview ao vivo). */
export function reengageCatalog(): { variant: ReengageVariant; label: string; template: string; body: string; free: boolean }[] {
  return REENGAGE_VARIANTS.map((v) => ({
    variant: v,
    label: DEFS[v].label,
    template: DEFS[v].templateName(),
    body: DEFS[v].body,
    free: DEFS[v].free ?? false,
  }));
}

/**
 * Definições dos templates de retomada no formato de criação da Graph API da Meta
 * (nome, idioma, categoria, corpo e a amostra do {{3}}). Usado pelo script que
 * cria/aprova os templates — a fonte do corpo é a mesma do preview, então nunca
 * saem de sincronia.
 */
export function reengageMetaTemplates(): {
  variant: ReengageVariant;
  name: string;
  language: string;
  category: string;
  body: string;
  sample: string;
}[] {
  return REENGAGE_VARIANTS.map((v) => ({
    variant: v,
    name: DEFS[v].templateName(),
    language: 'pt_BR',
    category: 'MARKETING',
    body: DEFS[v].body,
    sample: DEFS[v].sample,
  }));
}
