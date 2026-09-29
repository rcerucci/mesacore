// A TABELA DE ACCAO POR MOTIVO: o que se FAZ quando algo corre mal.
//
// Entrou no lugar do contador de invalidos seguidos (emenda do dono, 28 set 2026). O contador dizia
// QUANTAS vezes algo correu mal; a mesa precisa de saber O QUE FAZER - e isso depende do motivo, nao do
// numero: uma proposta que o contrato recusou repete-se? um prazo que passou em silencio repete-se? A
// resposta e diferente, e o numero nao a distingue. Pior: travar a mesa por uma causa que se conta e nao
// se conhece e punir o dono por um erro que pode ser do mundo.
//
// A regra estrutural esta em DADO e e conferida aqui: repete-se SO o que provadamente nao foi feito. Sem
// essa conferencia, a tabela poderia autorizar a repeticao de uma ordem que talvez tenha entrado - e
// repetir as cegas abre uma SEGUNDA posicao. E o unico erro desta mesa que custa dinheiro a serio.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type NomeDeAccao = "repetir_com_atraso" | "recusar_e_registar" | "parar_e_reconciliar" | "reduzir_e_registar";

export interface RegraDeAccao {
  accao: NomeDeAccao;
  /** `true` = sabe-se que nao saiu; `false` = sabe-se que pode ter saido; `null` = nao se sabe. */
  provadamente_nao_feito: boolean | null;
  porque: string;
}

export interface TabelaDeAccoes {
  nota: string;
  accoes: Record<NomeDeAccao, { exige: string; porque: string }>;
  regra_da_repeticao: string;
  /** Os motivos que sao FALHA (nao gestao): todos tem de ter accao declarada. */
  motivos_de_falha: string[];
  por_motivo: Record<string, RegraDeAccao>;
}

export const tabelaDeAccoes: TabelaDeAccoes = JSON.parse(
  readFileSync(join(import.meta.dir, "acoes.json"), "utf8"),
) as TabelaDeAccoes;

/**
 * A accao declarada para o motivo. Motivo sem accao NAO devolve "nada a fazer": grita.
 *
 * Devolver uma accao por omissao seria a mesa a inventar politica no momento em que algo corre mal - que
 * e exactamente quando inventar politica e mais caro.
 */
export function accaoPara(motivo: string): RegraDeAccao {
  const regra = tabelaDeAccoes.por_motivo[motivo];
  if (regra === undefined) {
    throw new Error(
      `acoes.json: o motivo '${motivo}' nao tem accao declarada. Um erro sem accao declarada e um erro ` +
        `sem resposta - e a resposta nao se inventa no momento em que o dinheiro esta em risco.`,
    );
  }
  return regra;
}

/**
 * As conferencias da tabela, nas DUAS direccoes. Devolve a lista de defeitos (vazia = confere).
 *
 * 1. Todo o motivo do contrato tem accao - senao um bilhete recusado ficava sem resposta.
 * 2. Todo o motivo de falha da mesa tem accao - pela mesma razao, do lado de dentro.
 * 3. Nenhum nome e inventado: o motivo tem de existir no vocabulario do contrato ou no livro da mesa.
 * 4. `repetir_com_atraso` so onde se sabe que nada saiu - a regra que impede a segunda posicao.
 * 5. `reduzir_e_registar` so onde se sabe que a POSICAO EXISTE (D-001): reduzir supõe haver o que
 *    reduzir, e autorizar uma reducao sobre uma posicao que talvez nao exista seria a mesma asneira da
 *    repeticao, do lado do fecho.
 */
export function conferirAccoes(
  tabela: TabelaDeAccoes,
  motivosDoContrato: string[],
  motivosDaMesa: string[],
): string[] {
  const defeitos: string[] = [];
  for (const r of motivosDoContrato) {
    if (tabela.por_motivo[r] === undefined) defeitos.push(`motivo do contrato sem accao: ${r}`);
  }
  for (const m of tabela.motivos_de_falha) {
    if (tabela.por_motivo[m] === undefined) defeitos.push(`motivo de falha sem accao: ${m}`);
  }
  for (const nome of Object.keys(tabela.por_motivo)) {
    if (!motivosDoContrato.includes(nome) && !motivosDaMesa.includes(nome)) {
      defeitos.push(`accao para um motivo que nao existe em lado nenhum: ${nome}`);
    }
  }
  for (const [nome, regra] of Object.entries(tabela.por_motivo)) {
    if (regra.accao === "repetir_com_atraso" && regra.provadamente_nao_feito !== true) {
      defeitos.push(`repeticao autorizada sem se saber que nada saiu: ${nome}`);
    }
    if (regra.accao === "reduzir_e_registar" && regra.provadamente_nao_feito !== false) {
      defeitos.push(`reducao autorizada sem se saber que a posicao existe: ${nome}`);
    }
  }
  return defeitos;
}
