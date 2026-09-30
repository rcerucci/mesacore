// AS LEITURAS DA CONTA — as DUAS carteiras do venue, as posicoes e os cinco numeros do resumo (FR-016 a FR-018).
//
// O QUE ESTE FICHEIRO E: o lado que LE do venue o que a mesa pergunta — conta, posicoes e saldo — e o
// devolve como DADO, com a ORIGEM de cada numero nomeada (RN-C11). Nao decide nada (RN-C5) e nao importa o
// `core` (RN-E1): le, confere a forma e diz de onde veio cada valor.
//
// T071 — O VENUE TEM DUAS CARTEIRAS, E ELAS NAO SE CONFUNDEM.
// Medido no venue de teste (29 set): a mesma conta respondeu `clearinghouseState` (perpetuo) e
// `spotClearinghouseState` (spot) com o dinheiro em UMA delas de cada vez, e as duas leituras se
// contradizem quando se le so uma. Quem so le o perpetuo conclui «conta sem fundos» com o dinheiro no spot;
// quem so le o spot conclui o mesmo com o dinheiro no perpetuo. Aqui:
//   * cada valor leva a CARTEIRA de onde veio, no nome (`carteiras.perpetuo` / `carteiras.spot`);
//   * o conector NAO SOMA as duas carteiras — uma soma e uma conta NOSSA, e uma conta nossa a decidir
//     margem e o defeito que se quer evitar; a mesa ve as duas e decide o que faz com elas;
//   * a leitura CONTA quantas carteiras o venue confirmou para esta conta (medido, nao assumido): e a
//     declaracao de que este venue tem duas.
//
// UMA LEITURA FALHADA E DITA COMO FALHA. Nao vira zero, nao vira o valor anterior e nao vira «sem
// posicao»: a carteira fica `nao_lida`, com o motivo nomeado. Sem leitura do PERPETUO nao se sabe o que
// ha empenhado, e quem julga a margem tem de saber disso (FR-017, FR-021).
//
// SEM POSICAO A DISTANCIA DE LIQUIDACAO E AUSENTE — nunca zero, que pareceria um numero medido (FR-017).
// A distancia e a UNICA conta deste ficheiro ([C]), e vai nomeada como nossa: |marca - liquidationPx| /
// marca, com a marca do venue identificada ([V]).

import type { Resposta } from "./sonda.ts";

// ---------------------------------------------------------------------------------------------------------
// A porta: as leituras da conta entram como PARAMETRO (o nucleo fica puro e testavel sem rede).
// ---------------------------------------------------------------------------------------------------------

export type PedidoDeLeitura = {
  /**
   * O endereco da CONTA PRINCIPAL (master). A armadilha da documentacao: consultar com o endereco do
   * AGENTE devolve vazio, e um vazio lido como «sem posicao» e um engano caro.
   */
  conta: string;
  /** O instrumento de referencia, para a marca que serve de regua a distancia de liquidacao. */
  instrumento?: string;
};

export type RespostasDaConta = {
  perpetuo?: Resposta;
  spot?: Resposta;
  activo?: Resposta;
  agentes?: Resposta;
};

export type PortaDeConta = {
  contaPerpetuo(conta: string): Promise<unknown>;
  contaSpot(conta: string): Promise<unknown>;
  activoDaConta(conta: string, coin: string): Promise<unknown>;
  agentesDaConta(conta: string): Promise<unknown>;
  /** AS ORDENS VIVAS da conta (contrato 1.9.0): o que esta' pendurado, e a marca de posse de cada uma. */
  ordensDaConta(conta: string): Promise<unknown>;
};

/** O cliente do venue, na forma ESTRUTURAL que esta porta consome (o SDK oficial encaixa aqui). */
export type ClienteDeConta = {
  clearinghouseState(p: { user: string }): Promise<unknown>;
  spotClearinghouseState(p: { user: string }): Promise<unknown>;
  activeAssetData(p: { user: string; coin: string }): Promise<unknown>;
  extraAgents(p: { user: string }): Promise<unknown>;
  openOrders(p: { user: string }): Promise<unknown>;
};

