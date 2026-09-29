// O REGISTRO DO VIGIA: o que ele recebeu, o que decidiu e o que a mesa respondeu.
//
// Vive em `vigia/.vigia.json` e NAO no ledger da mesa. O ledger e da conta e do dinheiro; este e da
// OPERACAO. Misturar os dois faria o extrato do dono contar arranques de processo - e um extrato que conta
// outra coisa deixa de ser extrato.
//
// A escrita e ATOMICA (ficheiro temporario + rename): um vigia morto a meio de uma gravacao nao pode deixar
// um registro pela metade. Um registro ilegivel e o mesmo que um registro ausente, e quem vier depois le-o
// como "nao houve nada" - que e exactamente a conclusao errada.
//
// Uma linha por TRANSICAO, e nao por comando: um comando recusado tambem transita (de X para X), e um
// registro que so guardasse o que mudou de estado esconderia justamente as recusas.

import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface TransicaoDoVigia {
  instante_ms: number;
  verbo: string;
  autor: string;
  pedido_id: string;
  aceito: boolean;
  de: string;
  para: string;
  motivo: string | null;
  efeito: string | null;
  /** Só quando as portas recusaram: QUAL das seis, e o motivo dela. E este o "detalhe" da T021. */
  porta: string | null;
  motivo_da_porta: string | null;
  /** O que se chegou a olhar no arranque - nao o que se diz que se olhou. */
  portas_conferidas: string[];
}

export interface Registro {
  nota: string;
  transicoes: TransicaoDoVigia[];
}

export function registoVazio(): Registro {
  return {
    nota:
      "O registro do vigia: uma linha por transicao, com o que foi pedido, o que a mesa respondeu e - no " +
      "arranque - ate onde as seis portas foram conferidas. Nao guarda valores de conta nem preco: isso e " +
      "do ledger, e o ledger e do dinheiro.",
    transicoes: [],
  };
}

export function lerRegisto(caminho: string): Registro {
  try {
    return JSON.parse(readFileSync(caminho, "utf8")) as Registro;
  } catch {
    return registoVazio();
  }
}

/** Acrescenta uma transicao e grava. Devolve o registro como ficou. */
export function acrescentar(caminho: string, t: TransicaoDoVigia): Registro {
  const registro = lerRegisto(caminho);
  registro.transicoes.push(t);
  const temporario = caminho + ".tmp";
  writeFileSync(temporario, JSON.stringify(registro, null, 2) + "\n");
  renameSync(temporario, caminho);
  return registro;
}
