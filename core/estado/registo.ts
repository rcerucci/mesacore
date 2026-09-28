// O registo da mesa: uma linha por acontecimento, com o motivo sempre presente.
//
// FR-041: toda a transicao, toda a recusa e todo o desfecho ficam registrados com instante e motivo.
// SC-011: um dia de operacao tem de ser reconstruivel a partir daqui, SEM LER CODIGO - e cada linha
// traz o motivo da decisao de NAO fazer.
//
// Os tipos de linha sao um conjunto FECHADO PROPRIO (R8 do specs/002). O contrato (recorte 001) tem
// `tipos_de_linha_do_registo` = snapshot | proposta | boleta | desfecho, que sao as mensagens DO
// CONTRATO; uma transicao de estado ou uma recusa de comando nao sao mensagens do contrato - sao
// acontecimentos da mesa. Quando o ledger tiver o seu recorte, as duas listas tem de ser
// reconciliadas: uma delas ganha, e nao ha duas verdades sobre a mesma linha.

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { tiposDeLinhaDoRegisto } from "../livro-de-motivos.ts";

export const CAMINHO_DO_REGISTO = join(import.meta.dir, ".registo.jsonl");

/** Os tipos de linha da MESA. Nao se confundem com os do contrato (ver cabecalho). */
export const TIPOS_DA_MESA = ["transicao", "recusa", "ciclo", "marca"] as const;
export type TipoDaLinha = (typeof TIPOS_DA_MESA)[number];

export interface LinhaDoRegisto {
  instante_ms: number;
  tipo: TipoDaLinha;
  de?: string;
  para?: string;
  instrumento?: string;
  verbo?: string;
  autor?: string;
  motivo: string | null;
  nota?: string;
}

let cacheTiposDoContrato: string[] | null = null;

/** Os tipos de linha do CONTRATO, lidos como dado (nunca reescritos aqui). */
export function tiposDoContrato(): string[] {
  if (!cacheTiposDoContrato) cacheTiposDoContrato = tiposDeLinhaDoRegisto();
  return cacheTiposDoContrato;
}

export function registar(linha: LinhaDoRegisto, caminho: string = CAMINHO_DO_REGISTO): void {
  if (!TIPOS_DA_MESA.includes(linha.tipo)) {
    throw new Error(`tipo de linha fora do conjunto da mesa: ${linha.tipo}`);
  }
  if (linha.tipo === "recusa" && !linha.motivo) {
    // Uma recusa sem motivo no registo e a pior linha possivel: parece um acontecimento e nao explica
    // nada. SC-011 conta exactamente estas.
    throw new Error("linha de recusa sem motivo: recusa sem motivo nao se registra, corrige-se.");
  }
  appendFileSync(caminho, JSON.stringify(linha) + "\n");
}

/** Uma transicao aceite. */
export function registarTransicao(
  instante_ms: number,
  de: string,
  para: string,
  verbo: string,
  autor: string,
  motivo: string | null,
  nota: string,
  caminho?: string,
): void {
  registar({ instante_ms, tipo: "transicao", de, para, verbo, autor, motivo, nota }, caminho);
}

/** Uma recusa de comando. */
export function registarRecusa(
  instante_ms: number,
  de: string,
  verbo: string,
  autor: string,
  motivo: string,
  nota: string,
  caminho?: string,
): void {
  registar({ instante_ms, tipo: "recusa", de, verbo, autor, motivo, nota }, caminho);
}

/** A reconstrucao: le um registo e devolve o estado final - sem ler codigo (SC-011). */
export function reconstruir(linhas: LinhaDoRegisto[], estado_inicial = "parada"): string {
  let estado = estado_inicial;
  for (const l of linhas) {
    if (l.tipo === "transicao" && l.para) estado = l.para;
  }
  return estado;
}
