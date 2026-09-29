// A sonda do venue e o manifesto do conector (FR-001 a FR-005).
//
// Este ficheiro NAO fala com o venue: recebe a resposta do venue como DADO e devolve o manifesto do contrato
// — ou uma recusa NOMEADA. E por isso que ele corre offline, e e por isso que os casos dele sao casos.
//
// O que ele nunca faz: inventar um numero do venue, preencher um campo por omissao, ou usar um motivo que nao
// esteja no conjunto fechado do contrato (contracts/vocabulario.json e _defs/forma.schema.json).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "..", "..");

function lerJson(caminho: string): any {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

/** O que o venue responde. Tudo o que o manifesto afirma tem de vir daqui. */
export type Sonda = {
  venue: { nome: string; ambiente: "teste" | "producao" };
  versao_do_conector: string;
  meta: { universe: { name: string; szDecimals: number; maxLeverage: number }[] };
  instrumentos_pedidos: string[];
  minimo_de_valor_por_ordem?: string;
  modos_de_margem?: string[];
  tipos_de_ordem?: string[];
  parcial_suportada?: string[];
  desvio_maximo?: string;
  reduce_only_suportado?: boolean;
  stop_anexo?: boolean;
  ajusta_alavancagem?: boolean;
  profundidade_de_livro?: number;
  funding_publicado?: boolean;
  relogio_de_fecho_de_barra?: string;
  idempotencia?: boolean;
  marca_de_posse?: string;
  marca_liga_ordem_a_posicao?: boolean;
  estado_do_mercado?: boolean;
};

export type Recusa = { ok: false; motivo: string; porque: string };
export type Feito = { ok: true; manifesto: Record<string, unknown> };
export type Resultado = Feito | Recusa;

/** A versao do contrato vem de UMA so casa — a mesma que os dois runners leem. Nunca escrita aqui. */
export function versaoDoContrato(): string {
  return lerJson(join(RAIZ, "contracts", "versao.json")).contrato;
}

/** Os nomes permitidos, lidos do proprio contrato: um motivo inventado aqui nao passa. */
function conjunto(familia: "formas_de_marca" | "tipos_de_ordem" | "politicas_de_parcial"): string[] {
  return lerJson(join(RAIZ, "contracts", "vocabulario.json"))[familia];
}

function recusa(motivo: string, porque: string): Recusa {
  return { ok: false, motivo, porque };
}

/**
 * 10^-casas escrito como DECIMAL TEXTUAL do contrato. O contrato proibe expoente ("1e-5" nao e decimal
 * valido, e recusado por tipo) — e o passo do venue tem de ser dito na lingua do contrato, nao na nossa.
 */
function dezElevadoA(casas: number): string {
  if (casas <= 0) return "1";
  return "0." + "0".repeat(casas - 1) + "1";
}

/**
 * Constroi o manifesto a partir da sonda. Nenhum numero do venue entra por omissao: o que a sonda nao
 * declarar e RECUSA (campo_obrigatorio_ausente), e o que ela declarar fora do conjunto fechado do contrato e
 * RECUSA (valor_fora_do_conjunto). Um campo que falta nunca fica com o valor "de sempre".
 */
export function construirManifesto(sonda: Sonda): Resultado {
  // O que a sonda tem de trazer, sem o que nao ha manifesto nenhum.
  const obrigatorios: [string, unknown][] = [
    ["meta.universe", sonda?.meta?.universe],
    ["instrumentos_pedidos", sonda?.instrumentos_pedidos],
    ["minimo_de_valor_por_ordem", sonda?.minimo_de_valor_por_ordem],
    ["modos_de_margem", sonda?.modos_de_margem],
    ["tipos_de_ordem", sonda?.tipos_de_ordem],
    ["parcial_suportada", sonda?.parcial_suportada],
    ["desvio_maximo", sonda?.desvio_maximo],
    ["relogio_de_fecho_de_barra", sonda?.relogio_de_fecho_de_barra],
    ["marca_de_posse", sonda?.marca_de_posse],
  ];
  for (const [nome, valor] of obrigatorios) {
    if (valor === undefined || valor === null) {
      return recusa("campo_obrigatorio_ausente", `a sonda do venue nao trouxe ${nome} — sem ele nao ha manifesto`);
    }
  }

  // As capacidades booleanas: ausentes NAO viram `true` por omissao (fail-closed).
  const capacidades: [string, unknown][] = [
    ["ajusta_alavancagem", sonda.ajusta_alavancagem],
    ["reduce_only_suportado", sonda.reduce_only_suportado],
    ["stop_anexo", sonda.stop_anexo],
    ["funding_publicado", sonda.funding_publicado],
    ["idempotencia", sonda.idempotencia],
    ["marca_liga_ordem_a_posicao", sonda.marca_liga_ordem_a_posicao],
    ["estado_do_mercado", sonda.estado_do_mercado],
  ];
  for (const [nome, valor] of capacidades) {
    if (valor !== true && valor !== false) {
      return recusa(
        "capacidade_nao_declarada",
        `o venue nao declarou ${nome}: a mesa recusa a boleta em vez de a mandar a um venue que pode ignora-la`,
      );
    }
  }

  // Os instrumentos: cada um com a SUA unidade. Sem unidade declarada nao ha resolucao possivel.
  const instrumentos = [];
  for (const simbolo of sonda.instrumentos_pedidos) {
    const cru = sonda.meta.universe.find((u) => u.name === simbolo);
    if (!cru) {
      return recusa(
        "valor_fora_do_conjunto",
        `o instrumento ${simbolo} nao existe no venue`,
      );
    }
    if (typeof cru.szDecimals !== "number" || typeof cru.maxLeverage !== "number") {
      return recusa(
        "campo_obrigatorio_ausente",
        `o venue nao declarou szDecimals/alavancagem maxima para ${simbolo}`,
      );
    }
    instrumentos.push({
      simbolo: cru.name,
      // O passo e do venue, derivado do szDecimals dele: nao e um numero nosso.
      minimo: dezElevadoA(cru.szDecimals),
      passo: dezElevadoA(cru.szDecimals),
      tick: dezElevadoA(Math.max(0, 6 - cru.szDecimals)),
      alavancagem_maxima: String(cru.maxLeverage),
    });
  }

  // Os conjuntos fechados: um valor que o contrato nao conhece nao entra no manifesto.
  const tipos_aceitos = conjunto("tipos_de_ordem");
  for (const t of sonda.tipos_de_ordem as string[]) {
    if (!tipos_aceitos.includes(t)) {
      return recusa("valor_fora_do_conjunto", `o tipo de ordem ${t} nao existe no contrato`);
    }
  }
  const parciais_aceitas = conjunto("politicas_de_parcial");
  for (const p of sonda.parcial_suportada as string[]) {
    if (!parciais_aceitas.includes(p)) {
      return recusa("valor_fora_do_conjunto", `a politica de parcial ${p} nao existe no contrato`);
    }
  }
  const marcas = conjunto("formas_de_marca");
  if (!marcas.includes(sonda.marca_de_posse as string)) {
    return recusa("valor_fora_do_conjunto", `a forma de marca ${sonda.marca_de_posse} nao existe no contrato`);
  }

  const manifesto = {
    conector: { nome: sonda.venue.nome, versao: sonda.versao_do_conector },
    versao: versaoDoContrato(),
    instrumentos,
    sabe_ajustar_alavancagem: sonda.ajusta_alavancagem,
    modos_de_margem: sonda.modos_de_margem,
    teto_de_valor_por_ordem: sonda.minimo_de_valor_por_ordem,
    modelo_de_posicao: "netting",
    tipos_de_ordem: sonda.tipos_de_ordem,
    parcial_suportada: sonda.parcial_suportada,
    desvio_maximo: sonda.desvio_maximo,
    reduce_only_suportado: sonda.reduce_only_suportado,
    stop_anexo: sonda.stop_anexo,
    profundidade_de_livro: sonda.profundidade_de_livro,
    funding: sonda.funding_publicado,
    relogio_de_fecho_de_barra: sonda.relogio_de_fecho_de_barra,
    idempotencia: sonda.idempotencia,
    marca_de_posse: sonda.marca_de_posse,
    marca_liga_ordem_a_posicao: sonda.marca_liga_ordem_a_posicao,
    estado_do_mercado: sonda.estado_do_mercado,
  };
  return { ok: true, manifesto };
}
