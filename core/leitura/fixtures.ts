// A porta de leitura: por aqui entram as leituras.
//
// Regra desta porta (R4 + FR-015): tudo o que entra e uma mensagem do CONTRATO, e e VALIDADO contra
// ele ANTES de a mesa decidir. Uma leitura invalida e um erro de execucao, e nunca uma decisao sobre
// dado invalido - a diferenca entre "a mesa decidiu com o que tinha" e "a mesa decidiu com lixo".
//
// Hoje as leituras vem de fixtures (um caso da bateria) e do mock do conector. No recorte da
// conformidade, esta mesma porta passa a falar com o processo do conector pelo seam ja provado no
// recorte 001 (uma mensagem por linha, em texto). O que NAO muda e a fronteira: o core nao tem socket,
// nao tem chave, e nao sabe o que ha do outro lado.
//
// A validacao usa o `framing.ts` do contrato - a MESMA implementacao que as duas pontas usam. Uma
// segunda validacao escrita aqui seria uma segunda verdade sobre o mesmo envelope.

import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";

export interface LeituraCompacta {
  instrumento?: string;
  tempo_do_venue_ms?: number;
  idade_do_dado_ms: number;
  estado_do_mercado: "aberto" | "fechado";
  equity?: string;
  bid?: string;
  ask?: string;
  ultimo?: string;
  posicao?: {
    lado: "buy" | "sell";
    unidades: string;
    preco_medio: string;
    marca_de_posse: number;
  };
}

/** Monta a mensagem `mercado` do contrato a partir de uma leitura compacta. */
export function montarMercado(leitura: LeituraCompacta, correcao = 1_790_628_000_000): any {
  const carga: any = {
    instrumento: leitura.instrumento ?? "EURUSD",
    tempo_do_venue_ms: leitura.tempo_do_venue_ms ?? correcao,
    idade_do_dado_ms: leitura.idade_do_dado_ms,
    estado: leitura.estado_do_mercado,
    equity: leitura.equity ?? "1000.00",
  };
  if (leitura.bid !== undefined) carga.bid = leitura.bid;
  if (leitura.ask !== undefined) carga.ask = leitura.ask;
  if (leitura.ultimo !== undefined) carga.ultimo = leitura.ultimo;
  if (leitura.posicao !== undefined) carga.posicao = { ...leitura.posicao };
  return carga;
}

/** Monta a proposta do setup. `null` quando o setup nao propos nada (que NAO e o mesmo que `hold`). */
export function montarProposta(
  proposta: { lado?: unknown; setup?: unknown; relogio?: unknown; barra_ms?: unknown } | null | undefined,
): any | null {
  if (proposta === null || proposta === undefined) return null;
  const carga: any = { lado: proposta.lado };
  // A BARRA DO SINAL: ela e' do setup, e atravessa sem ser tocada. E' o que a mesa compara com a barra em que
  // esta' para decidir se a proposta ainda e' desta barra (contrato 1.8.0, obrigatoria).
  if (proposta.barra_ms !== undefined) carga.barra_ms = proposta.barra_ms;
  if (proposta.setup !== undefined) carga.setup = proposta.setup;
  if (proposta.relogio !== undefined) carga.relogio = proposta.relogio;
  return carga;
}

function linha(tipo: string, id: string, carga: unknown): string {
  return JSON.stringify({ contrato: versaoVigente(), tipo, id, carga });
}

/**
 * Valida a mensagem contra o contrato. Devolve a carga, ou GRITA.
 * Nao ha caminho em que uma mensagem invalida chegue ao ciclo: se isto rebentar, o problema e de quem
 * alimentou a porta, e nao da mesa.
 */
export function validarContraOContrato(
  tipo: "mercado" | "proposta",
  id: string,
  carga: unknown,
): any {
  const decisao = validar(linha(tipo, id, carga));
  if (decisao.veredicto !== "aceite") {
    throw new Error(
      `leitura recusada pelo contrato (${tipo}/${id}): ${decisao.veredicto} - ${decisao.motivo}. ` +
        `A mesa nao decide sobre dado que o contrato recusa.`,
    );
  }
  return carga;
}

/** A entrada completa do ciclo, ja validada. */
export interface EntradaDeLeitura {
  mercado: any;
  /** `null` quando o setup nada propos - ou quando propos algo que o contrato recusa. */
  proposta: any | null;
  /** Verdadeiro quando o setup propos algo que o contrato recusa (nao quando nada propos). */
  proposta_invalida: boolean;
  /** O motivo pelo qual o contrato recusou a proposta - para o registo explicar, e nao so contar. */
  motivo_do_contrato: string | null;
}

/**
 * Aqui esta a diferenca entre OS DOIS TIPOS DE RECUSA, e ela importa:
 *
 *   - uma LEITURA recusada pelo contrato e FATAL: sem leitura nao ha decisao possivel, e decidir
 *     sobre dado que o contrato recusa seria a mesa a inventar o mercado.
 *   - uma PROPOSTA recusada NAO e fatal: a RN-T4 diz que a mesa a trata como `hold` e registra a
 *     invalidade. O setup dizer algo que nao serve e um acontecimento previsto, nao um erro de
 *     execucao - e invalidos SEGUIDOS acima do limite declarado inibem a mesa.
 *
 * Confundir as duas faria a mesa parar por causa de uma proposta ma - ou pior, decidir sem mercado.
 */
export function lerParaOCiclo(
  leitura: LeituraCompacta,
  proposta: { lado?: unknown; setup?: unknown; relogio?: unknown; barra_ms?: unknown } | null | undefined,
  ciclo: number,
): EntradaDeLeitura {
  const mercado = validarContraOContrato("mercado", `m-${ciclo}`, montarMercado(leitura));

  const propostaMontada = montarProposta(proposta);
  if (propostaMontada === null) {
    return { mercado, proposta: null, proposta_invalida: false, motivo_do_contrato: null };
  }

  const decisao = validar(linha("proposta", `p-${ciclo}`, propostaMontada));
  if (decisao.veredicto === "aceite") {
    return { mercado, proposta: propostaMontada, proposta_invalida: false, motivo_do_contrato: null };
  }
  if (decisao.veredicto === "recusado") {
    return {
      mercado,
      proposta: null,
      proposta_invalida: true,
      motivo_do_contrato: decisao.motivo,
    };
  }
  // erro_de_execucao: o instrumento de medicao falhou. Nao se decide sobre isso.
  throw new Error(
    `o proprio contrato nao conseguiu validar a proposta (p-${ciclo}): erro_de_execucao. ` +
      `Nao se decide sobre uma medicao falhada.`,
  );
}

export { versaoVigente as versaoDoContratoVigente };
