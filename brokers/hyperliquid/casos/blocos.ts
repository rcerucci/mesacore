// AS LEITURAS DO FICHEIRO DE CASOS — as bancadas, nunca o produto.
//
// As fichas de caso (`*.casos.json`) declaram, POR CASO, os blocos que aquele caso exercita: o que torce
// (`respostas`, `mudar`), o que confere (`conferir`, `contagens`), o que apaga (`remover`, `sem`), quem fica de
// fora (`ausentes`). Um caso que nao declare `conferir` nao esta' a conferir campo nenhum — e isso NAO e' o
// mesmo que declarar um bloco vazio, ainda que o efeito seja o mesmo: zero conferencias.
//
// Estas duas funcoes dizem-no UMA vez, com nome, em vez de o dizerem em trinta sitios com `?? {}` e `?? []`
// espalhados pelo codigo das bancadas. O que elas NAO fazem — e e' o que interessa — e' tapar uma ANOMALIA: um
// bloco PRESENTE com a forma errada (um `conferir` que veio texto, um `remover` que veio objecto) GRITA. Era
// isso que o `?? {}` escondia: `Object.entries("x")` da' as entradas de um indice de string, e o ciclo corria
// sobre lixo — a bancada passava a medir outra coisa sem que nada o dissesse.

/** As ENTRADAS de um bloco declarado pelo caso. Ausente = o caso nao exercita esse bloco (zero entradas). */
export function entradas(bloco: unknown, nome: string): [string, unknown][] {
  if (bloco === undefined || bloco === null) return [];
  if (typeof bloco !== "object" || Array.isArray(bloco)) {
    throw new Error(
      `o bloco \`${nome}\` de um caso nao e' um objecto de campos (veio ${JSON.stringify(bloco)}): uma forma errada ` +
        "nao se le como zero campos — a bancada tem de parar, e nao medir outra coisa",
    );
  }
  return Object.entries(bloco as Record<string, unknown>);
}

/** Os ITENS de uma lista declarada pelo caso. Ausente = o caso nao exercita essa lista (zero itens). */
export function itens(lista: unknown, nome: string): unknown[] {
  if (lista === undefined || lista === null) return [];
  if (!Array.isArray(lista)) {
    throw new Error(
      `a lista \`${nome}\` de um caso nao e' uma lista (veio ${JSON.stringify(lista)}): uma forma errada nao se le ` +
        "como zero itens",
    );
  }
  return lista;
}
