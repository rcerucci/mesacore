#!/usr/bin/env bun
// A LEITURA DO MERCADO — o objecto de factos que a mesa consome a cada volta (RN-D1, RN-D5).
//
// PORQUE EXISTE. Medido (29/09/2026): a mesa le a operacao (`core/servidor.ts --operacao f.json`) e o campo
// `instrumentos.<i>.leitura` e por onde a leitura entra no ciclo. O `mercado` — o tipo do CONTRATO que
// carrega esses factos — so era produzido nas FIXTURES das bancadas: em operacao, ninguem o produzia, e o
// setup nao tinha com que calcular as suas features. Esta peca e o produtor que faltava, do lado de quem
// conhece o venue.
//
// AS DUAS LEITURAS, e porque sao duas:
//   * a CONTA (equity, posicoes, instante do venue) — `brokers/hyperliquid/leitura.ts`, a porta que ja
//     existia, com os seus motivos nomeados. Reutiliza-se: uma segunda leitura da conta seria uma segunda
//     verdade sobre o mesmo dinheiro.
//   * o MERCADO (bid, ask, ultimo, estado da exchange) — aqui, com as leituras publicas do venue.
//
// O QUE ESTA PECA NAO FAZ, e diz-se:
//   * NAO decide nada e nao julga risco: devolve factos do venue, com a ORIGEM de cada um nomeada (RN-C11);
//   * NAO inventa um numero que o venue nao deu. Um campo que o venue nao publicou fica AUSENTE (RN-D4), e o
//     que impede o `mercado` de sair e' a FALHA de uma leitura obrigatoria — nunca um valor por omissao;
//   * NAO le a chave: o `info` do venue e' publico, e esta leitura nao move dinheiro nenhum.
//
// Uso (bancada e estudo):
//   bun run brokers/hyperliquid/leitura-do-mercado.ts --instrumento BTC [--agora <ms>] [--json]

import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import {
  lerConta,
  lerDoVenueDaConta,
  type PortaDeConta,
  type PosicaoDaLeitura,
} from "./leitura.ts";
import type { PortaDeLeitura } from "./sonda.ts";
import { readFileSync, existsSync } from "node:fs";

/** A porta que esta leitura consome: a da conta e as leituras publicas do mercado. */
export type PortaDaLeituraDeMercado = {
  conta: PortaDeConta;
  leitura: Pick<PortaDeLeitura, "livro" | "velas" | "estadoDaExchange" | "execucoes">;
};

/** O cliente do venue, na forma ESTRUTURAL que esta porta consome (o SDK oficial encaixa aqui). */
export type ClienteDaLeituraDeMercado = {
  clearinghouseState(p: { user: string }): Promise<unknown>;
  spotClearinghouseState(p: { user: string }): Promise<unknown>;
  activeAssetData(p: { user: string; coin: string }): Promise<unknown>;
  extraAgents(p: { user: string }): Promise<unknown>;
  openOrders(p: { user: string }): Promise<unknown>;
  userFills(p: { user: string }): Promise<unknown>;
  l2Book(p: { coin: string }): Promise<unknown>;
  candleSnapshot(p: { coin: string; interval: string; startTime: number }): Promise<unknown>;
  exchangeStatus(): Promise<unknown>;
};

export function portaDoCliente(cliente: ClienteDaLeituraDeMercado): PortaDaLeituraDeMercado {
  return {
    conta: {
      contaPerpetuo: (conta) => cliente.clearinghouseState({ user: conta }),
      contaSpot: (conta) => cliente.spotClearinghouseState({ user: conta }),
      activoDaConta: (conta, coin) => cliente.activeAssetData({ user: conta, coin }),
      agentesDaConta: (conta) => cliente.extraAgents({ user: conta }),
      // AS ORDENS VIVAS (contrato 1.9.0). E' o que existe na conta e nao e' posicao — e a marca de posse
      // viaja aqui, no `cloid`: e' por ela que a posse se le' (RN-T16.1).
      ordensDaConta: (conta) => cliente.openOrders({ user: conta }),
    },
    leitura: {
      livro: (coin) => cliente.l2Book({ coin }),
      velas: (coin, inicioMs) => cliente.candleSnapshot({ coin, interval: "1h", startTime: inicioMs }),
      estadoDaExchange: () => cliente.exchangeStatus(),
      // AS EXECUCOES da conta: e' por elas que uma posicao se atribui a uma marca nossa (RN-T16.1).
      execucoes: (conta) => cliente.userFills({ user: conta }),
    },
  };
}

