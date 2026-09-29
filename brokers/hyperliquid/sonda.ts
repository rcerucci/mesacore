// A SONDA DO VENUE REAL (FR-001 a FR-005) — Hyperliquid, ambiente de teste.
//
// O QUE ESTE FICHEIRO E: o lado que FALA com o venue. Faz as LEITURAS PUBLICAS (nao assina nada, nao envia
// ordem nenhuma) e transforma-as em DADO. Quem DECIDE continua a ser o `manifesto.ts` (funcao pura), que
// recebe o resultado daqui. Por isso ha uma PORTA: as chamadas entram como PARAMETRO, o nucleo e puro, e os
// casos da sonda correm sem rede. A mesma sonda corre contra o venue de teste quando ele esta la.
//
// A REGRA DA SONDA, declarada — e o que separa `medido` de `inventado`:
//
//   * um campo e MEDIDO quando uma LEITURA PUBLICA do venue o devolve — ou quando sai dela por um
//     MAPEAMENTO DECLARADO aqui em baixo (nome do venue -> nome do contrato), mecanico e sem juizo;
//   * o que NAO tiver leitura publica fica DESCONHECIDO: dito PELO NOME, com a razao, e o manifesto RECUSA
//     nomeando-o. Nao se preenche com um numero da documentacao (RN-C1: um numero do venue escrito no nosso
//     codigo e um numero que ninguem volta a conferir) nem com um default simpatico;
//   * quem mede o resto e a BATERIA DE CONFORMIDADE (RN-C6), que exige ENVIAR, e que ainda nao corre.
//
// NENHUM VALOR DO VENUE VIVE AQUI. O que este ficheiro tem escrito e a FORMA das respostas (nomes de campos),
// a TABELA de mapeamento e o NOME da leitura que mediu cada campo — nunca um numero do venue, nem o minimo
// por ordem, nem a alavancagem maxima, nem o passo.
//
// NAO IMPORTA O `core` (RN-E1) e NAO DECIDE NADA (RN-C5, RN-C15): le, mapeia e declara.

import { construirManifesto, type Sonda, type Resultado } from "./manifesto.ts";

// ---------------------------------------------------------------------------------------------------------
// A forma de uma resposta do venue: ou veio, ou nao veio — e o que nao veio TEM razao.
// (Uma leitura falhada nunca vira um valor: vira um campo DESCONHECIDO, com o nome da leitura e o erro.)
// ---------------------------------------------------------------------------------------------------------

export type Resposta = { ok: true; valor: unknown } | { ok: false; erro: string };

export type RespostasDoVenue = {
  meta?: Resposta;
  meta_e_ctxs?: Resposta;
  fundings_previstos?: Resposta;
  livro?: Resposta;
  velas?: Resposta;
  estado_da_exchange?: Resposta;
  activo_da_conta?: Resposta;
  ordens_historicas?: Resposta;
  execucoes?: Resposta;
};

/** O QUE SE PEDE A SONDA. Nada aqui e um facto do venue: e a identidade do conector e a lista do mandato. */
export type PedidoDaSonda = {
  venue: string;
  ambiente: "teste" | "producao";
  versao_do_conector: string;
  /** Os instrumentos que o mandato nomeia — o manifesto confere-os contra o universo do venue. */
  instrumentos_pedidos: string[];
  /** Qual instrumento serve de medida ao livro e as velas (por omissao, o primeiro pedido). */
  instrumento_de_referencia?: string;
  /** O instante que datam as janelas pedidas ao venue (velas). Do CHAMADOR, e declarado como tal. */
  instante_de_referencia_ms: number;
};

export type EstadoDoCampo = "medido" | "desconhecido";

/** O registo de UM campo da sonda: o que se mediu, ONDE, ou porque nao se mediu e quem o mede. */
export type CampoDaSonda = {
  campo: string;
  estado: EstadoDoCampo;
  valor?: unknown;
  fonte?: string;
  porque: string;
};

export type SondaMedida = {
  sonda: Sonda;
  campos: CampoDaSonda[];
  /** Os campos que o venue NAO publica — os nomes que o manifesto vai recusar. */
  nao_medidos: string[];
};

export type SondaEConsolidacao = SondaMedida & { manifesto: Resultado };

// ---------------------------------------------------------------------------------------------------------
// A porta: as leituras publicas do venue entram como PARAMETRO (o nucleo fica puro e testavel sem rede).
// ---------------------------------------------------------------------------------------------------------

export type PortaDeLeitura = {
  meta(): Promise<unknown>;
  metaEContextos(): Promise<unknown>;
  /** A cadencia do funding por instrumento (`predictedFundings`). Leitura publica. */
  fundingsPrevistos(): Promise<unknown>;
  livro(coin: string): Promise<unknown>;
  velas(coin: string, inicioMs: number): Promise<unknown>;
  estadoDaExchange(): Promise<unknown>;
  activoDaConta(conta: string, coin: string): Promise<unknown>;
  ordensHistoricas(conta: string): Promise<unknown>;
  execucoes(conta: string): Promise<unknown>;
};

