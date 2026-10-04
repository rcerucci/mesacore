/**
 * AS LINHAS INTEIRAS DE UM FLUXO — um módulo puro, sem efeitos ao carregar, para poder ser provado em bancada.
 *
 * PORQUE EXISTE: um `data` de um `stream` não entrega linhas, entrega PEDAÇOS, e a fronteira cai onde calha —
 * pode cair a meio de uma linha. Partir por `\n` sem guardar o resto FABRICA, deste lado, o defeito que se quer
 * evitar: uma linha JSON partida em duas vira duas linhas que já não são JSON, e o `retrato` conta-as como
 * «linha ilegível» (o contrato do outro lado está certo, e a culpa aparece do nosso). Medido no `operador.log`
 * da corrida de risco a 03/10/2026.
 *
 * `linhasInteiras(residuo, pedaco)` devolve as linhas COMPLETAS do pedaço (juntando-lhe o resíduo anterior) e o
 * novo resíduo (a última parte, sem `\n`), para ser reenviado no pedaço seguinte.
 *
 * O `!` (asserção não-nula) em `partes[partes.length - 1]` é legítimo e NÃO é um fallback: um `split` devolve
 * sempre pelo menos um elemento, logo a última parte existe sempre. Escrever ali um `?? ""` seria tapar com um
 * literal uma ausência que não acontece — e a catraca dos fallbacks (`--exigir-zero`) reprova-o, com razão.
 */
export function linhasInteiras(residuo: string, pedaco: string): { linhas: string[]; residuo: string } {
  const partes = (residuo + pedaco).split("\n");
  const linhas = partes.slice(0, -1);
  const resto = partes[partes.length - 1]!;
  return { linhas, residuo: resto };
}
