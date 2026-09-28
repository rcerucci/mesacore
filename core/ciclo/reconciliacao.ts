// A reconciliacao: a UNICA saida do desconhecido.
//
// O contrato de saida deste ficheiro tem tres resultados, e nao dois:
//
//   preenchida   -> a ordem existe na corretora: o instrumento vai a `aberta`, e a marca sai
//   inexistente  -> a ordem nao existe: o instrumento volta a `nenhuma`, e a marca sai
//   indecidivel  -> a reconciliacao NAO conseguiu decidir: a marca FICA, e o motivo alarma
//
// O terceiro e o que se esquece. Uma reconciliacao que nao decide e tentadora de tratar como
// "provavelmente nao entrou" - e essa e a decisao que deixa a posicao orfa. Nao decidir tem de ser um
// resultado declarado, e nao uma ausencia.
//
// E `reset` nao aparece neste ficheiro de proposito: o reset nao limpa a marca (FR-029). A saida do
// desconhecido e uma reconcilIacao que DECIDA, e mais nada.

import { deveAvisar, type ConfiguracaoDaConta } from "../config/configuracao.ts";
import { limparDesconhecido, type Marcas } from "../estado/marcas.ts";

export type Veredicto = "preenchida" | "inexistente" | "indecidivel";

export interface ResultadoDaReconciliacao {
  instrumento: string;
  veredicto: Veredicto;
  /** Onde o instrumento fica. `desconhecida` e um valor legitimo, e nao um erro. */
  estado_da_posicao: "aberta" | "nenhuma" | "desconhecida";
  marca_permanece: boolean;
  motivo: string;
  /** O que foi preciso observar para decidir - vai para o registo. */
  evidencia: string;
  avisa: boolean;
  porque: string;
}

export function reconciliar(
  marcas: Marcas,
  instrumento: string,
  veredicto: Veredicto,
  evidencia: string,
  config: ConfiguracaoDaConta,
): { marcas: Marcas; resultado: ResultadoDaReconciliacao } {
  const marca = marcas.desconhecido.find((d) => d.instrumento === instrumento) ?? null;
  const avisa = deveAvisar(config, "desconhecido");

  if (marca === null) {
    return {
      marcas,
      resultado: {
        instrumento,
        veredicto: "indecidivel",
        estado_da_posicao: "desconhecida",
        marca_permanece: false,
        motivo: "reconciliacao_sem_marca",
        evidencia,
        avisa: false,
        porque:
          "Nao havia marca de desconhecido neste instrumento: uma reconciliacao do que nao estava em duvida nao muda nada.",
      },
    };
  }

  if (veredicto === "indecidivel") {
    return {
      marcas,
      resultado: {
        instrumento,
        veredicto,
        estado_da_posicao: "desconhecida",
        marca_permanece: true,
        motivo: "reconciliacao_indecidivel",
        evidencia,
        avisa,
        porque:
          "A reconciliacao nao decidiu. O instrumento FICA desconhecido (FR-030) - nao decidir nao e decidir que nao entrou.",
      },
    };
  }

  const marcasNovas = limparDesconhecido(marcas, instrumento);
  const preenchida = veredicto === "preenchida";

  return {
    marcas: marcasNovas,
    resultado: {
      instrumento,
      veredicto,
      estado_da_posicao: preenchida ? "aberta" : "nenhuma",
      marca_permanece: false,
      motivo: preenchida ? "reconciliacao_decidiu_preenchida" : "reconciliacao_decidiu_inexistente",
      evidencia,
      avisa,
      porque: preenchida
        ? "A ordem existe na corretora: a posse passa a ser um facto lido dela, e o bloqueio sai (FR-029)."
        : "A ordem nao existe na corretora: nao ha posicao, e o bloqueio sai (FR-029).",
    },
  };
}
