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
export type ReengageVariant = 'leve' | 'material' | 'novidade' | 'despedida';

export const REENGAGE_VARIANTS: ReengageVariant[] = ['leve', 'material', 'novidade', 'despedida'];

interface VariantDef {
  /** Rótulo curto para o seletor no painel. */
  label: string;
  /** Qual nome de template (vindo do .env) usar nesta variação. */
  templateName: () => string;
  /** Corpo com as variáveis numeradas, idêntico ao aprovado na Meta. */
  body: string;
}

const DEFS: Record<ReengageVariant, VariantDef> = {
  leve: {
    label: 'Retomada leve',
    templateName: () => env().TEMPLATE_RETOMADA,
    body:
      'Oi {{1}}, tudo bem? Aqui é {{2}}, da Norden. Fiquei pensando na nossa conversa sobre {{3}} e queria saber como você está — a ideia seguiu de pé ou surgiu alguma dúvida que eu possa esclarecer com você?',
  },
  material: {
    label: 'Material enviado',
    templateName: () => env().TEMPLATE_RETOMADA_MATERIAL,
    body:
      'Oi {{1}}, tudo bem? Aqui é {{2}}, da Norden. Sei que a rotina corre, então passo com calma: o material que te enviei sobre {{3}} fez sentido para o que você procura, ou tem algo que eu possa ajustar para ficar mais a sua cara?',
  },
  novidade: {
    label: 'Novidade para mostrar',
    templateName: () => env().TEMPLATE_RETOMADA_NOVIDADE,
    body:
      'Oi {{1}}, tudo bem? Aqui é {{2}}, da Norden. Lembrei de você: surgiu uma novidade sobre {{3}} que tem tudo a ver com o que você me contou. Posso te mostrar para a gente ver juntos se encaixa?',
  },
  despedida: {
    label: 'Último toque, respeitoso',
    templateName: () => env().TEMPLATE_RETOMADA_DESPEDIDA,
    body:
      'Oi {{1}}, tudo bem? Aqui é {{2}}, da Norden. Respeito total o seu tempo e não quero insistir — só queria saber se {{3}} ainda está nos seus planos ou se prefere retomar mais para frente. Como fica melhor para você?',
  },
};

/**
 * Preview da variação: corpo com {{1}}/{{2}}/{{3}} preenchidos pelo contexto e
 * assunto. Função pura (não lê env), para espelhar exatamente o que será enviado.
 */
export function reengagePreview(variant: ReengageVariant, ctx: TemplateContext, subject: string): string {
  const lead = (ctx.lead_first_name ?? '').trim() || 'tudo bem';
  const broker = (ctx.broker_first_name ?? '').trim() || 'a Norden';
  return DEFS[variant].body
    .replace(/\{\{\s*1\s*\}\}/g, lead)
    .replace(/\{\{\s*2\s*\}\}/g, broker)
    .replace(/\{\{\s*3\s*\}\}/g, subject);
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
export function reengageCatalog(): { variant: ReengageVariant; label: string; template: string; body: string }[] {
  return REENGAGE_VARIANTS.map((v) => ({
    variant: v,
    label: DEFS[v].label,
    template: DEFS[v].templateName(),
    body: DEFS[v].body,
  }));
}