export function portaDoCliente(cliente: ClienteDeConta): PortaDeConta {
  return {
    contaPerpetuo: (conta) => cliente.clearinghouseState({ user: conta }),
    contaSpot: (conta) => cliente.spotClearinghouseState({ user: conta }),
    activoDaConta: (conta, coin) => cliente.activeAssetData({ user: conta, coin }),
    agentesDaConta: (conta) => cliente.extraAgents({ user: conta }),
    ordensDaConta: (conta) => cliente.openOrders({ user: conta }),
  };
}

export async function lerDoVenueDaConta(porta: PortaDeConta, pedido: PedidoDeLeitura): Promise<RespostasDaConta> {
  async function tentar(f: () => Promise<unknown>): Promise<Resposta> {
    try {
      return { ok: true, valor: await f() };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }
  const respostas: RespostasDaConta = {
    perpetuo: await tentar(() => porta.contaPerpetuo(pedido.conta)),
    spot: await tentar(() => porta.contaSpot(pedido.conta)),
    agentes: await tentar(() => porta.agentesDaConta(pedido.conta)),
  };
  if (pedido.instrumento !== undefined) {
    respostas.activo = await tentar(() => porta.activoDaConta(pedido.conta, pedido.instrumento as string));
  }
  return respostas;
}

// ---------------------------------------------------------------------------------------------------------
// As formas do contrato.
// ---------------------------------------------------------------------------------------------------------

// Os TRES padroes do contrato (`contracts/_defs/forma.schema.json`): `decimal` (COM sinal), o
// `decimal_nao_negativo` e o `decimal_positivo`. A leitura usa-os como o contrato os declara — e nao um so
// para todos, que foi o defeito: com o padrao SEM sinal em `szi`, uma posicao VENDIDA (szi negativo, a
// forma com que o venue diz `sell`) nao se lia, a leitura recusava a CONTA INTEIRA e o ramo `lado: "sell"`
// ficava codigo morto.
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const DECIMAL_NAO_NEGATIVO = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const DECIMAL_POSITIVO = /^(0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$/;

export type CarteiraLida = { estado: "lida" } & Record<string, unknown>;
export type CarteiraNaoLida = { estado: "nao_lida"; contrato: string; motivo: string; porque: string };

export type CarteiraDoPerpetuo =
  | {
      estado: "lida";
      contrato: "perpetuo";
      origem: string;
      /** Saldo com nao realizado — e sobre ESTE numero que o travão de perda mede, e so o do perpetuo. */
      equity: string;
      /** Nocional total em aberto, como o venue o reporta. */
      nocional_total: string;
      margem_usada: string;
      retiravel: string;
    }
  | CarteiraNaoLida;

export type CarteiraDoSpot =
  | {
      estado: "lida";
      contrato: "spot";
      origem: string;
      /** Um por moeda. O venue nao publica um total: somar moedas seria uma conta NOSSA. */
      saldos: { moeda: string; total: string; retido: string; valor_de_entrada: string }[];
    }
  | CarteiraNaoLida;

export type PosicaoDaLeitura = {
  instrumento: string;
  lado: "buy" | "sell";
  unidades: string;
  preco_medio: string;
  nocional: string;
  margem: string;
  resultado_nao_realizado: string;
  alavancagem: { tipo: string; valor: number };
  /** Ausente quando o venue nao o publica (posicao sem liquidacao publicada). Nunca `null`, nunca zero. */
  preco_de_liquidacao?: string;
  /**
   * A UNICA conta deste ficheiro [C], a partir de dois numeros do venue [V]: |marca - liquidationPx| / marca,
   * em percentagem da marca. Ausente quando nao ha posicao ou quando o venue nao publica a liquidacao.
   */
  distancia_de_liquidacao?: { em: "porcento_da_marca"; valor: string; marca: string };
  /** Quando a distancia esta ausente, DIZ-SE porque — ausencia sem razao parece esquecimento. */
  porque_sem_distancia?: string;
};

export type Leitura = {
  conta: string;
  /** O instante DO VENUE que vem na resposta da conta perpetua (RN-D2) — nao o nosso relogio. */
  instante_do_venue_ms?: number;
  carteiras: {
    perpetuo: CarteiraDoPerpetuo;
    spot: CarteiraDoSpot;
    /** Quantas carteiras o VENUE confirmou para esta conta (medido: respondeu por cada uma). */
    confirmadas_pelo_venue: number;
    nomes: string[];
    nota: string;
    /** As carteiras que NAO se leram, pelo nome: quem julga margem tem de ver isto (FR-021). */
    nao_lidas: string[];
  };
  posicoes: PosicaoDaLeitura[];
  identidade: {
    origem: string;
    /** Quem o venue diz que assina por esta conta. Nenhuma chave entra aqui (RN-C20, RN-E14). */
    agentes: { endereco: string; nome?: string; valido_ate_ms?: number }[];
    nota: string;
  };
  /** A ORIGEM de cada numero, nomeada (RN-C11) — a chamada e o caminho de onde ele veio. */
  origens: Record<string, string>;
};

export type ResultadoDeLeitura = { ok: true; leitura: Leitura } | { ok: false; motivo: string; porque: string };

// ---------------------------------------------------------------------------------------------------------
// Aritmetica em DECIMAL TEXTUAL com BigInt (dinheiro nao e float).
// ---------------------------------------------------------------------------------------------------------

function decimais(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function escalado(s: string): bigint {
  const i = s.indexOf(".");
  return i < 0 ? BigInt(s) : BigInt(s.slice(0, i) + s.slice(i + 1));
}

function formatar(valor: bigint, escala: number): string {
  if (escala === 0) return valor.toString();
  const dig = valor.toString().padStart(escala + 1, "0");
  const inteiro = dig.slice(0, dig.length - escala);
  const fracao = dig.slice(dig.length - escala).replace(/0+$/, "");
  return fracao === "" ? inteiro : `${inteiro}.${fracao}`;
}

/**
 * |marca - liquidacao| / marca, em percentagem, arredondada PARA BAIXO na quarta casa (o lado seguro:
 * subestimar a distancia que se tem e o unico lado que nao promete defesa que nao existe). Devolve
 * `undefined` — nunca zero — quando a conta nao se pode fazer.
 */
function distanciaPercentual(marca: string, liquidacao: string): string | undefined {
  if (!DECIMAL_POSITIVO.test(marca) || !DECIMAL_POSITIVO.test(liquidacao)) return undefined;
  const dm = decimais(marca);
  const dl = decimais(liquidacao);
  const escala = Math.max(dm, dl);
  const a = escalado(marca) * 10n ** BigInt(escala - dm);
  const b = escalado(liquidacao) * 10n ** BigInt(escala - dl);
  const diferenca = a > b ? a - b : b - a;
  // percentagem com 4 casas: (diferenca / 10^escala) / (marca / 10^dm) * 100 * 10^4
  const numerador = diferenca * 10n ** BigInt(dm) * 100n * 10_000n;
  const denominador = 10n ** BigInt(escala) * escalado(marca);
  return formatar(numerador / denominador, 4);
}

// ---------------------------------------------------------------------------------------------------------
// Leitura dos dados, sem coerir nada.
// ---------------------------------------------------------------------------------------------------------

function veio(r: Resposta | undefined): unknown | undefined {
  return r !== undefined && r.ok === true ? r.valor : undefined;
}

function razaoDaFalha(r: Resposta | undefined, nome: string): string {
  if (r === undefined) return `a leitura ${nome} nao foi feita`;
  if (r.ok !== true) return `a leitura ${nome} falhou: ${r.erro}`;
  return `a leitura ${nome} respondeu, mas sem os campos exigidos`;
}

function objecto(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function lista(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function numero(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Um decimal textual do contrato, ou a razao de nao o ser (nunca um numero aproximado).
 *
 * O PADRAO escolhe-se por campo, como o contrato o declara: o de omissao e o `decimal_nao_negativo`, e os
 * campos que o venue publica COM sinal (`szi`, `unrealizedPnl`) passam o `decimal`. Um padrao unico para
 * todos foi o defeito que fez a leitura recusar uma posicao vendida.
 */
function decimal(
  onde: string,
  v: unknown,
  padrao: RegExp = DECIMAL_NAO_NEGATIVO,
): { ok: true; valor: string } | { ok: false; motivo: string; porque: string } {
  if (v === undefined) return { ok: false, motivo: "campo_obrigatorio_ausente", porque: `o venue nao declarou ${onde}` };
  if (v === null) return { ok: false, motivo: "valor_nulo_nao_permitido", porque: `${onde} veio a null` };
  if (typeof v !== "string") return { ok: false, motivo: "tipo_invalido", porque: `${onde} veio em ${typeof v}, e o contrato exige decimal textual` };
  if (!padrao.test(v)) return { ok: false, motivo: "formato_invalido", porque: `${onde} veio ${JSON.stringify(v)}, que nao e decimal textual do contrato (sem expoente, sem '+')` };
  return { ok: true, valor: v };
}

// ---------------------------------------------------------------------------------------------------------
// AS CARTEIRAS.
// ---------------------------------------------------------------------------------------------------------

const ORIGEM_DO_PERPETUO = "info.clearinghouseState({user}).marginSummary";
const ORIGEM_DO_SPOT = "info.spotClearinghouseState({user}).balances[]";

export const NOTA_DAS_CARTEIRAS =
  "este venue tem DUAS carteiras e o conector NAO as soma: cada valor leva a carteira de onde veio (T071). " +
  "O equity e os numeros de margem sao do PERPETUO; os saldos sao do SPOT. Quem so le o perpetuo conclui " +
  "«conta sem fundos» com o dinheiro no spot, e quem so le o spot conclui o mesmo com o dinheiro no perpetuo " +
  "— por isso as duas sao lidas, e as duas sao ditas.";

function lerCarteiraDoPerpetuo(resposta: Resposta | undefined): CarteiraDoPerpetuo {
  const raiz = objecto(veio(resposta));
  const resumo = raiz !== undefined ? objecto(raiz.marginSummary) : undefined;
  if (resumo === undefined) {
    return { estado: "nao_lida", contrato: "perpetuo", motivo: "campo_obrigatorio_ausente", porque: razaoDaFalha(resposta, "clearinghouseState") };
  }
  const equity = decimal("clearinghouseState.marginSummary.accountValue", resumo.accountValue);
  if (!equity.ok) return { estado: "nao_lida", contrato: "perpetuo", motivo: equity.motivo, porque: equity.porque };
  const nocional = decimal("clearinghouseState.marginSummary.totalNtlPos", resumo.totalNtlPos);
  if (!nocional.ok) return { estado: "nao_lida", contrato: "perpetuo", motivo: nocional.motivo, porque: nocional.porque };
  const margem = decimal("clearinghouseState.marginSummary.totalMarginUsed", resumo.totalMarginUsed);
  if (!margem.ok) return { estado: "nao_lida", contrato: "perpetuo", motivo: margem.motivo, porque: margem.porque };
  const retiravel = decimal("clearinghouseState.withdrawable", raiz?.withdrawable);
  if (!retiravel.ok) return { estado: "nao_lida", contrato: "perpetuo", motivo: retiravel.motivo, porque: retiravel.porque };

  return {
    estado: "lida",
    contrato: "perpetuo",
    origem: ORIGEM_DO_PERPETUO,
    equity: equity.valor,
    nocional_total: nocional.valor,
    margem_usada: margem.valor,
    retiravel: retiravel.valor,
  };
}

function lerCarteiraDoSpot(resposta: Resposta | undefined): CarteiraDoSpot {
  const raiz = objecto(veio(resposta));
  const saldos = raiz !== undefined ? lista(raiz.balances) : undefined;
  if (saldos === undefined) {
    return { estado: "nao_lida", contrato: "spot", motivo: "campo_obrigatorio_ausente", porque: razaoDaFalha(resposta, "spotClearinghouseState") };
  }
  const lidos: { moeda: string; total: string; retido: string; valor_de_entrada: string }[] = [];
  for (const item of saldos) {
    const o = objecto(item);
    const moeda = o !== undefined ? texto(o.coin) : undefined;
    if (moeda === undefined) continue;
    const total = decimal(`spotClearinghouseState.balances[${moeda}].total`, o?.total);
    if (!total.ok) return { estado: "nao_lida", contrato: "spot", motivo: total.motivo, porque: total.porque };
    const retido = decimal(`spotClearinghouseState.balances[${moeda}].hold`, o?.hold);
    if (!retido.ok) return { estado: "nao_lida", contrato: "spot", motivo: retido.motivo, porque: retido.porque };
    const entrada = decimal(`spotClearinghouseState.balances[${moeda}].entryNtl`, o?.entryNtl);
    if (!entrada.ok) return { estado: "nao_lida", contrato: "spot", motivo: entrada.motivo, porque: entrada.porque };
    lidos.push({ moeda, total: total.valor, retido: retido.valor, valor_de_entrada: entrada.valor });
  }
  return { estado: "lida", contrato: "spot", origem: ORIGEM_DO_SPOT, saldos: lidos };
}

// ---------------------------------------------------------------------------------------------------------
// AS POSICOES — com os cinco numeros do resumo e a distancia de liquidacao.
// ---------------------------------------------------------------------------------------------------------

function lerPosicoes(resposta: Resposta | undefined, marca: string | undefined): PosicaoDaLeitura[] | { erro: string } {
  const raiz = objecto(veio(resposta));
  if (raiz === undefined) return { erro: razaoDaFalha(resposta, "clearinghouseState") };
  const posicoes = lista(raiz.assetPositions);
  if (posicoes === undefined) return { erro: "a resposta da conta perpetua nao trouxe `assetPositions`" };

  const saida: PosicaoDaLeitura[] = [];
  for (const item of posicoes) {
    const p = objecto(objecto(item)?.position);
    if (p === undefined) continue;
    const instrumento = texto(p.coin);
    // `szi` vem do venue COM SIGNO, e o signo e o LADO: negativo = vendida. O padrao tem de o aceitar, ou o
    // ramo `sell` abaixo fica codigo morto e a leitura recusa a conta por uma posicao que esta la.
    const szi = decimal("posicao.szi", p.szi, DECIMAL);
    if (instrumento === undefined || !szi.ok) return { erro: "uma posicao do venue veio sem `coin`/`szi` legivel" };
    // `szi` igual a zero NAO e uma posicao: o venue usa o sinal para dizer o lado.
    const sziBruto = szi.valor;
    const negativo = sziBruto.startsWith("-");
    const unidades = negativo ? sziBruto.slice(1) : sziBruto;
    if (!DECIMAL_POSITIVO.test(unidades)) continue;

    const preco = decimal("posicao.entryPx", p.entryPx);
    const nocional = decimal("posicao.positionValue", p.positionValue);
    const margem = decimal("posicao.marginUsed", p.marginUsed);
    // `unrealizedPnl` tambem vem com signo: uma posicao a perder da um numero NEGATIVO, e recusa-lo seria
    // recusar a conta precisamente quando ela esta a perder.
    const pnl = decimal("posicao.unrealizedPnl", p.unrealizedPnl, DECIMAL);
    if (!preco.ok || !nocional.ok || !margem.ok || !pnl.ok) {
      return { erro: `a posicao ${instrumento} veio sem um dos numeros da cotacao (entryPx/positionValue/marginUsed/unrealizedPnl)` };
    }
    const alavancagem = objecto(p.leverage);
    const tipo = alavancagem !== undefined ? texto(alavancagem.type) : undefined;
    const valor = alavancagem !== undefined ? numero(alavancagem.value) : undefined;
    if (tipo === undefined || valor === undefined) return { erro: `a posicao ${instrumento} veio sem a alavancagem declarada` };

    const posicao: PosicaoDaLeitura = {
      instrumento,
      lado: negativo ? "sell" : "buy",
      unidades,
      preco_medio: preco.valor,
      nocional: nocional.valor,
      margem: margem.valor,
      resultado_nao_realizado: pnl.valor,
      alavancagem: { tipo, valor },
    };

    // liquidationPx: o venue PUBLICA-o (ou publica `null`). Nulo NAO vira zero: a distancia fica AUSENTE.
    const liquidacao = p.liquidationPx;
    if (liquidacao === undefined) {
      posicao.porque_sem_distancia = "o venue nao trouxe `liquidationPx` nesta posicao";
    } else if (liquidacao === null) {
      posicao.porque_sem_distancia =
        "o venue publica `liquidationPx` a null nesta posicao — a distancia fica AUSENTE, nunca zero, que pareceria um numero medido";
    } else if (typeof liquidacao !== "string" || !DECIMAL_POSITIVO.test(liquidacao)) {
      posicao.porque_sem_distancia = `o preco de liquidacao veio ${JSON.stringify(liquidacao)}, que nao e decimal positivo`;
    } else {
      posicao.preco_de_liquidacao = liquidacao;
      if (marca === undefined) {
        posicao.porque_sem_distancia = "sem marca do venue nao ha regua para medir a distancia (a conta nao se inventa)";
      } else {
        const distancia = distanciaPercentual(marca, liquidacao);
        if (distancia === undefined) {
          posicao.porque_sem_distancia = `a marca do venue (${marca}) nao serve de regua: nao e decimal positivo`;
        } else {
          posicao.distancia_de_liquidacao = { em: "porcento_da_marca", valor: distancia, marca };
        }
      }
    }
    saida.push(posicao);
  }
  return saida;
}

// ---------------------------------------------------------------------------------------------------------
// A LEITURA. PURA: recebe o que o venue respondeu e devolve a leitura — ou a falha, nomeada.
// ---------------------------------------------------------------------------------------------------------

export function lerConta(respostas: RespostasDaConta, pedido: PedidoDeLeitura): ResultadoDeLeitura {
  const perpetuo = lerCarteiraDoPerpetuo(respostas.perpetuo);
  const spot = lerCarteiraDoSpot(respostas.spot);

  // Sem NENHUMA das duas carteiras nao ha leitura da conta — e a leitura falhada DIZ-SE, nao se preenche.
  if (perpetuo.estado === "nao_lida" && spot.estado === "nao_lida") {
    return {
      ok: false,
      motivo: perpetuo.motivo,
      porque:
        `nenhuma das DUAS carteiras do venue respondeu: perpetuo (${perpetuo.porque}) e spot (${spot.porque}). ` +
        "Sem leitura da conta o conector nao manda ordem que aumente exposicao (FR-021)",
    };
  }

  const marcaDoVenue = (() => {
    const activo = objecto(veio(respostas.activo));
    const m = activo !== undefined ? texto(activo.markPx) : undefined;
    return m !== undefined && DECIMAL_POSITIVO.test(m) ? m : undefined;
  })();

  const posicoesLidas = lerPosicoes(respostas.perpetuo, marcaDoVenue);
  if (!Array.isArray(posicoesLidas)) {
    return {
      ok: false,
      motivo: "campo_obrigatorio_ausente",
      porque: `a leitura das posicoes falhou: ${posicoesLidas.erro} — e uma posicao que nao se leu nunca vira «sem posicao»`,
    };
  }

  const confirmadas: string[] = [];
  if (perpetuo.estado === "lida") confirmadas.push("perpetuo");
  if (spot.estado === "lida") confirmadas.push("spot");

  // O instante e o DO VENUE, e vem na propria resposta da conta perpetua (RN-D2) — nunca o nosso relogio.
  const raizDoPerpetuo = objecto(veio(respostas.perpetuo));
  const instante = raizDoPerpetuo !== undefined ? numero(raizDoPerpetuo.time) : undefined;

  const agentes: { endereco: string; nome?: string; valido_ate_ms?: number }[] = [];
  const listaDeAgentes = lista(veio(respostas.agentes));
  if (listaDeAgentes !== undefined) {
    for (const a of listaDeAgentes) {
      const o = objecto(a);
      const endereco = o !== undefined ? texto(o.address) : undefined;
      if (endereco === undefined) continue;
      const nome = o !== undefined ? texto(o.name) : undefined;
      const valido = o !== undefined ? numero(o.validUntil) : undefined;
      agentes.push({ endereco, ...(nome !== undefined ? { nome } : {}), ...(valido !== undefined ? { valido_ate_ms: valido } : {}) });
    }
  }

  return {
    ok: true,
    leitura: {
      conta: pedido.conta,
      ...(instante !== undefined ? { instante_do_venue_ms: instante } : {}),
      carteiras: {
        perpetuo,
        spot,
        confirmadas_pelo_venue: confirmadas.length,
        nomes: confirmadas,
        nota: NOTA_DAS_CARTEIRAS,
        nao_lidas: [
          ...(perpetuo.estado === "nao_lida" ? ["perpetuo"] : []),
          ...(spot.estado === "nao_lida" ? ["spot"] : []),
        ],
      },
      posicoes: posicoesLidas,
      identidade: {
        origem: "info.extraAgents({user})",
        agentes,
        nota:
          "quem o venue diz que ASSINA por esta conta (agente, com validade). A chave NAO entra aqui (RN-C20, " +
          "RN-E14): esta leitura traz enderecos, nunca segredos. Consultar a conta com o endereco do AGENTE devolve " +
          "vazio — por isso `conta` e o endereco principal",
      },
      origens: {
        equity_do_perpetuo: `${ORIGEM_DO_PERPETUO}.accountValue — [V] do venue, so do perpetuo`,
        nocional_total_do_perpetuo: `${ORIGEM_DO_PERPETUO}.totalNtlPos — [V]`,
        margem_usada_do_perpetuo: `${ORIGEM_DO_PERPETUO}.totalMarginUsed — [V]`,
        retiravel_do_perpetuo: "info.clearinghouseState({user}).withdrawable — [V]",
        saldo_do_spot: "info.spotClearinghouseState({user}).balances[].total — [V], por moeda e SO do spot",
        unidades_da_posicao: "info.clearinghouseState({user}).assetPositions[].position.szi — [V], o sinal e o lado",
        preco_medio: "info.clearinghouseState({user}).assetPositions[].position.entryPx — [V]",
        nocional_da_posicao: "info.clearinghouseState({user}).assetPositions[].position.positionValue — [V]",
        margem_da_posicao: "info.clearinghouseState({user}).assetPositions[].position.marginUsed — [V]",
        resultado_nao_realizado: "info.clearinghouseState({user}).assetPositions[].position.unrealizedPnl — [V], nunca recalculado",
        preco_de_liquidacao: "info.clearinghouseState({user}).assetPositions[].position.liquidationPx — [V], nunca recalculado",
        marca_para_a_distancia: "info.activeAssetData({user,coin}).markPx — [V]",
        distancia_de_liquidacao:
          "[C] NOSSA: |marca - liquidationPx| / marca, em percentagem da marca. Ausente sem posicao (FR-017)",
        alavancagem_da_posicao: "info.clearinghouseState({user}).assetPositions[].position.leverage — [V]",
        agentes_da_conta: "info.extraAgents({user}) — [V]; enderecos, nunca chaves",
        instante_do_venue: "info.clearinghouseState({user}).time — [V]; o relogio da conta, nao o nosso",
      },
    },
  };
}

/** A leitura completa: vai buscar os dados a porta e aplica `lerConta`. */
export async function lerNoVenue(porta: PortaDeConta, pedido: PedidoDeLeitura): Promise<ResultadoDeLeitura> {
  return lerConta(await lerDoVenueDaConta(porta, pedido), pedido);
}
