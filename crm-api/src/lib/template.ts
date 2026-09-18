export interface TemplateContext {
  lead_name?: string | null;
  lead_first_name?: string | null;
  broker_name?: string | null;
  broker_first_name?: string | null;
  lead_interest?: string | null;
}

export function firstName(full?: string | null): string {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}

export function buildContext(lead: { name: string; interest?: string | null }, broker?: { name: string } | null): TemplateContext {
  return {
    lead_name: lead.name,
    lead_first_name: firstName(lead.name),
    broker_name: broker?.name ?? '',
    broker_first_name: firstName(broker?.name),
    lead_interest: lead.interest ?? '',
  };
}

/** Substitui {{variavel}} pelos valores do contexto. Variáveis desconhecidas ficam intactas. */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) => {
    const value = (ctx as Record<string, string | null | undefined>)[name];
    return value == null ? match : value;
  });
}
