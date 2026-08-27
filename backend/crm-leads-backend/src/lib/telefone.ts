/**
 * Telefones brasileiros e o "9º dígito" no WhatsApp.
 *
 * No Brasil, celulares têm um 9 depois do DDD (ex.: 55 48 9 9977-1249). Só que
 * a Meta é inconsistente: aceita ENVIAR para o número COM o 9, mas quando o
 * cliente responde, o webhook devolve o wa_id SEM o 9 (55 48 9977-1249). Se a
 * gente casar o lead por igualdade exata, a resposta não encontra o lead salvo
 * (que veio com o 9) e acaba criando um lead duplicado — além de quebrar a
 * janela de 24h para respostas livres, porque a "sessão" da Meta fica no número
 * sem o 9.
 *
 * `variantesTelefoneBR` gera as duas formas (com e sem o 9) para casar o lead
 * independentemente de qual a Meta usou. Só mexe em celular BR; qualquer outro
 * formato volta como está.
 */
export function variantesTelefoneBR(numero: string): string[] {
  const d = numero.replace(/\D/g, '');
  const variantes = new Set<string>([numero, d]);

  if (d.startsWith('55')) {
    const semPais = d.slice(2);
    // 55 + DDD(2) + 9 + 8 dígitos = 11 dígitos após o país (com o 9)
    if (semPais.length === 11 && semPais[2] === '9') {
      const ddd = semPais.slice(0, 2);
      const assinante = semPais.slice(3); // 8 dígitos
      variantes.add(`55${ddd}${assinante}`); // sem o 9
    }
    // 55 + DDD(2) + 8 dígitos = 10 dígitos após o país (sem o 9)
    else if (semPais.length === 10) {
      const ddd = semPais.slice(0, 2);
      const assinante = semPais.slice(2); // 8 dígitos
      variantes.add(`55${ddd}9${assinante}`); // com o 9
    }
  }

  return [...variantes];
}