/** O cliente do venue, na forma ESTRUTURAL que esta porta consome (o SDK oficial encaixa aqui sem o importar). */
export type ClienteDeLeitura = {
  meta(): Promise<unknown>;
  metaAndAssetCtxs(): Promise<unknown>;
  predictedFundings(): Promise<unknown>;
  l2Book(p: { coin: string }): Promise<unknown>;
  candleSnapshot(p: { coin: string; interval: string; startTime: number }): Promise<unknown>;
  exchangeStatus(): Promise<unknown>;
  activeAssetData(p: { user: string; coin: string }): Promise<unknown>;
  historicalOrders(p: { user: string }): Promise<unknown>;
  userFills(p: { user: string }): Promise<unknown>;
};

export function portaDoCliente(cliente: ClienteDeLeitura): PortaDeLeitura {
  return {
    meta: () => cliente.meta(),
    metaEContextos: () => cliente.metaAndAssetCtxs(),
    fundingsPrevistos: () => cliente.predictedFundings(),
    livro: (coin) => cliente.l2Book({ coin }),
    velas: (coin, inicioMs) => cliente.candleSnapshot({ coin, interval: "1h", startTime: inicioMs }),
    estadoDaExchange: () => cliente.exchangeStatus(),
    activoDaConta: (conta, coin) => cliente.activeAssetData({ user: conta, coin }),
    ordensHistoricas: (conta) => cliente.historicalOrders({ user: conta }),
    execucoes: (conta) => cliente.userFills({ user: conta }),
  };
}

