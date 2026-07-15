/**
 * Substituição de variáveis dinâmicas nos Quick Replies.
 *
 * Suporta `{{lead_name}}` e `{{broker_name}}` por enquanto — a lista de
 * variáveis é fechada de propósito (um Record tipado), então adicionar uma
 * nova variável no futuro (ex: `{{imovel_titulo}}`) é só acrescentar uma
 * chave aqui, sem precisar mexer no regex de substituição.
 */

export type VariaveisTemplate = {
  lead_name?: string;
  broker_name?: string;
};

const REGEX_VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Substitui todas as ocorrências de `{{variavel}}` no texto pelo valor
 * correspondente em `variaveis`. Uma variável sem valor disponível vira
 * string vazia (em vez de manter o placeholder cru na mensagem final,
 * o que pareceria um bug para o lead).
 */
export function substituirVariaveis(texto: string, variaveis: VariaveisTemplate): string {
  return texto.replace(REGEX_VARIAVEL, (match, nomeVariavel: string) => {
    const valor = variaveis[nomeVariavel as keyof VariaveisTemplate];
    return valor ?? '';
  });
}
