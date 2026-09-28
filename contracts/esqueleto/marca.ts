// A marca de posse — geracao e leitura, deterministicas (RN-B10).
//
//   bun run esqueleto/marca.ts          # corre a bateria de invariantes e mede
//
// A mesa escreve a marca na ordem; o venue guarda-a na forma que o manifesto declarar (cloid,
// clientOrderId, magic ou comment), e e por ela que a posicao se reconhece como NOSSA depois de
// um reinicio (RN-T16.1). Nao ha base de dados de posicoes: a posse le-se do venue.
//
// O desenho do campo vive em vocabulario.json (bits de ficha, bits de ciclo, limites) e e
// CONFERIDO por aritmetica aqui. Um layout cujos limites nao sejam 2^n-1 recusa trabalhar — em vez
// de deixar passar marcas que colidem em silencio.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RAIZ } from "./framing.ts";

export interface Layout {
  bits_totais: number;
  bits_ficha: number;
  bits_ciclo: number;
  ficha_minima: number;
  ficha_maxima: number;
  ciclo_maximo: number;
}

export interface Marca {
  ficha: number;
  ciclo: number;
}

export function layout(): Layout {
  const vocabulario = JSON.parse(readFileSync(join(RAIZ, "vocabulario.json"), "utf8"));
  return vocabulario.marca_de_posse_layout as Layout;
}

/** Recusa o layout se os numeros nao fecharem: nao se trabalha com um campo mal desenhado. */
export function conferirLayout(l: Layout): string[] {
  const problemas: string[] = [];
  if (l.bits_ficha + l.bits_ciclo !== l.bits_totais) {
    problemas.push(`bits: ${l.bits_ficha} + ${l.bits_ciclo} != ${l.bits_totais}`);
  }
  if (l.ficha_maxima !== 2 ** l.bits_ficha - 1) {
    problemas.push(`ficha_maxima ${l.ficha_maxima} != 2^${l.bits_ficha}-1`);
  }
  if (l.ciclo_maximo !== 2 ** l.bits_ciclo - 1) {
    problemas.push(`ciclo_maximo ${l.ciclo_maximo} != 2^${l.bits_ciclo}-1`);
  }
  // A marca inteira tem de caber no campo mais restrito dos venues: 31 bits (POSITION_MAGIC).
  const maximo = l.ficha_maxima * 2 ** l.bits_ciclo + l.ciclo_maximo;
  if (maximo !== 2 ** l.bits_totais - 1) {
    problemas.push(`marca maxima ${maximo} != 2^${l.bits_totais}-1`);
  }
  if (l.ficha_minima !== 1) {
    problemas.push(`ficha_minima ${l.ficha_minima}: zero nao identifica ficha nenhuma`);
  }
  return problemas;
}

export interface Resultado {
  marca?: number;
  motivo?: string;
}

/** Deterministica: a mesma (ficha, ciclo) da sempre a mesma marca. Fora da banda, RECUSA. */
export function comporMarca(ficha: number, ciclo: number, l: Layout = layout()): Resultado {
  if (!Number.isInteger(ficha) || ficha < l.ficha_minima || ficha > l.ficha_maxima) {
    return { motivo: "ficha_fora_da_banda" };
  }
  if (!Number.isInteger(ciclo) || ciclo < 0 || ciclo > l.ciclo_maximo) {
    return { motivo: "ciclo_fora_da_banda" };
  }
  return { marca: ficha * 2 ** l.bits_ciclo + ciclo };
}

/** Le a marca de volta. Nao adivinha: uma marca fora da banda e recusada, nao truncada. */
export function lerMarca(marca: number, l: Layout = layout()): Marca | null {
  if (!Number.isInteger(marca) || marca < 0 || marca > 2 ** l.bits_totais - 1) return null;
  const ficha = Math.floor(marca / 2 ** l.bits_ciclo);
  const ciclo = marca % 2 ** l.bits_ciclo;
  if (ficha < l.ficha_minima || ficha > l.ficha_maxima) return null;
  return { ficha, ciclo };
}

// ---------------------------------------------------------------- bateria de invariantes