/** Faz as leituras da porta, uma a uma: a que falhar fica com a RAZAO, e nunca com um valor. */
export async function lerDoVenue(porta: PortaDeLeitura, pedido: PedidoDaSonda, conta: string): Promise<RespostasDoVenue> {
  const alvo = pedido.instrumento_de_referencia ?? pedido.instrumentos_pedidos[0];

  async function tentar(f: () => Promise<unknown>): Promise<Resposta> {
    try {
      return { ok: true, valor: await f() };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }

  const respostas: RespostasDoVenue = {
    meta: await tentar(() => porta.meta()),
    meta_e_ctxs: await tentar(() => porta.metaEContextos()),
    fundings_previstos: await tentar(() => porta.fundingsPrevistos()),
    estado_da_exchange: await tentar(() => porta.estadoDaExchange()),
    ordens_historicas: await tentar(() => porta.ordensHistoricas(conta)),
    execucoes: await tentar(() => porta.execucoes(conta)),
  };
  if (alvo !== undefined) {
    respostas.livro = await tentar(() => porta.livro(alvo));
    respostas.velas = await tentar(() => porta.velas(alvo, pedido.instante_de_referencia_ms - 25 * 3600 * 1000));
    respostas.activo_da_conta = await tentar(() => porta.activoDaConta(conta, alvo));
  }
  return respostas;
}

// ---------------------------------------------------------------------------------------------------------
// As formas do contrato que a sonda escreve, e o mapeamento DECLARADO venue -> contrato.
// ---------------------------------------------------------------------------------------------------------

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * A tabela DECLARADA que traduz o vocabulario de ordens do VENUE para o do CONTRATO
 * (contracts/vocabulario.json, `tipos_de_ordem`). So entram aqui os nomes que o venue REGISTOU nas ordens
 * desta conta: um valor que nao esteja nesta tabela NAO entra no conjunto declarado — nao se promete o que
 * nao se viu. As ordens de disparo (`isTrigger`) ficam de fora: o `orderType` delas nao e o tipo simples.
 */
const TIPO_DE_ORDEM_DO_VENUE: Record<string, string> = {
  Market: "mercado",
  Limit: "limite",
};

/** A ordem do contrato, para o conjunto declarado ser sempre escrito na mesma ordem (determinismo). */
const ORDEM_DOS_TIPOS = ["mercado", "limite", "stop", "stop_limite", "mercado_por_faixa"];

/** A forma da marca de posse, como o contrato a nomeia: o registo do venue chama-lhe `cloid`. */
const CAMPO_DA_MARCA_NO_VENUE = "cloid";

/** A modalidade DESTE venue na resposta de `predictedFundings` — as outras sao de outras corretoras. */
const MODALIDADE_DO_VENUE = "HlPerp";

// ---------------------------------------------------------------------------------------------------------
// Aritmetica em DECIMAL TEXTUAL com BigInt (dinheiro nao e float): so para COMPARAR o que o venue mandou.
// ---------------------------------------------------------------------------------------------------------

function decimais(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function escalado(s: string): bigint {
  const i = s.indexOf(".");
  return i < 0 ? BigInt(s) : BigInt(s.slice(0, i) + s.slice(i + 1));
}

/** Compara dois decimais textuais SEM virgula flutuante. -1, 0 ou 1. */
export function compararDecimais(a: string, b: string): number {
  const escala = Math.max(decimais(a), decimais(b));
  const x = escalado(a) * 10n ** BigInt(escala - decimais(a));
  const y = escalado(b) * 10n ** BigInt(escala - decimais(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Leitura dos dados: estreita o `unknown` da resposta sem coerir nada (fail-closed).
// ---------------------------------------------------------------------------------------------------------

function veio(r: Resposta | undefined): unknown | undefined {
  return r !== undefined && r.ok === true ? r.valor : undefined;
}

function razaoDaFalha(r: Resposta | undefined, nome: string): string | undefined {
  if (r === undefined) return `a leitura ${nome} nao foi feita`;
  if (r.ok !== true) return `a leitura ${nome} falhou: ${r.erro}`;
  return undefined;
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

function temChave(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Conta quantos objectos de uma lista trazem um campo com um valor dado (a EVIDENCIA, contada). */
function contar(lista: unknown[], campo: string, valorEsperado: unknown): number {
  let n = 0;
  for (const item of lista) {
    const o = objecto(item);
    if (o !== undefined && o[campo] === valorEsperado) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------
// A CONSTRUCAO DA SONDA. PURA: recebe o que o venue respondeu e devolve a sonda + o registo de cada campo.
// ---------------------------------------------------------------------------------------------------------

/** As chaves do venue que a sonda copia para `Sonda.meta.universe` — a forma crua, sem traduzir. */
type LinhaDoUniverso = NonNullable<Sonda["meta"]>["universe"][number];

export function construirSonda(respostas: RespostasDoVenue, pedido: PedidoDaSonda): SondaMedida {
  const campos: CampoDaSonda[] = [];
  const nao_medidos: string[] = [];

  function medido(campo: string, valor: unknown, fonte: string, porque: string): unknown {
    campos.push({ campo, estado: "medido", valor, fonte, porque });
    return valor;
  }

  function desconhecido(campo: string, porque: string): undefined {
    campos.push({ campo, estado: "desconhecido", porque });
    nao_medidos.push(campo);
    return undefined;
  }

  // ---- 0. as leituras POR INSTRUMENTO que o manifesto passou a declarar em cada unidade -----------
  //
  // A CADENCIA do funding e os ESCALOES de margem sao, no venue, POR INSTRUMENTO — e ate a 1.4.0 o
  // contrato nao tinha onde os declarar: o manifesto so tinha o booleano `funding`, e o escalao pedia um
  // limite SUPERIOR que o primeiro escalao do venue (`0.0`) nao conseguia exprimir. Agora declara-os, e
  // leem-se aqui para entrarem nas linhas do universo abaixo.
  const cadenciaDeFunding = new Map<string, number>();
  const porMoeda = lista(veio(respostas.fundings_previstos));
  if (porMoeda === undefined) {
    desconhecido(
      "funding_intervalo_horas",
      razaoDaFalha(respostas.fundings_previstos, "predictedFundings") ??
        "a resposta de `predictedFundings` nao trouxe a lista por moeda",
    );
  } else {
    for (const entrada of porMoeda) {
      const par = lista(entrada);
      const moeda = par !== undefined ? texto(par[0]) : undefined;
      const modalidades = par !== undefined ? lista(par[1]) : undefined;
      if (moeda === undefined || modalidades === undefined) continue;
      for (const modalidade of modalidades) {
        const camposDaModalidade = lista(modalidade);
        if (camposDaModalidade === undefined) continue;
        // So a modalidade DESTE venue: a mesma resposta traz a cadencia de outras corretoras (medido:
        // `BinPerp` 8h, `BybitPerp` 8h) e toma-la por nossa seria declarar o calendario de outra casa.
        if (texto(camposDaModalidade[0]) !== MODALIDADE_DO_VENUE) continue;
        const horas = numero(objecto(camposDaModalidade[1])?.fundingIntervalHours);
        if (horas !== undefined && Number.isInteger(horas) && horas >= 1) cadenciaDeFunding.set(moeda, horas);
      }
    }
    const amostra = [...cadenciaDeFunding.entries()].slice(0, 3).map(([moeda, horas]) => `${moeda}=${horas}h`).join(", ");
    medido(
      "funding_intervalo_horas",
      cadenciaDeFunding.size,
      "info.predictedFundings()[coin][HlPerp].fundingIntervalHours",
      `o venue declara a cadencia do funding POR INSTRUMENTO (${cadenciaDeFunding.size} de ${porMoeda.length} ` +
        `moedas a declaram; medido: ${amostra}) — e por instrumento que o contrato 1.4.0 a declara, na unidade ` +
        `do venue (horas)`,
    );
  }

  // ---- 1. meta: os instrumentos, com a sua unidade ------------------------------------------------
  const meta = objecto(veio(respostas.meta));
  const universo = meta !== undefined ? lista(meta.universe) : undefined;
  let universoDoManifesto: LinhaDoUniverso[] | undefined;

  if (universo === undefined) {
    desconhecido(
      "meta.universe",
      razaoDaFalha(respostas.meta, "meta") ?? "a resposta de `meta` nao trouxe uma lista `universe`",
    );
  } else {
    // As TABELAS de margem do venue: uma por familia de escaloes, e o `marginTableId` que cada instrumento
    // aponta. O venue da o limite INFERIOR de cada escalao (`lowerBound`), que e a forma que o contrato
    // 1.4.0 passou a exigir. Uma tabela cujo limite nao seja um decimal do contrato NAO se publica: fica
    // sem escaloes declarados (e o manifesto nao declara o que nao se pode dizer na lingua do contrato).
    const tabelas = new Map<number, { lowerBound: string; maxLeverage: number }[]>();
    let tabelasInvalidas = 0;
    for (const tabela of lista(meta?.marginTables) ?? []) {
      const par = lista(tabela);
      const identificador = par !== undefined ? numero(par[0]) : undefined;
      const escaloes = par !== undefined ? lista(objecto(par[1])?.marginTiers) : undefined;
      if (identificador === undefined || escaloes === undefined || escaloes.length === 0) continue;
      const linhas: { lowerBound: string; maxLeverage: number }[] = [];
      let valida = true;
      for (const escalao of escaloes) {
        const e = objecto(escalao);
        const limite = e !== undefined ? texto(e.lowerBound) : undefined;
        const maxima = e !== undefined ? numero(e.maxLeverage) : undefined;
        if (limite === undefined || maxima === undefined || !DECIMAL.test(limite)) {
          valida = false;
          break;
        }
        linhas.push({ lowerBound: limite, maxLeverage: maxima });
      }
      if (valida) tabelas.set(identificador, linhas);
      else tabelasInvalidas += 1;
    }

    const linhas: LinhaDoUniverso[] = [];
    for (const item of universo) {
      const o = objecto(item);
      const nome = o !== undefined ? texto(o.name) : undefined;
      const casas = o !== undefined ? numero(o.szDecimals) : undefined;
      const maxima = o !== undefined ? numero(o.maxLeverage) : undefined;
      if (nome === undefined || casas === undefined || maxima === undefined) continue;
      const linha: LinhaDoUniverso = { name: nome, szDecimals: casas, maxLeverage: maxima };
      // `isDelisted` do venue: a chave so aparece quando e verdadeira, e so nesse caso se copia. Nao se
      // escreve `false` por omissao nossa — «nao dito» e «declarado falso» sao coisas diferentes.
      if (o?.isDelisted === true) linha.isDelisted = true;
      const cadencia = cadenciaDeFunding.get(nome);
      if (cadencia !== undefined) linha.fundingIntervalHours = cadencia;
      const idTabela = o !== undefined ? numero(o.marginTableId) : undefined;
      const escaloes = idTabela !== undefined ? tabelas.get(idTabela) : undefined;
      if (escaloes !== undefined) linha.marginTiers = escaloes;
      linhas.push(linha);
    }
    universoDoManifesto = linhas;
    const delistados = universo.filter((u) => objecto(u)?.isDelisted === true).length;
    const comEscaloes = linhas.filter((l) => l.marginTiers !== undefined).length;
    medido(
      "meta.universe",
      `${linhas.length} instrumentos`,
      "info.meta().universe[] + info.meta().marginTables[]",
      `o venue devolveu ${linhas.length} instrumentos com name/szDecimals/maxLeverage ` +
        `(dos quais ${delistados} trazem isDelisted=true: o venue continua a lista-los, e o manifesto DECLARA-os ` +
        `no campo \`deslistado\` desde a 1.4.0 — um mandato que nomeie um deles RECUSA, nomeando-o, com ` +
        `\`instrumento_deslistado_no_venue\`). ${comEscaloes} instrumentos trazem os escaloes de margem do venue` +
        (tabelasInvalidas > 0 ? `, e ${tabelasInvalidas} tabelas de margem do venue nao sao decimais do contrato: ficaram sem escaloes declarados` : ""),
    );
  }

  // ---- 2. os instrumentos pedidos: do MANDATO, nao do venue ----------------------------------------
  medido(
    "instrumentos_pedidos",
    pedido.instrumentos_pedidos,
    "pedido (config do conector)",
    "os instrumentos do mandato NAO sao um facto do venue: o manifesto confere-os contra `meta.universe` " +
      "e recusa nomeando o que nao encontrar",
  );

  // ---- 3. o contexto por instrumento: funding (e a marca para a leitura) ---------------------------
  const ctxs = lista(veio(respostas.meta_e_ctxs));
  const contextos = ctxs !== undefined && ctxs.length === 2 ? lista(ctxs[1]) : undefined;
  const primeiroContexto = contextos?.map(objecto).find((c) => c !== undefined);
  if (primeiroContexto === undefined) {
    desconhecido(
      "funding_publicado",
      razaoDaFalha(respostas.meta_e_ctxs, "metaAndAssetCtxs") ??
        "a resposta de `metaAndAssetCtxs` nao trouxe a lista de contextos por instrumento",
    );
  } else {
    const taxa = texto(primeiroContexto.funding);
    const traz = contextos?.map(objecto).filter((c) => c !== undefined && taxaDeFunding(c) !== undefined).length ?? 0;
    medido(
      "funding_publicado",
      taxa !== undefined,
      "info.metaAndAssetCtxs()[1][].funding",
      taxa !== undefined
        ? `o venue publica a taxa de funding por instrumento (${traz} de ${contextos?.length ?? 0} contextos trazem ` +
          "`funding`; exemplo medido: BTC = " + taxa + "), e `predictedFundings` declara o intervalo horario"
        : "o venue respondeu os contextos por instrumento e NENHUM traz `funding`: nao publica funding",
    );
    // A CADENCIA do funding nao se mede aqui: e lida na leitura 0 (`predictedFundings`), POR INSTRUMENTO,
    // e declarada em cada unidade do universo (`funding_intervalo_horas`, aditivo na 1.4.0) com o registo
    // do campo feito la. Uma so medida por grandeza.
  }

  // ---- 4. a profundidade do livro que o venue publica ----------------------------------------------
  const livro = objecto(veio(respostas.livro));
  const niveis = livro !== undefined ? lista(livro.levels) : undefined;
  const lados = niveis !== undefined ? niveis.map(lista) : undefined;
  if (lados === undefined || lados.length < 2 || lados[0] === undefined || lados[1] === undefined) {
    desconhecido(
      "profundidade_de_livro",
      razaoDaFalha(respostas.livro, "l2Book") ?? "a resposta de `l2Book` nao trouxe dois lados de niveis",
    );
  } else {
    const profundidade = Math.min(lados[0].length, lados[1].length);
    medido(
      "profundidade_de_livro",
      profundidade,
      "info.l2Book({coin}).levels[]",
      `o livro que o venue publica tem ${lados[0].length} niveis de compra e ${lados[1].length} de venda; ` +
        `a profundidade declarada e a do lado mais curto (${profundidade}) — o setup sabe o que nao ve`,
    );
  }

  // ---- 5. o relogio: as velas dizem se ha fecho de sessao ------------------------------------------
  const velas = lista(veio(respostas.velas));
  if (velas === undefined || velas.length === 0) {
    desconhecido(
      "relogio_de_fecho_de_barra",
      razaoDaFalha(respostas.velas, "candleSnapshot") ??
        "a resposta de `candleSnapshot` nao trouxe velas, e sem elas nao se mede o calendario do venue",
    );
  } else {
    const horas = new Set<string>();
    for (const c of velas) {
      const t = numero(objecto(c)?.t);
      if (t !== undefined) horas.add(String(Math.floor(t / 3600000)));
    }
    if (horas.size >= 24) {
      medido(
        "relogio_de_fecho_de_barra",
        "continuo",
        "info.candleSnapshot({coin, interval:'1h'})",
        `o venue publicou velas de hora a hora em ${horas.size} horas distintas do dia, sem falha nenhuma: nao ha ` +
          "fecho de sessao — o calendario do perpueto e continuo",
      );
    } else {
      desconhecido(
        "relogio_de_fecho_de_barra",
        `as velas cobrem ${horas.size} hora(s) distinta(s) de um dia: com falhas no calendario, o venue nao deixa ` +
          "medir onde fecha a sessao — nao se inventa `horario` nem `meia_noite_utc`",
      );
    }
  }

  // ---- 6. o estado operacional da exchange ----------------------------------------------------------
  const estado = objecto(veio(respostas.estado_da_exchange));
  if (estado === undefined) {
    desconhecido(
      "estado_do_mercado",
      razaoDaFalha(respostas.estado_da_exchange, "exchangeStatus") ??
        "a resposta de `exchangeStatus` nao trouxe um objecto de estado",
    );
  } else if (!temChave(estado, "specialStatuses")) {
    desconhecido(
      "estado_do_mercado",
      "a resposta de `exchangeStatus` nao trouxe `specialStatuses`: sem essa lista o venue nao esta a declarar o " +
        "estado operacional, e `null` de uma chave ausente nao e um valor",
    );
  } else {
    const suspensos = estado.specialStatuses;
    medido(
      "estado_do_mercado",
      true,
      "info.exchangeStatus().specialStatuses",
      suspensos === null
        ? "o venue declara a lista de estados especiais do mercado e ela vem VAZIA (`null` = nenhum em vigor): o " +
          "venue sabe dizer se o mercado esta aberto"
        : `o venue declara estados especiais em vigor (${JSON.stringify(suspensos)})`,
    );
  }

  // ---- 7. o historico de ordens: TIF, tipo, reduce-only e a marca ----------------------------------
  const historicas = lista(veio(respostas.ordens_historicas));
  const ordens: Record<string, unknown>[] = [];
  if (historicas !== undefined) {
    for (const h of historicas) {
      const o = objecto(objecto(h)?.order);
      if (o !== undefined) ordens.push(o);
    }
  }
  const razaoDasOrdens = razaoDaFalha(respostas.ordens_historicas, "historicalOrders");

  if (ordens.length === 0) {
    const porque = razaoDasOrdens ?? "o venue nao tem ordens registadas para esta conta";
    desconhecido("tipos_de_ordem", `sem ordens registadas nao ha tipo de ordem medido (${porque})`);
    desconhecido("reduce_only_suportado", `sem ordens registadas nao ha reduce-only medido (${porque})`);
    desconhecido("marca_de_posse", `sem ordens registadas nao ha forma de marca medida (${porque})`);
  } else {
    // 7a. os tipos de ordem — ordens SIMPLES (sem disparo) que o venue aceitou e registou.
    const simples = ordens.filter((o) => o.isTrigger === false);
    const vistos = new Set<string>();
    for (const o of simples) {
      const bruto = texto(o.orderType);
      const traduzido = bruto !== undefined ? TIPO_DE_ORDEM_DO_VENUE[bruto] : undefined;
      if (traduzido !== undefined) vistos.add(traduzido);
    }
    const disparos = ordens.filter((o) => o.isTrigger === true).length;
    if (vistos.size === 0) {
      desconhecido(
        "tipos_de_ordem",
        `o venue registou ${ordens.length} ordens mas nenhuma com um ` +
          `orderType que a tabela declarada conheca (${[...new Set(simples.map((o) => String(o.orderType)))].join(", ")}): ` +
          "um tipo que nao se sabe traduzir NAO entra no conjunto declarado",
      );
    } else {
      medido(
        "tipos_de_ordem",
        ORDEM_DOS_TIPOS.filter((t) => vistos.has(t)),
        "info.historicalOrders()[].order.orderType",
        `o venue registou ${simples.length} ordens simples desta conta e o vocabulario dele deu ` +
          `${[...vistos].join(", ")}; ordens de disparo registadas: ${disparos} — os campos de trigger ` +
          "(`isTrigger`, `triggerPx`, `children`, `isPositionTpsl`) existem no registo mas nenhuma os preencheu, " +
          "logo `stop`/`stop_limite` NAO entram no conjunto declarado",
      );
    }

    // 7b. reduce-only: o venue registou ordens com `reduceOnly` verdadeiro.
    const comReduceOnly = contar(ordens, "reduceOnly", true);
    if (comReduceOnly === 0) {
      desconhecido(
        "reduce_only_suportado",
        `o venue registou ${ordens.length} ordens e NENHUMA com \`reduceOnly\` verdadeiro: sem uma instancia, o ` +
          "campo existir nao e prova de que o pedido e honrado — quem o mede e a bateria (prova 5)",
      );
    } else {
      medido(
        "reduce_only_suportado",
        true,
        "info.historicalOrders()[].order.reduceOnly",
        `o venue registou ${comReduceOnly} ordens desta conta com reduceOnly verdadeiro e tem estados proprios ` +
          "para o tratar (o vocabulario de `status` inclui reduceOnlyCanceled e reduceOnlyRejected): e nativo",
      );
    }

    // 7c. a marca de posse: a FORMA (a garantia e outra coisa, e nao esta medida).
    const comCampoDaMarca = ordens.filter((o) => temChave(o, CAMPO_DA_MARCA_NO_VENUE)).length;
    if (comCampoDaMarca === ordens.length) {
      medido(
        "marca_de_posse",
        "cloid",
        "info.historicalOrders()[].order.cloid",
        `o registo de ordens do venue traz o campo \`cloid\` em ${comCampoDaMarca}/${ordens.length} ordens: e a ` +
          "forma com que este venue transporta a marca de posse (todas a null porque o motor antigo nunca o usou — " +
          "a FORMA esta declarada, a GARANTIA de nao-duplicar e o campo `idempotencia`, que nao esta medido)",
      );
    } else {
      desconhecido(
        "marca_de_posse",
        `so ${comCampoDaMarca}/${ordens.length} ordens do venue trazem o campo \`cloid\`: sem o campo em todas, a ` +
          "forma da marca nao esta declarada pelo venue",
      );
    }
  }

  // ---- 8. as execucoes: a politica de parcial ------------------------------------------------
  const execucoes = lista(veio(respostas.execucoes));
  if (execucoes === undefined || ordens.length === 0) {
    desconhecido(
      "parcial_suportada",
      razaoDaFalha(respostas.execucoes, "userFills") ??
        "sem execucoes e sem ordens registadas nao se mede se o venue serve uma parte da ordem",
    );
  } else {
    // O executado por ordem, somado das execucoes do PROPRIO venue (nunca calculado por nos).
    const executadoPorOrdem = new Map<number, string>();
    for (const f of execucoes) {
      const o = objecto(f);
      const oid = numero(o?.oid);
      const sz = o !== undefined ? texto(o.sz) : undefined;
      if (oid === undefined || sz === undefined || !DECIMAL.test(sz)) continue;
      const anterior = executadoPorOrdem.get(oid);
      executadoPorOrdem.set(oid, anterior === undefined ? sz : somarDecimais(anterior, sz));
    }
    let parciais = 0;
    let exemplo = "";
    for (const o of ordens) {
      const oid = numero(o.oid);
      const pedido = texto(o.origSz);
      const feito = oid !== undefined ? executadoPorOrdem.get(oid) : undefined;
      if (oid === undefined || pedido === undefined || feito === undefined) continue;
      if (!DECIMAL.test(pedido) || !DECIMAL.test(feito)) continue;
      if (compararDecimais(feito, "0") > 0 && compararDecimais(feito, pedido) < 0) {
        parciais++;
        if (exemplo === "") exemplo = `ordem ${oid}: pediu ${pedido}, o venue executou ${feito}`;
      }
    }
    if (parciais === 0) {
      desconhecido(
        "parcial_suportada",
        `nenhuma das ${ordens.length} ordens registadas ficou servida so em parte (${execucoes.length} execucoes): ` +
          "sem uma instancia, nao se declara que o venue aceita servir parte",
      );
    } else {
      medido(
        "parcial_suportada",
        ["o_que_der"],
        "info.userFills() somado por `oid` contra info.historicalOrders()[].order.origSz",
        `o venue serviu ${parciais} ordens desta conta SO EM PARTE antes de as cancelar (${exemplo}): a politica ` +
          "que ele pratica e `o_que_der`; `tudo_ou_nada` nao foi medido em lado nenhum",
      );
    }
  }

  // ---- 9. os modos de margem ----------------------------------------------------------------------
  {
    const modos: string[] = [];
    const evidencias: string[] = [];
    const estritos = universo?.filter((u) => objecto(u)?.marginMode === "strictIsolated").length ?? 0;
    if (estritos > 0) {
      modos.push("isolado");
      evidencias.push(`meta().universe[] tem ${estritos} activos com marginMode=strictIsolated`);
    } else if (universo !== undefined) {
      evidencias.push("meta().universe[] nao declara nenhum activo strictIsolated");
    } else {
      evidencias.push(razaoDaFalha(respostas.meta, "meta") ?? "sem meta nao se ve margem isolada");
    }
    const activo = objecto(veio(respostas.activo_da_conta));
    const tipoDaAlavancagem = activo !== undefined ? texto(objecto(activo.leverage)?.type) : undefined;
    if (tipoDaAlavancagem === "cross") {
      modos.push("cruzado");
      evidencias.push("activeAssetData().leverage.type=cross — o venue reporta a conta em margem cruzada neste activo");
    } else {
      evidencias.push(
        razaoDaFalha(respostas.activo_da_conta, "activeAssetData") ??
          "activeAssetData() nao reportou o modo da conta neste activo",
      );
    }
    if (modos.length === 0) {
      desconhecido("modos_de_margem", `nenhum modo de margem foi medido (${evidencias.join("; ")})`);
    } else {
      medido(
        "modos_de_margem",
        ["cruzado", "isolado"].filter((m) => modos.includes(m)),
        "info.meta().universe[].marginMode + info.activeAssetData().leverage.type",
        evidencias.join("; "),
      );
    }
  }

  // ---- 10. OS CAMPOS QUE O VENUE NAO PUBLICA ------------------------------------------------------
  // Nao ha leitura publica que os devolva. Nao se preenchem com a documentacao nem com um default: ficam
  // DESCONHECIDOS, pelo nome, e o manifesto recusa nomeando-os. Quem os mede e a bateria de conformidade.
  desconhecido(
    "minimo_de_valor_por_ordem",
    "nenhuma leitura publica o publica. O endpoint cujo NOME o sugere (`perpDexLimits`) trata de tectos de " +
      "interesse aberto de mercados de terceiros e devolve `null` no dex principal (medido); o minimo por ordem so " +
      "se prova com a RECUSA do venue a uma ordem abaixo dele — e isso exige ASSINAR e enviar, que e a prova 2 da " +
      "bateria de conformidade (RN-C6). Escreve-lo aqui seria um numero do venue constante no nosso codigo (RN-C1)",
  );
  desconhecido(
    "desvio_maximo",
    "o desvio de uma ordem a mercado e um parametro que a NOSSA ponta manda na boleta, nao um limite que o venue " +
      "publique: nenhuma leitura devolve um desvio maximo aceite. `desvio_maximo` e campo [C] do data-model, nao [V]",
  );
  desconhecido(
    "ajusta_alavancagem",
    "o verbo que ajusta a alavancagem pertence a superficie de ESCRITA do venue: nenhuma LEITURA o declara. A " +
      "leitura da conta diz o VALOR da alavancagem daquele activo (medido: leverage.value no activo de referencia), " +
      "nao a capacidade de a mudar. Quem o mede e a bateria (prova 3). CONSEQUENCIA: enquanto este campo for " +
      "desconhecido, a traducao RECUSA toda a boleta que peca alavancagem (ordens.ts, porta 4) — e essa e a " +
      "consequencia correcta de nao prometer o que nao se mediu",
  );
  desconhecido(
    "stop_anexo",
    "o registo de ordens do venue traz os campos de disparo (`isTrigger`, `triggerPx`, `triggerCondition`, " +
      "`children`, `isPositionTpsl`), mas NENHUMA das ordens desta conta os preencheu (medido: 0 instancias): o " +
      "venue declara a FORMA, nao o comportamento. Quem o mede e a bateria (provas 4 e 5)",
  );
  desconhecido(
    "idempotencia",
    "o registo de ordens do venue traz o campo `cloid`, mas o campo EXISTIR nao prova que um reenvio da mesma " +
      "referencia nao cria segunda ordem — isso so se prova ENVIANDO duas vezes com a mesma referencia (bateria, " +
      "prova 6). RN-C4: sem esta declaracao a mesa reconcilia ANTES de reenviar",
  );
  desconhecido(
    "marca_liga_ordem_a_posicao",
    "exige uma POSICAO viva para se medir e a conta nao tem nenhuma no instante da sonda (medido no " +
      "`clearinghouseState` da leitura). O registo de posicoes do venue nao traz campo de ordem nem `cloid` — mas " +
      "isso e a forma DECLARADA, nao uma medicao nesta conta; quem o mede e a bateria",
  );

  // ---- 11. A SONDA --------------------------------------------------------------------------------
  const porCampo = new Map(campos.map((c) => [c.campo, c]));
  const sonda: Sonda = {
    venue: { nome: pedido.venue, ambiente: pedido.ambiente },
    versao_do_conector: pedido.versao_do_conector,
    ...(universoDoManifesto !== undefined ? { meta: { universe: universoDoManifesto } } : {}),
    instrumentos_pedidos: pedido.instrumentos_pedidos,
    minimo_de_valor_por_ordem: porCampo.get("minimo_de_valor_por_ordem")?.valor as string | undefined,
    modos_de_margem: porCampo.get("modos_de_margem")?.valor as string[] | undefined,
    tipos_de_ordem: porCampo.get("tipos_de_ordem")?.valor as string[] | undefined,
    parcial_suportada: porCampo.get("parcial_suportada")?.valor as string[] | undefined,
    desvio_maximo: porCampo.get("desvio_maximo")?.valor as string | undefined,
    reduce_only_suportado: porCampo.get("reduce_only_suportado")?.valor as boolean | undefined,
    stop_anexo: porCampo.get("stop_anexo")?.valor as boolean | undefined,
    ajusta_alavancagem: porCampo.get("ajusta_alavancagem")?.valor as boolean | undefined,
    profundidade_de_livro: porCampo.get("profundidade_de_livro")?.valor as number | undefined,
    funding_publicado: porCampo.get("funding_publicado")?.valor as boolean | undefined,
    relogio_de_fecho_de_barra: porCampo.get("relogio_de_fecho_de_barra")?.valor as string | undefined,
    idempotencia: porCampo.get("idempotencia")?.valor as boolean | undefined,
    marca_de_posse: porCampo.get("marca_de_posse")?.valor as string | undefined,
    marca_liga_ordem_a_posicao: porCampo.get("marca_liga_ordem_a_posicao")?.valor as boolean | undefined,
    estado_do_mercado: porCampo.get("estado_do_mercado")?.valor as boolean | undefined,
  };

  return { sonda, campos, nao_medidos };
}

/** A soma de dois decimais textuais, em BigInt (nunca em virgula flutuante). */
function somarDecimais(a: string, b: string): string {
  const escala = Math.max(decimais(a), decimais(b));
  const soma = escalado(a) * 10n ** BigInt(escala - decimais(a)) + escalado(b) * 10n ** BigInt(escala - decimais(b));
  if (escala === 0) return soma.toString();
  const dig = soma.toString().padStart(escala + 1, "0");
  const inteiro = dig.slice(0, dig.length - escala);
  const fracao = dig.slice(dig.length - escala).replace(/0+$/, "");
  return fracao === "" ? inteiro : `${inteiro}.${fracao}`;
}

/** O `funding` de um contexto, so quando vem como decimal textual (sem coerir nada). */
function taxaDeFunding(c: Record<string, unknown>): string | undefined {
  const t = texto(c.funding);
  return t !== undefined && DECIMAL.test(t) ? t : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// A SONDA COMPLETA: le, constroi a sonda e publica o manifesto — ou recusa nomeando o que falta.
// ---------------------------------------------------------------------------------------------------------

export async function sondar(
  porta: PortaDeLeitura,
  pedido: PedidoDaSonda,
  conta: string,
): Promise<SondaEConsolidacao> {
  const respostas = await lerDoVenue(porta, pedido, conta);
  const medida = construirSonda(respostas, pedido);
  return { ...medida, manifesto: construirManifesto(medida.sonda) };
}
