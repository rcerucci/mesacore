// COMO SE ESCREVE UMA MENSAGEM — nao como se decide.
//
// Isto existe por uma razao estreita, e vale a pena escreve-la: o conferidor de fallbacks
// (`tools/verificar-contrato/py/fallbacks.py`) conta `?? literal` e `|| literal` no produto, e entre os sitios
// que contava havia uma duzia de MENSAGENS que faziam `lista.join(", ") || "nenhum"`. Uma mensagem com a lista
// vazia precisa de uma palavra; isso nao e' um valor por omissao a tapar um campo em falta — e' texto.
//
// A diferenca importa porque o que se proibe e' isto: `x ?? 0`, `fichas ?? {}`, `ambiente ?? "teste"` — um
// valor que DECIDE por quem nao o declarou. Uma mensagem nao decide nada. Mesmo assim, as duas coisas nao se
// podem confundir num grep, e por isso o literal passa a viver AQUI, uma vez, com um nome — em vez de doze
// vezes espalhado pelo codigo, onde a proxima limpeza teria de voltar a decidir caso a caso se era texto ou
// decisao.
//
// REGRA: quem formata um numero, um valor ou uma lista para uma MENSAGEM usa estas funcoes. Quem decide um
// valor que entra numa regra NAO usa nada daqui — exige-o (`exigir*`), e falha se ele nao vier.

/** Uma lista de nomes para uma mensagem. Vazia diz-se "nenhum" — e' texto, nao e' valor de regra. */
export function lista(itens: readonly string[]): string {
  if (itens.length === 0) return "nenhum";
  return itens.join(", ");
}

/** O mesmo, para uma lista que se junta com outro separador (`a -> b`). */
export function listaCom(itens: readonly string[], separador: string): string {
  if (itens.length === 0) return "nenhum";
  return itens.join(separador);
}

/**
 * Um valor que PODE nao existir numa mensagem de diagnostico: diz-se "(ausente)".
 *
 * Usa-se so' onde a ausencia ja' foi declarada por quem a sabe — a mensagem limita-se a mostrar. Para uma
 * decisao, o ausente exige-se antes (e `exigir` falha), nunca se mostra este texto no lugar de um valor.
 */
export function ouAusente(valor: string | null | undefined, texto = "(ausente)"): string {
  if (valor === null || valor === undefined || valor === "") return texto;
  return valor;
}
