// A decisao do ciclo: o que a mesa decidiu fazer com UM instrumento, e por que nao fez o resto.
//
// Esta peca NAO envia nada (R5). Devolve um objecto observavel - `abrir` com a boleta, `fechar`,
// `reverse`, `adoptar` ou `nada` - e e por isso que o SC-002 se mede contando decisoes de `abrir`, e nao
// lendo codigo. A lista das acoes vive declarada no `contracts/vocabulario.json` (`acoes_da_mesa`), que e
// o que este `Acao` exprime: `reverse` e' a virada (aditiva na 1.10.0) — fecha a posicao viva e abre a do
// lado, tratada pelo CONECTOR (e' ele que tem o venue).
//
// A boleta e montada do mandato (o dono) e do TEMPLATE (o setup), e mais nada: nenhum valor ajustavel
// nasce aqui. Depois de montada, e VALIDADA contra o contrato - a mesa nao entrega um documento que o
// proprio contrato recusaria.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { RAIZ_DO_REPO } from "../livro-de-motivos.ts";
import type { VeredictoDaBanda } from "./banda.ts";
import type { NomeDeCondicao } from "./condicoes.ts";

export type Acao = "abrir" | "fechar" | "reverse" | "adoptar" | "nada";

/**
 * O TRAVAO DE RISCO POR ORDEM (RN-M4.12, D-015) — o que a comparacao com o tecto da conta FEZ, e o que ela nao
 * pode fazer.
 *
 * Vive aqui, e nao no `ciclo.ts`, porque e' da DECISAO: quem le a decisao tem de poder dizer se o travão foi
 * conferido, contra que tecto, e com que exposicao — um «abriu» sem isto nao distingue «cabia» de «nao havia
 * tecto declarado».
 */
export interface VeredictoDoRiscoPorOrdem {
  /** A exposicao da ordem em % do saldo (`saldo_pct` x `alavancagem`) — a MESMA unidade do tecto. */
  exposicao: string;
  /** O tecto que a CONTA declarou, ou `null` quando ela nao o declarou (nao ha' travão, e isso diz-se). */
  tecto: string | null;
  /** `true` so' quando havia tecto, e a comparacao se fez. Nunca se le' `false` como «cabia». */
  conferido: boolean;
  veredicto: VeredictoDaBanda;
  porque: string;
}

export interface Mandato {
  /** % do saldo - valor do DONO (RN-A1, RN-M4.3). */
  saldo_pct: string;
  /** Multiplo - valor do dono. */
  alavancagem: string;
  distancia_minima_liquidacao_pct?: string;
  /**
   * As bandas que o dono declarou para os parametros do setup (RN-S10, RN-M6.2). O `arranque` confere as
   * bandas de `saldo_pct`/`alavancagem`; estas duas - `stop_pct` e `tp_pct` - sao conferidas no CICLO, onde
   * o valor do setup aparece (D-008). Ausente = o dono nao declarou banda, e nao ha' limite a aplicar.
   */
  bandas?: Record<string, { minimo?: string; maximo?: string }>;
}

export interface Template {
  /** Quem escolhe o tipo de ordem e o setup, pelo template (RN-B8). */
  politica_de_execucao: "mercado" | "limite" | "stop" | "stop_limite" | "mercado_por_faixa";
  parcial: "tudo_ou_nada" | "o_que_der";
  desvio_maximo: string;
  prazo_da_passiva_ms: number;
  destino_do_resto: "agressivo" | "cancelar";
  stop_pct?: string;
  tp_pct?: string;
}

export interface PedidoDeBoleta {
  instrumento: string;
  lado: string;
  mandato: Mandato;
  template: Template;
  reduce_only: boolean;
  /** A VIRADA (1.10.0): `true` so' com a accao `reverse` — fecha a posicao viva e abre a do lado. */
  reverter: boolean;
  /**
   * O TAMANHO RELATIVO A' POSICAO VIVA (1.11.0, D-013): `1` = a posicao inteira (= nao e' uma reducao parcial);
   * abaixo de `1` = essa fraccao, e quem a converte em quantidade e' o CONECTOR, que le' a posicao do venue.
   * Obrigatorio no contrato pela D4: «nao e' parcial» e' um valor declarado, e a ausencia diria «nao foi
   * declarado».
   */
  posicao_pct: string;
  ficha: string;
  ciclo: number;
}

