/**
 * Espelha `substituirVariaveis` do backend (src/lib/template-variaveis.ts).
 * Usado só para popular a caixa de texto já com o preview resolvido quando
 * o corretor escolhe um Quick Reply — o envio de verdade (seja texto livre
 * ou quick reply) sempre passa pelo backend, que é quem tem a palavra final
 * sobre o texto que realmente sai no WhatsApp.
 */

export type VariaveisTemplate = {
  lead_name?: string;
  broker_name?: string;
};

const REGEX_VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function substituirVariaveis(texto: string, variaveis: VariaveisTemplate): string {
  return texto.replace(REGEX_VARIAVEL, (match, nomeVariavel: string) => {
    const valor = variaveis[nomeVariavel as keyof VariaveisTemplate];
    return valor ?? '';
  });
}
