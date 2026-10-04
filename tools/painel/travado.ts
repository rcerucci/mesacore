// O QUE TRAVA UM PAR — e, sobretudo, o que NÃO trava.
//
// Vive num módulo próprio, sem efeitos ao carregar, para a bancada o poder provar directamente (a lição do
// `buracos.ts`: uma regra que só corre dentro de um script inteiro não se mede sozinha).
//
// A REGRA: `travado` é uma ABSTENÇÃO QUE JÁ DUROU MAIS DE UMA BARRA DO PRÓPRIO PAR. Uma volta sem ação é o estado
// normal de um sistema que espera uma viragem — o setup não propôs nada, ou propôs sem lado. Chamar «travado» a
// isso pintava de vermelho exactamente o par que estava a operar:
//
//   medido a 04/10/2026, no painel vivo — o ETH (1m, com uma ordem preenchida 10 minutos antes e 273 preenchimentos
//   na corrida) aparecia `travado` com `1 ciclo`; como o `vivo.json` (2 s) e o `painel.json` (60 s) são gerados em
//   instantes diferentes, o contador OSCILAVA entre 2 e 3 travados a cada leitura, e o dono lia «3 pares travados»
//   com o ETH a operar.
//
// Os ciclos da mesa sobem ~1/min, seja qual for o relógio do par — por isso «mais de uma barra» é literalmente
// «mais ciclos do que os minutos de uma barra»: 1m → 1 ciclo · 30m → 30 · 4h → 240.

/** Os minutos de uma barra, lidos do `relogio` da ficha («1m» → 1 · «30m» → 30 · «4h» → 240).
 *  Devolve `null` quando não se consegue ler — e aí o critério antigo mantém-se, porque na dúvida se DIZ que trava. */
export function ciclosPorBarra(relogio: string | null | undefined): number | null {
  const m = /^(\d+)\s*([mhd])$/i.exec(String(relogio ?? "").trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const unidade = m[2]!.toLowerCase();
  const minutos = unidade === "m" ? n : unidade === "h" ? n * 60 : n * 1440;
  return minutos > 0 ? minutos : null;
}

/** A corrente final de ciclos `nada` de um par — o motivo dominante, desde quando, e quantos ciclos leva.
 *
 *  `travado` = essa corrente durou MAIS QUE UMA BARRA do par. Sem relógio legível (`null`) mantém-se o critério
 *  antigo (qualquer volta sem ação): na dúvida, diz-se que trava — nunca se esconde uma abstenção. */
export function oQueTrava(
  meusCiclos: any[],
  relogio: string | null | undefined,
): { travado: boolean; porque: string | null; desde_ms: number | null; ciclos: number } {
  let porque: string | null = null;
  let desde: number | null = null;
  let quantos = 0;
  for (let k = meusCiclos.length - 1; k >= 0; k--) {
    const c = meusCiclos[k]!;
    if (c.acao !== "nada") break;
    porque = c.motivo ?? null;
    desde = c.instante_ms ?? null;
    quantos++;
  }
  const porBarra = ciclosPorBarra(relogio);
  const travado = porBarra === null ? quantos > 0 : quantos > porBarra;
  return { travado, porque, desde_ms: desde, ciclos: quantos };
}
