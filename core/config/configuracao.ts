// A configuracao do DONO: o que a mesa le, valida, e nunca escreve (RN-E12).
//
// Esta peca existe por causa de uma regra so, e essa regra e a FR-042: a LISTA dos eventos que avisam e
// do dono, nao do codigo. Sem isto, "alarma" seria uma coluna escrita por quem programa - e o dono
// ficaria a discutir com o codigo sobre se quer ser acordado.
//
// Duas coisas gritam aqui, e as duas pelo mesmo motivo (um alarme desligado em silencio):
//
//   1. a lista NAO declarada: nao ha lista por omissao. Uma mesa que avisa por omissao e uma mesa que
//      escolheu pelo dono.
//   2. um nome de evento que nao consta do conjunto fechado (`eventos.json`): 'congelado' em vez de
//      'congelamento' nunca avisaria, e ninguem daria por isso.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ConfiguracaoDaConta {
  /** A chave `conta.eventos_que_avisam[]` do inventario. Sem ela, GRITA. */
  eventos_que_avisam: string[];
  /**
   * A chave `conta.arranque_apos_cb` do inventario (FR-037, RN-M3.3). A unica politica declarada e
   * `exige_decisao`; qualquer outro valor (ou a ausencia) faz a porta da sessao GRITAR.
   */
  arranque_apos_cb?: unknown;
  /** As restantes chaves do macro entram nos recortes que as usam (contenda, CB, margem). */
  [chave: string]: unknown;
}

interface LivroDeEventos {
  nota: string;
  regra: string;
  porque: string;
  eventos: Record<string, { regra: string; porque: string }>;
}

let cacheEventos: LivroDeEventos | null = null;

export function livroDeEventos(): LivroDeEventos {
  if (!cacheEventos) {
    cacheEventos = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "ciclo", "eventos.json"), "utf8"),
    ) as LivroDeEventos;
  }
  return cacheEventos;
}

export function eventoConhecido(nome: string): boolean {
  return Object.prototype.hasOwnProperty.call(livroDeEventos().eventos, nome);
}

/**
 * Este evento avisa? A resposta vem da config do dono - e de mais nada.
 *
 * `evento === null` significa "esta condicao nao tem evento associado" (o mercado fechado, por
 * exemplo): nao ha nada a avisar e nao se vai buscar a config para isso.
 */
export function deveAvisar(config: ConfiguracaoDaConta, evento: string | null): boolean {
  if (evento === null) return false;

  const lista = config?.eventos_que_avisam;
  if (!Array.isArray(lista)) {
    throw new Error(
      "a configuracao nao declara 'eventos_que_avisam' (conta.eventos_que_avisam[]). " +
        "Uma mesa que avisa por omissao escolheu pelo dono - e a FR-042 diz que a lista e dele.",
    );
  }

  for (const nome of lista) {
    if (!eventoConhecido(nome)) {
      throw new Error(
        `a configuracao pede para avisar de '${nome}', que nao consta do conjunto fechado ` +
          `(core/ciclo/eventos.json). Um nome mal escrito desligaria o alarme em silencio.`,
      );
    }
  }

  return lista.includes(evento);
}

/** Os eventos que avisam, para o registo poder dizer com que lista a mesa decidiu. */
export function eventosDeclarados(config: ConfiguracaoDaConta): string[] {
  return [...config.eventos_que_avisam];
}