export interface Decisao {
  instrumento: string;
  acao: Acao;
  motivo: string | null;
  condicao: NomeDeCondicao;
  /** As condicoes activas, para o registo dizer o que travou e nao so o nome da primeira. */
  impedimentos: NomeDeCondicao[];
  /** Se este caso entra na lista de eventos que avisam (a lista e do dono - FR-042). */
  avisa: boolean;
  boleta: any | null;
  /** O motivo do CONTRATO, quando a proposta foi recusada por ele (explica a invalidade). */
  motivo_do_contrato: string | null;
  /**
   * A marca `desconhecido` que travou esta decisao, com o motivo e o instante DELA. A mesa repete a
   * marca em vez de repetir o alarme: um instrumento preso 200 ciclos com a mesma causa alarmaria 200
   * vezes, e um alarme que se repete deixa de ser um alarme.
   */
  desconhecido: { motivo: string; instante_ms: number } | null;
  /**
   * O TRAVAO DE RISCO POR ORDEM (RN-M4.12, D-015) desta decisao, quando ela seria `abrir` ou `reverse`.
   *
   * Existe para a DIFERENCA ser legivel: `conferido: false` diz que a CONTA nao declarou tecto nenhum (a ordem
   * abriu porque nao havia limite a aplicar — uma decisao de quem nao o declarou), enquanto `conferido: true`
   * diz que houve comparacao e ela passou. Sem este campo, as duas coisas liam-se da mesma maneira no registo.
   */
  risco_por_ordem?: VeredictoDoRiscoPorOrdem | null;
}

let layoutDaMarca: { bits_ciclo: number; ficha_minima: number; ficha_maxima: number; ciclo_maximo: number } | null =
  null;

function lerLayoutDaMarca() {
  if (!layoutDaMarca) {
    layoutDaMarca = JSON.parse(
      readFileSync(join(RAIZ_DO_REPO, "contracts", "vocabulario.json"), "utf8"),
    ).marca_de_posse_layout;
  }
  return layoutDaMarca!;
}

/**
 * A marca de posse: `ficha << bits_ciclo | ciclo`. O layout e lido do vocabulario do contrato, e o
 * resultado e CONFERIDO por aritmetica: ficha fora da gama ou ciclo que da a volta RECUSAM, em vez de
 * produzirem em silencio uma marca que aponta para outra ficha.
 */
export function marcaDePosse(ficha: number, ciclo: number): number {
  const l = lerLayoutDaMarca();
  if (ficha < l.ficha_minima || ficha > l.ficha_maxima) {
    throw new Error(`ficha fora da gama: ${ficha} (o layout admite ${l.ficha_minima}..${l.ficha_maxima})`);
  }
  if (ciclo < 0 || ciclo > l.ciclo_maximo) {
    throw new Error(`ciclo fora da gama: ${ciclo} (o layout admite 0..${l.ciclo_maximo})`);
  }
  return (ficha << l.bits_ciclo) | ciclo;
}

/** A referencia do cliente: liga a boleta, o desfecho e o registo (RN-C4). */
export function referenciaDoCliente(ficha: string, ciclo: number): string {
  return `mesa-${ficha}-${String(ciclo).padStart(6, "0")}`;
}

export function montarBoleta(pedido: PedidoDeBoleta): any {
  const { mandato, template } = pedido;
  const boleta: any = {
    instrumento: pedido.instrumento,
    lado: pedido.lado,
    tipo: template.politica_de_execucao,
    saldo_pct: mandato.saldo_pct,
    alavancagem: mandato.alavancagem,
    parcial: template.parcial,
    desvio_maximo: template.desvio_maximo,
    prazo_da_passiva_ms: template.prazo_da_passiva_ms,
    destino_do_resto: template.destino_do_resto,
    reduce_only: pedido.reduce_only,
    reverter: pedido.reverter,
    posicao_pct: pedido.posicao_pct,
    referencia_do_cliente: referenciaDoCliente(pedido.ficha, pedido.ciclo),
    marca_de_posse: marcaDePosse(Number(pedido.ficha), pedido.ciclo),
  };
  // O stop e do SETUP (stop sim/nao e do template): se ele o declarar, a boleta leva-o.
  if (template.stop_pct !== undefined) boleta.stop_pct = template.stop_pct;
  if (template.tp_pct !== undefined) boleta.tp_pct = template.tp_pct;

  // A boleta e validada contra o contrato ANTES de sair: um documento que o contrato recusaria nao
  // chega a ser uma decisao.
  const decisao = validar(
    JSON.stringify({ contrato: versaoVigente(), tipo: "boleta", id: boleta.referencia_do_cliente, carga: boleta }),
  );
  if (decisao.veredicto !== "aceite") {
    throw new Error(
      `boleta montada recusada pelo contrato (${decisao.veredicto} - ${decisao.motivo}): ` +
        `${JSON.stringify(boleta)}. A mesa recusa entregar o que o contrato nao aceita.`,
    );
  }
  return boleta;
}