function bateria(): number {
  const l = layout();
  let falhas = 0;

  const problemas = conferirLayout(l);
  if (problemas.length > 0) {
    for (const p of problemas) console.log(`LAYOUT INCOERENTE: ${p}`);
    falhas += problemas.length;
  } else {
    console.log(`layout: ${l.bits_ficha} bits de ficha + ${l.bits_ciclo} de ciclo = ${l.bits_totais} (conferido por aritmetica)`);
  }

  // 1. determinismo: a mesma entrada da a mesma marca
  const primeiro = comporMarca(7, 42).marca;
  const segundo = comporMarca(7, 42).marca;
  const deterministico = primeiro !== undefined && primeiro === segundo;
  console.log(`${deterministico ? "ok  " : "FALHA"} determinismo: (ficha 7, ciclo 42) -> ${primeiro} duas vezes`);
  if (!deterministico) falhas += 1;

  // 2. ida e volta sem perda em toda a fronteira
  let perdidos = 0;
  const amostras: Array<[number, number]> = [
    [1, 0],
    [1, 1],
    [l.ficha_maxima, l.ciclo_maximo],
    [l.ficha_maxima, 0],
    [1, l.ciclo_maximo],
    [2048, 262144],
  ];
  for (const [ficha, ciclo] of amostras) {
    const marca = comporMarca(ficha, ciclo).marca;
    const lido = marca === undefined ? null : lerMarca(marca);
    const ok = lido !== null && lido.ficha === ficha && lido.ciclo === ciclo;
    if (!ok) {
      perdidos += 1;
      console.log(`FALHA ida e volta: (${ficha}, ${ciclo}) -> ${marca} -> ${JSON.stringify(lido)}`);
    }
  }
  console.log(`${perdidos === 0 ? "ok  " : "FALHA"} ida e volta: ${amostras.length - perdidos}/${amostras.length} marcas voltam a dar a mesma (ficha, ciclo)`);
  falhas += perdidos;

  // 3. unicidade por (ficha, ciclo) — sem colisoes em toda a banda de fichas, com ciclo a 1
  const vistas = new Set<number>();
  let colisoes = 0;
  for (let ficha = l.ficha_minima; ficha <= l.ficha_maxima; ficha += 1) {
    const marca = comporMarca(ficha, 1).marca!;
    if (vistas.has(marca)) colisoes += 1;
    vistas.add(marca);
  }
  console.log(`${colisoes === 0 ? "ok  " : "FALHA"} unicidade: ${vistas.size} marcas distintas para ${l.ficha_maxima} fichas`);
  falhas += colisoes;

  // 4. o ciclo nao da a volta em silencio
  const estourado = comporMarca(1, l.ciclo_maximo + 1);
  const recusaCiclo = estourado.marca === undefined;
  console.log(`${recusaCiclo ? "ok  " : "FALHA"} ciclo estourado (${l.ciclo_maximo + 1}) -> ${estourado.motivo ?? "ACEITOU"}`);
  if (!recusaCiclo) falhas += 1;

  // 5. a ficha 0 nao existe, e a marca 0 nao e reencontravel
  const zero = comporMarca(0, 0);
  const recusaZero = zero.marca === undefined && lerMarca(0) === null;
  console.log(`${recusaZero ? "ok  " : "FALHA"} ficha 0 -> ${zero.motivo ?? "ACEITOU"}; ler marca 0 -> ${JSON.stringify(lerMarca(0))}`);
  if (!recusaZero) falhas += 1;

  // 6. marca fora dos 31 bits e recusada, nao truncada
  const enorme = lerMarca(2 ** l.bits_totais);
  const recusaEnorme = enorme === null;
  console.log(`${recusaEnorme ? "ok  " : "FALHA"} marca acima de ${l.bits_totais} bits -> ${JSON.stringify(enorme)}`);
  if (!recusaEnorme) falhas += 1;

  console.log(falhas === 0 ? "marca: 0 falhas" : `marca: ${falhas} falhas`);
  return falhas;
}

if (import.meta.main) {
  process.exit(bateria() === 0 ? 0 : 1);
}
