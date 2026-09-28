// O circuit breaker: a corrida da mesa medida contra o limite declarado.
//
// Quatro coisas definem este ficheiro, e as quatro estao na spec:
//
//   1. corre POR SESSAO (FR-035): o que se mede e a perda desde o equity de partida DAQUELA sessao -
//      comparar com um equity de outra configuracao seria comparar numeros que nao se comparam;
//   2. sobre o equity COM nao realizado (RN-M3): o equity da corretora, e nao o saldo; uma posicao aberta
//      a caminhar para o limite dispara o CB sem nada ter sido fechado;
//   3. corre MESMO COM A MESA PAUSADA (FR-040): por isso o estado da mesa NAO entra nesta funcao. Nao e
//      um pormenor de estilo - se o estado entrasse como parametro, alguem acabaria a usa-lo para "nao
//      verificar quando esta pausada", e a pausa passaria a ser um lugar onde a conta pode afundar;
//   4. a comparacao e EXACTA. `perda >= limite` decide-se por multiplicacao cruzada em BigInt, e o que se
//      reporta e o DEFICIT (exacto), nunca uma percentagem arredondada. Uma percentagem com casas
//      arredondadas ao lado de um limite de 5% e a maneira mais facil de disparar (ou nao disparar) por
//      causa da terceira casa decimal.

import { deveAvisar, type ConfiguracaoDaConta } from "../config/configuracao.ts";
import type { Sessao } from "../estado/marcas.ts";

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Texto decimal -> inteiro + casas, para a comparacao poder ser exacta. Recusa o que nao for decimal. */
function exacto(texto: unknown, onde: string): { valor: bigint; casas: number } {
  if (typeof texto !== "string" || !DECIMAL.test(texto)) {
    throw new Error(`${onde}: '${String(texto)}' nao e um decimal textual - nao se compara o que nao se leu (D4)`);
  }
  const negativo = texto.startsWith("-");
  const [inteiro, fraccao = ""] = (negativo ? texto.slice(1) : texto).split(".");
  const valor = BigInt(inteiro + fraccao) * (negativo ? -1n : 1n);
  return { valor, casas: fraccao.length };
}

/** Diferença exacta `a - b`, devolvida como decimal textual. */
function diferenca(a: { valor: bigint; casas: number }, b: { valor: bigint; casas: number }): string {
  const casas = Math.max(a.casas, b.casas);
  const va = a.valor * 10n ** BigInt(casas - a.casas);
  const vb = b.valor * 10n ** BigInt(casas - b.casas);
  const r = va - vb;
  if (casas === 0) return r.toString();
  const sinal = r < 0n ? "-" : "";
  const abs = (r < 0n ? -r : r).toString().padStart(casas + 1, "0");
  return `${sinal}${abs.slice(0, -casas)}.${abs.slice(-casas)}`;
}

export interface EstadoDaConta {
  /** O equity da corretora, com nao realizado dentro. */
  equity: string;
  /** O equity de abertura do dia - so olhado quando a janela declarada e o dia de calendario. */
  equity_de_abertura_do_dia?: string;
}

export interface ResultadoDoCB {
  disparou: boolean;
  /** A janela com que se mediu, como o dono a declarou. */
  janela: string;
  /** O ponto de partida da medicao (equity de partida da sessao, ou o do dia). */
  base: string;
  /** O que se perdeu, exacto: `base - equity`. */
  deficit: string;
  limite_pct: string;
  motivo: string | null;
  avisa: boolean;
  porque: string;
}

export function conferirCB(
  conta: EstadoDaConta,
  sessao: Sessao | null,
  config: ConfiguracaoDaConta,
): ResultadoDoCB {
  // Sem sessao nao ha janela: nao se sabe desde quando se mede. E o CB GRITA - nao devolve "nao disparou",
  // que e o que uma mesa sem unidade de comparacao diria para si propria para continuar a operar.
  if (sessao === null) {
    throw new Error(
      "Nao ha sessao em curso: a corrida da mesa nao tem inicio, e uma perda sem inicio nao se mede " +
        "(FR-035, RN-M3). Uma sessao nova e do dono - nao se inventa um ponto de partida para poder medir.",
    );
  }

  const janela = config.perda_maxima_janela;
  if (janela !== "corrida_da_mesa" && janela !== "dia_de_calendario") {
    throw new Error(
      `conta.perda_maxima_janela: '${String(janela)}' nao e uma janela declarada. ` +
        "Sem janela nao se sabe desde quando se mede - e uma perda sem origem nao se compara (RN-M3).",
    );
  }

  const base =
    janela === "corrida_da_mesa" ? sessao.equity_de_partida : conta.equity_de_abertura_do_dia;
  if (typeof base !== "string") {
    throw new Error(
      "A janela declarada e o dia de calendario e o equity de abertura do dia nao foi lido. " +
        "Medir uma janela sem o seu inicio daria uma perda inventada - nao se dispara o CB por aproximacao.",
    );
  }

  const limite = exacto(config.perda_maxima_pct, "conta.perda_maxima_pct");
  const partida = exacto(base, `base da janela '${janela}'`);
  const actual = exacto(conta.equity, "mercado.equity");
  const deficit = diferenca(partida, actual);

  // `deficit / partida >= limite / 100`  <=>  `deficit * 100 * 10^casas(partida) * 10^casas(limite) >=
  // limite * partida * 10^casas(deficit)`, tudo inteiro e positivo: a multiplicacao cruzada tira a
  // divisao da jogada, e nao ha sinal a depender de uma dízima com casas infinitas.
  const deficitExacto = exacto(deficit, "deficit");
  const esquerda =
    deficitExacto.valor * 100n * 10n ** BigInt(partida.casas) * 10n ** BigInt(limite.casas);
  const direita = limite.valor * partida.valor * 10n ** BigInt(deficitExacto.casas);
  const disparou = esquerda >= direita;

  return {
    disparou,
    janela,
    base,
    deficit,
    limite_pct: config.perda_maxima_pct as string,
    motivo: disparou ? "cb_disparou_no_ciclo" : null,
    // O evento e o `cb` - e quem decide se ele avisa e a lista do dono (FR-042). Se o dono nao pediu
    // para ser avisado do CB, a mesa nao o acorda; o que ela NAO faz e deixar de disparar por isso.
    avisa: disparou && deveAvisar(config, "cb"),
    porque: disparou
      ? `A corrida perdeu ${deficit} sobre ${base} (${janela}), e o limite declarado e ${config.perda_maxima_pct}% de ${base}.`
      : `A corrida perdeu ${deficit} sobre ${base} (${janela}), dentro do limite declarado de ${config.perda_maxima_pct}%.`,
  };
}

/**
 * O encadeamento do disparo (FR-036): encerrar, liquidar o que houver, e so entao parar com a inibicao
 * marcada. A sequencia e DADO porque a ordem e a regra: liquidar antes de parar e o que impede uma
 * posicao ficar viva numa mesa parada - e uma mesa parada nao defende nada.
 */
export const ENCADEAMENTO_DO_DISPARO = ["encerrar", "liquidar", "inibir_e_parar"] as const;

export function encadeamentoDoDisparo(disparou: boolean): string[] {
  return disparou ? [...ENCADEAMENTO_DO_DISPARO] : [];
}
