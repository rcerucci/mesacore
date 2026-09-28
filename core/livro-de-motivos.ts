// O livro de motivos e o conjunto fechado de valores do core.
//
// NENHUM motivo e escrito em codigo neste recorte (FR-044, RN-A1): o interprete le-os daqui.
// Os motivos de recusa da mesa sao um conjunto PROPRIO (R7 do specs/002) - o vocabulario do
// contrato (contracts/vocabulario.json) e a lingua que cruza a fronteira entre processos, e
// estes sao a resposta a um comando, que e interface interna.
//
// Quando o vigia for processo separado (RN-E8), estes motivos passam a cruzar a fronteira e
// terao de entrar no contrato. Nesse dia e uma mensagem nova, e volta ao recorte 001.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Este ficheiro vive em core/, logo a raiz do repositorio e o directorio acima.
export const RAIZ_DO_REPO = join(import.meta.dir, "..");

export interface Motivo {
  quando: string;
  regra: string;
  porque: string;
}

interface Livro {
  nota: string;
  familia: string;
  motivos: Record<string, Motivo>;
  ordem_de_leitura: string[];
}

let cacheLivro: Livro | null = null;

export function livroDeMotivos(): Livro {
  if (!cacheLivro) {
    // O ficheiro vive ao lado da tabela de transicoes: os motivos de recusa sao da maquina de estados.
    cacheLivro = JSON.parse(
      readFileSync(join(import.meta.dir, "estados", "motivos.json"), "utf8"),
    ) as Livro;
  }
  return cacheLivro;
}

export function motivosDaMesa(): Record<string, Motivo> {
  return livroDeMotivos().motivos;
}

/** O motivo existe no conjunto fechado? Um motivo inventado nao passa. */
export function motivoConhecido(motivo: string): boolean {
  return Object.prototype.hasOwnProperty.call(motivosDaMesa(), motivo);
}

/**
 * O vocabulario do CONTRATO (recorte 001) - lido como dado, nunca reescrito aqui.
 * Serve para duas coisas: os tipos de linha do registo e a versao vigente do contrato.
 */
export function vocabularioDoContrato(): any {
  return JSON.parse(readFileSync(join(RAIZ_DO_REPO, "contracts", "vocabulario.json"), "utf8"));
}

export function versaoVigenteDoContrato(): string {
  return JSON.parse(readFileSync(join(RAIZ_DO_REPO, "contracts", "versao.json"), "utf8")).contrato;
}

/** Os tipos de linha do registo sao do contrato, nao deste recorte. */
export function tiposDeLinhaDoRegisto(): string[] {
  return vocabularioDoContrato().tipos_de_linha_do_registo;
}