export type PedidoDaLeituraDeMercado = {
  /** O endereco da conta MASTER (a armadilha da documentacao: com o do agente o venue devolve vazio). */
  conta: string;
  instrumento: string;
  /** O instante do NOSSO relogio, para medir a idade do dado. Declarado como nosso: a idade e' uma medida. */
  agora_ms: number;
  /** A janela das velas, para o `ultimo`. Por omissao: 2 barras de 1h atras. */
  desde_ms?: number;
};

export type MercadoLido = {
  /** A carga do `mercado`, ja validada contra o contrato — pronta a entrar num envelope. */
  carga: Record<string, unknown>;
  /** A ORIGEM de cada grandeza (RN-C11): a chamada de onde ela veio, e nao "o venue" em geral. */
  origens: Record<string, string>;
  /** O que o venue nao publicou, dito (RN-D4) — ausencia declarada, nunca um valor neutro. */
  ausentes: string[];
};

export type ResultadoDaLeituraDeMercado =
  | { ok: true; mercado: MercadoLido }
  | { ok: false; motivo: string; porque: string };

const DECIMAL_POSITIVO = /^(0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$/;
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function objecto(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function numero(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * O MELHOR NIVEL do livro, num lado. O venue publica `levels[0]` (bids, do melhor para baixo) e
 * `levels[1]` (asks). Um lado VAZIO nao vira zero: fica ausente — um bid a zero seria um preco publicado, e
 * nenhum venue publica isso.
 */
function melhorNivel(livro: unknown, lado: 0 | 1): string | undefined {
  const raiz = objecto(livro);
  const niveis = raiz?.levels;
  if (!Array.isArray(niveis) || !Array.isArray(niveis[lado])) return undefined;
  const primeiro = objecto((niveis[lado] as unknown[])[0]);
  const px = primeiro !== undefined ? texto(primeiro.px) : undefined;
  return px !== undefined && DECIMAL_POSITIVO.test(px) ? px : undefined;
}

/** O ESTADO DO MERCADO, do protocolo do venue: a lista de estados especiais VAZIA (`null`) e' `aberto`. */
function estadoDoMercado(bruto: unknown): { estado: "aberto" | "fechado"; porque: string } | { erro: string } {
  const raiz = objecto(bruto);
  if (raiz === undefined) return { erro: "a resposta de `exchangeStatus` nao trouxe um objecto de estado" };
  if (!Object.prototype.hasOwnProperty.call(raiz, "specialStatuses")) {
    return { erro: "a resposta de `exchangeStatus` nao trouxe `specialStatuses`: `null` de uma chave ausente nao e' um valor" };
  }
  const especiais = raiz.specialStatuses;
  if (especiais === null) {
    return { estado: "aberto", porque: "`exchangeStatus().specialStatuses` veio `null` (nenhum estado especial em vigor)" };
  }
  return {
    estado: "fechado",
    porque: "`exchangeStatus().specialStatuses` declara estados especiais em vigor: " + JSON.stringify(especiais),
  };
}

/** O ULTIMO preco publicado na vela mais recente (`candleSnapshot[].c`) — um numero DO VENUE, nao um calculo. */
function ultimoDaVela(velas: unknown): { ultimo?: string; quantas: number } {
  if (!Array.isArray(velas)) return { quantas: 0 };
  const ultima = objecto(velas[velas.length - 1]);
  const c = ultima !== undefined ? texto(ultima.c) : undefined;
  return { ...(c !== undefined && DECIMAL_POSITIVO.test(c) ? { ultimo: c } : {}), quantas: velas.length };
}

/**
 * O `mercado` a partir do que o venue respondeu. PURA: nao vai a rede, e por isso se prova em dado.
 *
 * `falhas` traz as leituras que nao se conseguiram fazer, com a razao delas: qualquer uma das obrigatorias
 * que falte RECUSA — um `mercado` sem equity e' um mercado que a mesa nao pode usar, e servi-lo seria
 * decidir sobre um vazio.
 */

/**
 * AS ORDENS VIVAS, do que o venue respondeu para a forma do contrato (1.9.0).
 *
 * O venue responde a lista de ordens de TODA a conta; aqui ficam so' as do instrumento desta leitura, porque o
 * `mercado` e' por instrumento. O `side` do venue e' "A"/"B" (ask/bid) e nao `buy`/`sell`: traduz-se AQUI, num
 * sitio so', e um lado que nao seja nenhum dos dois RECUSA — traduzir por semelhanca seria a mesa a inventar o
 * lado de uma ordem viva.
 *
 * Uma resposta que nao seja lista RECUSA. Uma lista VAZIA nao: ela diz "perguntei, e nao ha' nenhuma".
 */
/**
 * O MAPA DE MARCAS (RN-T16.1): `cloid` -> marca, lido do ficheiro que o operador mantem quando envia uma ordem.
 * O caminho vem do ambiente (`MARCAS_DA_CONTA`), porque quem o escreve e' o operador e quem o le' e' esta porta.
 * Sem caminho declarado nao ha mapa — e sem mapa uma posicao vai sem dono, que e' diferente de a declarar nossa.
 */
function mapaDeMarcas(): { cloid: string; marca: number }[] {
  const caminho = process.env.MARCAS_DA_CONTA;
  if (caminho === undefined || caminho === "") return [];
  if (!existsSync(caminho)) return [];
  const linhas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");
  const mapa: { cloid: string; marca: number }[] = [];
  for (const l of linhas) {
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      throw new Error(`o mapa de marcas (${caminho}) tem uma linha ilegivel: a posse nao se decide com um mapa furado`);
    }
    if (typeof o?.cloid === "string" && typeof o?.marca === "number") mapa.push({ cloid: o.cloid, marca: o.marca });
  }
  return mapa;
}

/** O `cloid` do preenchimento MAIS RECENTE deste instrumento, ou `undefined` se o venue nao mostrou nenhum. */
function preenchimentoMaisRecente(execucoes: unknown, instrumento: string): string | undefined {
  if (!Array.isArray(execucoes)) return undefined;
  let melhor: { t: number; cloid: string } | undefined;
  for (const e of execucoes) {
    const o = objecto(e);
    if (o === undefined || String(o.coin) !== instrumento) continue;
    if (typeof o.cloid !== "string" || o.cloid === "") continue;
    const t = Number(o.time);
    if (!Number.isFinite(t)) continue;
    if (melhor === undefined || t > melhor.t) melhor = { t, cloid: o.cloid };
  }
  return melhor?.cloid;
}

function lerOrdensVivas(
  bruto: unknown,
  instrumento: string,
): { ok: true; ordens: unknown[] } | { ok: false; porque: string } {
  if (!Array.isArray(bruto)) {
    return {
      ok: false,
      porque: `a resposta das ordens vivas nao e' uma lista (veio ${typeof bruto}): sem lista nao se sabe o que esta' pendurado na conta`,
    };
  }
  const ordens: unknown[] = [];
  for (const o of bruto) {
    const r = objecto(o);
    if (r === undefined) return { ok: false, porque: "uma ordem viva veio sem forma de objecto" };
    if (String(r.coin) !== instrumento) continue;
    const ladoDoVenue = String(r.side);
    const lado = ladoDoVenue === "A" ? "sell" : ladoDoVenue === "B" ? "buy" : undefined;
    if (lado === undefined) {
      return {
        ok: false,
        porque: `uma ordem viva de ${instrumento} veio com lado \`${ladoDoVenue}\`: no venue so' A (venda) e B (compra)`,
      };
    }
    ordens.push({
      instrumento,
      ordem: String(r.oid),
      lado,
      preco: String(r.limitPx),
      unidades: String(r.sz),
      ...(r.cloid !== undefined && r.cloid !== null ? { marca_de_posse: String(r.cloid) } : {}),
    });
  }
  return { ok: true, ordens };
}

export function montarMercado(
  bruto: {
    conta: Parameters<typeof lerConta>[0];
    livro: unknown;
    estado: unknown;
    velas: unknown;
    ordens: unknown;
    execucoes: unknown;
  },
  pedido: PedidoDaLeituraDeMercado,
  /** As leituras que nem chegaram a ser tentadas (a porta falhou): entram como falha, nao como ausencia. */
  falhas: { leitura: string; motivo: string; porque: string }[] = [],
): ResultadoDaLeituraDeMercado {
  if (falhas.length > 0) {
    const primeira = falhas[0]!;
    return {
      ok: false,
      motivo: `${primeira.leitura}_nao_lida`,
      porque:
        `a leitura \`${primeira.leitura}\` do venue falhou (${primeira.motivo}): ${primeira.porque}. ` +
        (falhas.length > 1 ? `Falharam ${falhas.length} leituras: ${falhas.map((f) => f.leitura).join(", ")}. ` : "") +
        "Um `mercado` a que falte um facto obrigatorio nao se entrega: a mesa decidiria sobre um vazio.",
    };
  }

  const lido = lerConta(bruto.conta, { conta: pedido.conta, instrumento: pedido.instrumento });
  if (!lido.ok) {
    return {
      ok: false,
      motivo: `conta_nao_lida:${lido.motivo}`,
      porque: lido.porque,
    };
  }
  const leituraDaConta = lido.leitura;
  const carteira = leituraDaConta.carteiras.perpetuo;
  if (carteira.estado !== "lida") {
    return {
      ok: false,
      motivo: "conta_nao_lida",
      porque:
        `a carteira do perpetuo nao se leu (${carteira.motivo}): ${carteira.porque}. O equity e' o numero do ` +
        "circuit breaker (RN-M3) e nao se estima",
    };
  }

  const estado = estadoDoMercado(bruto.estado);
  if ("erro" in estado) {
    return { ok: false, motivo: "estado_nao_lido", porque: estado.erro };
  }

  const tempo = numero(leituraDaConta.instante_do_venue_ms);
  if (tempo === undefined) {
    return {
      ok: false,
      motivo: "tempo_do_venue_nao_lido",
      porque:
        "a resposta da conta trouxe a carteira mas nao o instante do venue (`clearinghouseState.time`): a idade " +
        "do dado mede-se contra o relogio DELE (RN-D2), e com o nosso relogio seria outra grandeza",
    };
  }

  const bid = melhorNivel(bruto.livro, 0);
  const ask = melhorNivel(bruto.livro, 1);
  if (bid === undefined && ask === undefined) {
    return {
      ok: false,
      motivo: "livro_nao_lido",
      porque: "nem o melhor bid nem o melhor ask do livro se leram: sem um preco publicado nao ha mercado a entregar",
    };
  }

  // A POSICAO (RN-T16.1): le-se do VENUE. Quando ela existe e a marca de posse nao esta no livro da conta, a
  // posicao vai SEM marca — e quem a le (a mesa) trata uma posicao sem marca como ALHEIA: relata e nao gere.
  // Inventar uma marca aqui seria dizer que a posicao e' nossa sem o venue o dizer.
  const posicao: PosicaoDaLeitura | undefined = leituraDaConta.posicoes.find(
    (p) => p.instrumento === pedido.instrumento,
  );

  // AS ORDENS VIVAS (contrato 1.9.0): lidas do que o venue respondeu, ANTES de montar a carga — e uma resposta
  // que nao sirva RECUSA a leitura inteira, em vez de sair um mercado sem elas.
const lidas = lerOrdensVivas(bruto.ordens, pedido.instrumento);
  if (!lidas.ok) {
    return { ok: false, motivo: "ordens_nao_lidas", porque: lidas.porque };
  }
  const ordensAbertas = lidas.ordens;

  const carga: Record<string, unknown> = {
    instrumento: pedido.instrumento,
    tempo_do_venue_ms: tempo,
    idade_do_dado_ms: Math.max(0, pedido.agora_ms - tempo),
    estado: estado.estado,
    equity: carteira.equity,
  };
  if (bid !== undefined) carga.bid = bid;
  if (ask !== undefined) carga.ask = ask;

  const { ultimo, quantas } = ultimoDaVela(bruto.velas);
  const ausentes: string[] = [];
  if (ultimo !== undefined) carga.ultimo = ultimo;
  else ausentes.push("mercado.ultimo (o venue nao publicou a vela mais recente)");
  if (bid === undefined) ausentes.push("mercado.bid (o lado das compras do livro veio vazio)");
  if (ask === undefined) ausentes.push("mercado.ask (o lado das vendas do livro veio vazio)");

  // A MARCA DE POSSE DA POSICAO (RN-T16.1, D-008): a posicao vem do venue SEM marca — a marca viaja no `cloid`
  // das ordens. Aqui cruza-se o que o venue publica (as execucoes da conta) com o MAPA das marcas que nos
  // enviamos: se o preenchimento mais recente deste instrumento trouxer um `cloid` que esta' no mapa, a posicao
  // e' NOSSA e leva a marca que a mesa compoe (o inteiro — o mapa converte-a numa so' direccao).
  //
  // Sem mapa, ou sem cloid conhecido, a posicao vai SEM marca — e uma posicao sem marca e' tratada pela mesa
  // como ALHEIA (relata e nao gere). Nao se inventa dono: e' a mesma disciplina da RN-D4.
  const mapa = mapaDeMarcas();
  const cloidDoVenue = posicao !== undefined ? preenchimentoMaisRecente(bruto.execucoes, pedido.instrumento) : undefined;
  const marcaDaPosicao =
    cloidDoVenue !== undefined
      ? mapa.find((m) => m.cloid.toLowerCase() === cloidDoVenue.toLowerCase())?.marca
      : undefined;

  // AS ORDENS VIVAS DA CONTA, neste instrumento (contrato 1.9.0): OBRIGATORIAS e SEMPRE — a conta pode estar
  // plana e ter ordens vivas (ou nenhuma), e a lista vazia diz "perguntei e nao ha' nenhuma". Estavam dentro do
  // `if (posicao !== undefined)` e a conta de teste, por estar PLANA, fazia sair um mercado sem elas: medido na
  // primeira corrida ao vivo depois da emenda, e recusado pelo contrato — que e' o que tinha de acontecer.
  carga.ordens_abertas = ordensAbertas;

  if (posicao !== undefined) {
    // A marca de posse NAO vem na leitura da conta: o venue guarda-a no `cloid` da ordem, e o mapa
    // marca -> ficha (RN-T16.1) e' item por fazer. Sem ela, a posicao vai declarada e sem dono — e isso e'
    // a informacao que a mesa precisa para NAO a gerir.
    carga.posicao = {
      lado: posicao.lado,
      unidades: posicao.unidades,
      preco_medio: posicao.preco_medio,
      // A MARCA, quando o venue mostrou um preenchimento com um `cloid` NOSSO (o mapa, RN-T16.1). Ausente, a
      // posicao vai sem dono — e a mesa trata-a como alheia, que e' o que se quer quando nao se sabe.
      ...(typeof marcaDaPosicao === "number" ? { marca_de_posse: marcaDaPosicao } : {}),
    };
    if (typeof marcaDaPosicao !== "number") {
      ausentes.push(
        "mercado.posicao.marca_de_posse (o venue nao mostrou nenhum preenchimento deste instrumento com um `cloid` nosso: a posse nao se atribui)",
      );
    }
  }

  const origens: Record<string, string> = {
    "mercado.instrumento": "pedido do vigia (a leitura e' por instrumento)",
    "mercado.tempo_do_venue_ms": "clearinghouseState.time (o relogio DO VENUE — RN-D2)",
    "mercado.idade_do_dado_ms": `medida: agora (${pedido.agora_ms}) - tempo_do_venue (${tempo})`,
    "mercado.estado": `${estado.porque} — ` + "`specialStatuses: null` significa nenhum estado especial em vigor",
    "mercado.equity": "clearinghouseState.marginSummary.accountValue (com nao realizado — RN-M3)",
    "mercado.ordens_abertas": `openOrders[].(oid/side/limitPx/sz) — as ordens VIVAS de ${pedido.instrumento} (vazio = perguntei e nao ha' nenhuma)`,
    ...(bid !== undefined ? { "mercado.bid": "l2Book.levels[0][0].px" } : {}),
    ...(ask !== undefined ? { "mercado.ask": "l2Book.levels[1][0].px" } : {}),
    ...(ultimo !== undefined ? { "mercado.ultimo": `candleSnapshot().c da vela mais recente (${quantas} vela(s) lidas)` } : {}),
    ...(posicao !== undefined
      ? { "mercado.posicao": "clearinghouseState.assetPositions[].position (coin/szi/entryPx)" }
      : {}),
  };

  // O CONTRATO confere o `mercado` ANTES de ele servir de alguma coisa: um objecto que o contrato recusaria
  // nao chega a ser uma leitura (D4/D5).
  const mensagem = JSON.stringify({
    contrato: versaoVigente(),
    tipo: "mercado",
    id: `mercado/${pedido.instrumento}`,
    carga,
  });
  const decisao = validar(mensagem);
  if (decisao.veredicto !== "aceite") {
    return {
      ok: false,
      motivo: `mercado_recusado_pelo_contrato:${decisao.motivo ?? "?"}`,
      porque: `o mercado montado no venue nao passou o contrato (${decisao.veredicto}): ${JSON.stringify(carga)}`,
    };
  }

  if (!DECIMAL.test(carteira.equity)) {
    return {
      ok: false,
      motivo: "equity_ilegivel",
      porque: `o equity lido (${carteira.equity}) nao e' decimal da forma do contrato`,
    };
  }

  return { ok: true, mercado: { carga, origens, ausentes } };
}

/**
 * A leitura AO VIVO: faz as chamadas ao venue e entrega o resultado a `montarMercado`.
 *
 * As quatro leituras vao em paralelo, e cada uma falha SOZINHA: uma que cai nao apaga as outras — o que ela
 * faz e' tornar o `mercado` impossivel, com o nome dela e a razao. Uma leitura que falha nunca devolve o
 * valor anterior (FR-017).
 */
export async function lerMercadoNoVenue(
  porta: PortaDaLeituraDeMercado,
  pedido: PedidoDaLeituraDeMercado,
): Promise<ResultadoDaLeituraDeMercado> {
  const desde = pedido.desde_ms ?? pedido.agora_ms - 2 * 3600 * 1000;

  const tentar = async (nome: string, f: () => Promise<unknown>) => {
    try {
      return { ok: true as const, valor: await f() };
    } catch (e) {
      return { ok: false as const, falha: { leitura: nome, motivo: "resposta_do_venue", porque: e instanceof Error ? e.message : String(e) } };
    }
  };

  const [conta, livro, estado, velas, ordens, execucoes] = await Promise.all([
    tentar("conta", () => lerDoVenueDaConta(porta.conta, { conta: pedido.conta, instrumento: pedido.instrumento })),
    tentar("livro", () => porta.leitura.livro(pedido.instrumento)),
    tentar("estado", () => porta.leitura.estadoDaExchange()),
    tentar("velas", () => porta.leitura.velas(pedido.instrumento, desde)),
    // As ORDENS VIVAS sao OBRIGATORIAS (1.9.0): quem nao conseguiu perguntar nao produz leitura — uma lista
    // vazia inventada faria a mesa achar a conta limpa quando ela nao esta'.
    tentar("ordens", () => porta.conta.ordensDaConta(pedido.conta)),
    // AS EXECUCOES da conta: sem elas a posicao nao tem como ser atribuida a uma marca nossa.
    tentar("execucoes", () => porta.leitura.execucoes(pedido.conta)),
  ]);

  const falhas: { leitura: string; motivo: string; porque: string }[] = [];
  if (!conta.ok) falhas.push(conta.falha);
  if (!livro.ok) falhas.push(livro.falha);
  if (!estado.ok) falhas.push(estado.falha);
  if (!ordens.ok) falhas.push(ordens.falha);
  if (!execucoes.ok) falhas.push(execucoes.falha);
  // As VELAS nao entram nas obrigatorias: elas dao o `ultimo`, que e' um campo aditivo. O que o venue nao
  // publicou fica ausente e DITO — nao se recusa o mercado inteiro por causa de um campo que o contrato
  // declara opcional. As outras tres sao a conta, o livro e o estado, e sem qualquer uma delas nao ha leitura.
  const falhasDasObrigatorias = falhas.filter((f) => f.leitura !== "velas");
  if (falhasDasObrigatorias.length === 0) {
    return montarMercado(
      {
        conta: (conta as { valor: Parameters<typeof lerConta>[0] }).valor,
        livro: (livro as { valor: unknown }).valor,
        estado: (estado as { valor: unknown }).valor,
        velas: velas.ok ? velas.valor : [],
        ordens: (ordens as { valor: unknown }).valor,
        execucoes: (execucoes as { valor: unknown }).valor,
      },
      pedido,
    );
  }
  // As ordens tambem vao por preencher, e de proposito: com `falhas` obrigatorias, `montarMercado` RECUSA antes
  // de olhar para qualquer um destes valores — nao ha' caminho em que um vazio chegue a mesa como leitura.
  return montarMercado({ conta: {}, livro: undefined, estado: undefined, velas: [], ordens: undefined, execucoes: undefined }, pedido, falhasDasObrigatorias);
}

// ---------------------------------------------------------------------------------------------------------
// O CLI — a bancada e o estudo (a mesma leitura, de fora).

async function principal(): Promise<void> {
  const argv = process.argv.slice(2);
  const argumento = (nome: string): string | undefined => {
    const i = argv.indexOf(nome);
    return i < 0 ? undefined : argv[i + 1];
  };
  const instrumento = argumento("--instrumento");
  const conta = argumento("--conta") ?? process.env.MESACORE_CONTA ?? "";
  const ambiente = (argumento("--ambiente") ?? "teste") as "teste" | "producao";
  if (instrumento === undefined || conta === "") {
    console.error(
      "uso: bun run brokers/hyperliquid/leitura-do-mercado.ts --instrumento BTC --conta 0x... [--ambiente teste|producao] [--agora <ms>] [--json]",
    );
    process.exit(2);
  }
  const modulo = await import("@nktkas/hyperliquid");
  const transporte = new modulo.HttpTransport({ isTestnet: ambiente !== "producao" });
  const info = new modulo.InfoClient({ transport: transporte });
  const porta = portaDoCliente(info as unknown as ClienteDaLeituraDeMercado);
  const agora = Number(argumento("--agora") ?? String(Date.now()));
  const r = await lerMercadoNoVenue(porta, { conta, instrumento, agora_ms: agora });
  if (!r.ok) {
    console.log(JSON.stringify({ veredicto: "recusado", motivo: r.motivo, porque: r.porque }, null, 1));
    process.exit(1);
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ veredicto: "lido", ...r.mercado }, null, 1));
    return;
  }
  console.log(JSON.stringify(r.mercado.carga));
}

if (import.meta.main) await principal();
