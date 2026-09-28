// A decisao do ciclo: o que a mesa decidiu fazer com UM instrumento, e por que nao fez o resto.
//
// Esta peca NAO envia nada (R5). Devolve um objecto observavel - `abrir` com a boleta, `fechar`,
// `adoptar` ou `nada` - e e por isso que o SC-002 se mede contando decisoes de `abrir`, e nao lendo
// codigo.
//
// A boleta e montada do mandato (o dono) e do TEMPLATE (o setup), e mais nada: nenhum valor ajustavel
// nasce aqui. Depois de montada, e VALIDADA contra o contrato - a mesa nao entrega um documento que o
// proprio contrato recusaria.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { RAIZ_DO_REPO } from "../livro-de-motivos.ts";
import type { NomeDeCondicao } from "./condicoes.ts";

export type Acao = "abrir" | "fechar" | "adoptar" | "nada";

export interface Mandato {
  /** % do saldo - valor do DONO (RN-A1, RN-M4.3). */
  saldo_pct: string;
  /** Multiplo - valor do dono. */
  alavancagem: string;
  distancia_minima_liquidacao_pct?: string;
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
  /** Para o registo: quantos invalidos SEGUIDOS (RN-T4). Invalido seguido acima do limite inibe. */
  invalidos_seguidos: number;
  /** O motivo do CONTRATO, quando a proposta foi recusada por ele (explica a invalidade). */
  motivo_do_contrato: string | null;
  /**
   * A marca `desconhecido` que travou esta decisao, com o motivo e o instante DELA. A mesa repete a
   * marca em vez de repetir o alarme: um instrumento preso 200 ciclos com a mesma causa alarmaria 200
   * vezes, e um alarme que se repete deixa de ser um alarme.
   */
  desconhecido: { motivo: string; instante_ms: number } | null;
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
