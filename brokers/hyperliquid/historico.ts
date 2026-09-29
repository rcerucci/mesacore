// O HISTORICO DO VENUE (FR-018, RN-H14) — o trilho do dinheiro, como a CORRETORA o conta.
//
// O QUE ESTE FICHEIRO E: o lado que LE do venue o historico da conta — execucoes, taxas, funding e
// resultado realizado — e o devolve como DADO, campo a campo, com a ORIGEM de cada numero nomeada
// (RN-C11). Quem DECIDE continua a ser outro: a traducao para a carga do contrato e um mapeamento
// mecanico (`cargaDoHistorico`), e quem julga se a carga esta completa e O CONTRATO (o esquema dele),
// nunca uma segunda regra escrita aqui.
//
// A REGRA, por inteiro (FR-018, RN-H14, RN-D6):
//
//   * o historico exposto e o do VENUE — nada recalculado por nos. SOMAR EXECUCOES PARA «RECONSTRUIR» O
//     RESULTADO E O DEFEITO QUE A REGRA PROIBE: a conta da corretora nao e a soma das parcelas que ela
//     reporta (o duble do recorte 001 demonstra-o por medicao, `mocks/conector/historico.py`);
//   * um numero que o venue NAO deu fica `nao_publicado`, dito PELO NOME e com a razao. NUNCA vira zero
//     (que pareceria um custo medido) nem vira «sim». Esta leitura nao calcula TOTAL nenhum: nem de
//     taxas, nem de funding, nem de resultado — um total nosso seria uma conta nossa;
//   * o venue publica o resultado realizado POR EXECUCAO (`closedPnl` em `userFills`) e o contrato pede
//     um numero POR INSTRUMENTO (`historico.resultado_realizado`). As duas coisas nao sao a mesma, e a
//     ponte entre elas — somar as parcelas — e exactamente a reconstrucao proibida. Por isso o resultado
//     por instrumento fica DESCONHECIDO e o `closedPnl` de cada execucao fica em campo PROPRIO da
//     leitura, com a origem, sem se somar a nada. Ele NAO entra na carga do contrato: o esquema do
//     contrato nao tem campo de resultado por execucao, e tem-no de proposito ("somar e do venue, nunca
//     da mesa").
//
// O QUE O VENUE (Hyperliquid) NAO PUBLICA, medido a 30 set 2026 contra a conta publica de teste
// 0xF87138D298E338962E1a2e0ff23267Dc32c15621 — e que por isso nao se inventa:
//
//   * a MARCA DE POSSE no inteiro de 31 bits que a mesa compoe (`marca_de_posse: { ficha << bits_ciclo |
//     ciclo }`, em `contracts/vocabulario.json`). Este venue guarda a marca na forma `cloid` — 0x + 32
//     hexadecimais, 128 bits (`cloid.ts`) — e a nossa derivacao e um HASH da referencia: o inteiro da
//     marca NAO esta la dentro. Medido: 415 de 415 ordens da conta com `cloid` nulo, e nenhuma execucao
//     com `cloid`. Uma coisa nao da a outra — e como nao ha nenhuma, nao ha o que escrever: a marca por
//     execucao fica AUSENTE na carga (nunca zero), que e o que a emenda 1.5.0 passou a permitir;
//   * a REFERENCIA DE CLIENTE de cada execucao, quando o venue nao guardou `cloid` nenhum (nesta conta,
//     nenhuma: a ordem veio do motor antigo, que nao usava marca). O `cloid` e um hash de mao unica: da
//     referencia para o `cloid` vai-se; de volta, nao. Ausente na carga, nunca `null` nem vazio;
//   * um RESULTADO REALIZADO POR INSTRUMENTO (o venue so o publica por execucao — ver acima). OPCIONAL
//     no contrato desde a 1.5.0: o campo de cima fica AUSENTE, e o `closedPnl` de cada execucao fica no
//     campo proprio da leitura. Somar as parcelas continua proibido;
//   * a MOEDA da taxa NA FORMA QUE O CONTRATO PEDIA — e que a emenda 1.5.0 ALARGOU e a 1.6.0 alargou
//     outra vez ao MEDIDO. O venue escreve-a (`feeToken`) como `USDC`, com QUATRO letras (medido: nas 56
//     execucoes desta conta, pelo HTTP cru e pelo SDK oficial), e o contrato declarava este campo com a
//     forma de TRES (`^[A-Z]{3}$`). `USDC` nao e `USD`: normalizar o nome do venue para caber seria a
//     mesa a corrigi-lo. Quem podia resolver era o CONTRATO, e resolveu: a 1.5.0 passou a TRES a CINCO
//     letras maiusculas e a 1.6.0 alargou ao universo MEDIDO do venue — 1863 simbolos distintos, de 1 a
//     11 caracteres, com digitos (`TEST1`) e minusculas (`TestPascal1`), dos quais 1862 cabem na forma
//     nova e UM (`JPL `, com espaco) continua a RECUSAR. Por isso a moeda passou a ser LIDA, e nao ha
//     nada a declarar em falta aqui;
//
// NADA DISSO SE PREENCHE AQUI. A leitura diz o nome de cada campo em falta (`nao_publicados`), e quem
// responde ao pedido e o processo (`conector.ts`), que so serve a mensagem se o CONTRATO a aceitar.
//
// NAO IMPORTA O `core` (RN-E1) e NAO DECIDE NADA (RN-C5): le, mapeia e declara. Nao escolhe lado,
// tamanho, preco nem momento, e nao julga risco.
//
// A PORTA (o mesmo padrao de `sonda.ts` e `leitura.ts`): as leituras entram como PARAMETRO, o nucleo
// fica PURO, e os casos correm offline. O venue entra como DADO.

import type { Resposta } from "./sonda.ts";

// ---------------------------------------------------------------------------------------------------------
// A porta: as leituras do historico entram como PARAMETRO (o nucleo fica puro e testavel sem rede).
// ---------------------------------------------------------------------------------------------------------

export type PedidoDeHistorico = {
  /** O endereco da CONTA PRINCIPAL (master): o mesmo cuidado da leitura da conta — o agente devolve vazio. */
  conta: string;
  /** O instrumento do historico pedido, como o venue o escreve (`coin`). */
  instrumento: string;
  /**
   * A JANELA declarada: o instante a partir do qual as execucoes se leem. Ausente = o que o venue tiver.
   * Quem a escolhe e o CHAMADOR — nao ha aqui nenhum prazo nem nenhuma janela por omissao nossa.
   */
  inicio_ms?: number;
};

export type RespostasDoHistorico = {
  /** `userFills` (ou `userFillsByTime`, com a janela declarada): as execucoes da conta. */
  execucoes?: Resposta;
  /** `historicalOrders`: o registo de ordens do venue — e dele que sai o `cloid` quando a execucao nao o traz. */
  ordens?: Resposta;
  /** `userFees`: a TABELA de taxas desta conta, como o venue a declara. */
  taxas?: Resposta;
  /** `userFunding`: os pagamentos de funding DA CONTA, pelo venue. */
  funding_da_conta?: Resposta;
  /** `fundingHistory`: a taxa de funding publicada pelo venue, por instrumento e por periodo. */
  funding_publicado?: Resposta;
};

export type PortaDeHistorico = {
  execucoes(conta: string, inicioMs?: number): Promise<unknown>;
  ordensHistoricas(conta: string): Promise<unknown>;
  taxasDaConta(conta: string): Promise<unknown>;
  fundingDaConta(conta: string, inicioMs?: number): Promise<unknown>;
  fundingPublicado(coin: string, inicioMs?: number): Promise<unknown>;
};

/** O cliente do venue, na forma ESTRUTURAL que esta porta consome (o SDK oficial encaixa aqui). */
export type ClienteDeHistorico = {
  userFills(p: { user: string }): Promise<unknown>;
  userFillsByTime(p: { user: string; startTime: number }): Promise<unknown>;
  historicalOrders(p: { user: string }): Promise<unknown>;
  userFees(p: { user: string }): Promise<unknown>;
  userFunding(p: { user: string; startTime: number }): Promise<unknown>;
  fundingHistory(p: { coin: string; startTime: number }): Promise<unknown>;
};

/**
 * A janela POR OMISSAO das leituras que o venue exige COM instante (`userFillsByTime`, `userFunding`,
 * `fundingHistory`): zero — «desde o principio». Nao e um prazo nem uma politica: e a ausencia declarada
 * de janela, e o pedido diz qual usou. Vai em DADO para o caso poder declarar outra.
 */
export const INICIO_POR_OMISSAO_MS = 0;

export function portaDoCliente(cliente: ClienteDeHistorico, inicioPorOmissaoMs = INICIO_POR_OMISSAO_MS): PortaDeHistorico {
  return {
    // A JANELA MUDA A CHAMADA, e nao so o pedido: sem janela declarada, `userFills` (o que o venue tiver);
    // com janela, `userFillsByTime` (o venue filtra pelo instante declarado). Quem escolhe a janela e o
    // CHAMADOR — aqui nao ha prazo por omissao nosso.
    execucoes: (conta, inicioMs) =>
      inicioMs === undefined
        ? cliente.userFills({ user: conta })
        : cliente.userFillsByTime({ user: conta, startTime: inicioMs }),
    ordensHistoricas: (conta) => cliente.historicalOrders({ user: conta }),
    taxasDaConta: (conta) => cliente.userFees({ user: conta }),
    fundingDaConta: (conta, inicioMs) => cliente.userFunding({ user: conta, startTime: inicioMs ?? inicioPorOmissaoMs }),
    fundingPublicado: (coin, inicioMs) => cliente.fundingHistory({ coin, startTime: inicioMs ?? inicioPorOmissaoMs }),
  };
}

export async function lerDoVenueDoHistorico(porta: PortaDeHistorico, pedido: PedidoDeHistorico): Promise<RespostasDoHistorico> {
  async function tentar(f: () => Promise<unknown>): Promise<Resposta> {
    try {
      return { ok: true, valor: await f() };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return {
    execucoes: await tentar(() => porta.execucoes(pedido.conta, pedido.inicio_ms)),
    ordens: await tentar(() => porta.ordensHistoricas(pedido.conta)),
    taxas: await tentar(() => porta.taxasDaConta(pedido.conta)),
    funding_da_conta: await tentar(() => porta.fundingDaConta(pedido.conta, pedido.inicio_ms)),
    funding_publicado: await tentar(() => porta.fundingPublicado(pedido.instrumento, pedido.inicio_ms)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// As grandezas: um valor LIDO (com a origem) ou o NOME do que o venue nao deu (com a razao). Nao ha
// terceiro estado — e nao ha zero a fingir de ausencia.
// ---------------------------------------------------------------------------------------------------------

export type Grandeza<T> =
  | { estado: "lido"; valor: T; origem: string; nota?: string }
  | { estado: "nao_publicado"; porque: string; origem?: string };

/** Uma execucao, como o venue a conta. So campos do venue — nenhum numero calculado por nos. */
export type ExecucaoDoHistorico = {
  /** O instante DO VENUE que data a execucao (RN-D2/D3): o relogio e o dele. */
  instante_ms: number;
  lado: "buy" | "sell";
  quantidade: string;
  preco: string;
  /** A taxa da execucao, como o venue a cobra. SEMPRE lida: uma execucao sem taxa NAO entra (ver `taxa`). */
  taxa: string;
  /**
   * O resultado realizado DA EXECUCAO (`closedPnl`), como o venue o reporta — campo PROPRIO desta
   * LEITURA. Nao vai para a carga do contrato (que nao tem campo de resultado por execucao, de
   * proposito) e NAO SE SOMA A NADA: somar as parcelas seria reconstruir o resultado (FR-018/RN-H14).
   */
  resultado_do_venue?: string;
  /**
   * A referencia de cliente, na FORMA que este venue guarda: o `cloid` derivado por `cloid.ts` de
   * (conta, instrumento, referencia). E OPACA e compara-se por igualdade (o contrato di-lo da
   * correlacao) — nao se interpreta. Ausente quando o venue nao guardou `cloid` nenhum.
   */
  referencia_do_cliente?: string;
  /** A identidade da execucao NO VENUE: e por ela que a mesa liga a execucao ao que ela mandou. */
  identidade_no_venue: { oid?: string; tid?: string; hash?: string };
  /** A palavra do venue para a direccao da execucao (`dir`) — vai como veio, para o registo. */
  dir?: string;
  crossed?: boolean;
};

export type TaxasDaConta = {
  /** A taxa que o venue aplica a esta conta quando a ordem CRUZA (`userCrossRate`), como ele a declara. */
  taxa_de_cruzamento?: string;
  /** A taxa quando a ordem ADICIONA liquidez (`userAddRate`). */
  taxa_de_adicao?: string;
  /** As taxas de TABELA do venue (`feeSchedule`), na forma crua em que ele as publica. */
  tabela?: { cruzamento?: string; adicao?: string };
  /** O desconto de referencia em vigor (`activeReferralDiscount`), quando o venue o declara. */
  desconto_de_referencia?: string;
  /** O desconto por staking em vigor (`activeStakingDiscount`), quando o venue o declara. */
  desconto_de_staking?: string;
  nota: string;
};

/** Um pagamento de funding da conta, como o venue o reporta (nunca um total nosso). */
export type FundingDaConta = { instrumento: string; instante_ms: number; valor: string; taxa?: string; hash?: string };

/** A taxa de funding PUBLICADA pelo venue para o instrumento, num periodo. */
export type FundingPublicado = { instante_ms: number; taxa: string };

export type LeituraDoHistorico = {
  conta: string;
  instrumento: string;
  /** A moeda em que o venue cobra a taxa (o `feeToken` que ele proprio escreve — medido: USDC). */
  moeda: Grandeza<string>;
  /** O instante DO VENUE que data esta leitura: o maior `time` das execucoes lidas (nao o nosso relogio). */
  instante_ms: number;
  janela: { inicio_ms?: number; nota: string };
  execucoes: ExecucaoDoHistorico[];
  /** As taxas da CONTA (a tabela do venue). Nao e um total pago: um total seria uma conta nossa. */
  taxas_da_conta: Grandeza<TaxasDaConta>;
  /** Os pagamentos de funding DA CONTA. Lista vazia = o venue diz que nao ha nenhum (nunca «zero»). */
  funding_da_conta: Grandeza<FundingDaConta[]>;
  /** A taxa de funding que o venue PUBLICA para o instrumento (a ponta mais recente; ver `nota`). */
  funding_publicado: Grandeza<{ ponta: FundingPublicado[]; periodos_no_venue: number; nota: string }>;
  /**
   * O resultado realizado POR INSTRUMENTO, que o contrato pede. Este venue nao o publica (so por
   * execucao): fica DESCONHECIDO, e a razao vai escrita.
   */
  resultado_realizado_do_instrumento: Grandeza<string>;
  /** A marca de posse que o contrato declara (inteiro de 31 bits): nao existe neste venue, e diz-se. */
  marca_de_posse: Grandeza<number>;
  /** A ORIGEM de cada numero, nomeada (RN-C11) — a chamada e o caminho de onde ele veio. */
  origens: Record<string, string>;
  /** Os NOMES das grandezas do CONTRATO que o venue nao deu. E esta lista que a recusa nomeia. */
  nao_publicados: string[];
  /** O que esta leitura nao faz, dito no proprio dado (e nao so no comentario do ficheiro). */
  notas: string[];
};

export type ResultadoDeHistorico = { ok: true; leitura: LeituraDoHistorico } | { ok: false; motivo: string; porque: string };

// ---------------------------------------------------------------------------------------------------------
// As formas do contrato que esta leitura confere (contracts/_defs/forma.schema.json).
// ---------------------------------------------------------------------------------------------------------

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const DECIMAL_NAO_NEGATIVO = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const DECIMAL_POSITIVO = /^(0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$/;
const MOEDA = /^[A-Za-z0-9]{1,11}$/; // a forma do CONTRATO depois da emenda 1.6.0 — a MEDIDA contra o venue: 1863 simbolos, de 1 a 11 caracteres, com digitos e minusculas (1862 cabem; `JPL `, com espaco, NAO)
const PADRAO_CORRELACAO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
/** A forma do `cloid` deste venue (`cloid.ts`): 0x + 32 hexadecimais minusculos. */
const FORMA_DO_CLOID = /^0x[0-9a-f]{32}$/;

// ---------------------------------------------------------------------------------------------------------
// Leitura dos dados, sem coerir nada (fail-closed).
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

/** Um identificador do venue em TEXTO (o contrato desta ponta nao transporta inteiros grandes como numero). */
function identificador(v: unknown): string | undefined {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return undefined;
}

function decimal(
  onde: string,
  v: unknown,
  padrao: RegExp = DECIMAL,
): { ok: true; valor: string } | { ok: false; motivo: string; porque: string } {
  if (v === undefined) return { ok: false, motivo: "campo_obrigatorio_ausente", porque: `o venue nao declarou ${onde}` };
  if (v === null) return { ok: false, motivo: "valor_nulo_nao_permitido", porque: `${onde} veio a null (D4: null nao existe no contrato)` };
  if (typeof v !== "string") return { ok: false, motivo: "tipo_invalido", porque: `${onde} veio em ${typeof v}, e o contrato exige decimal textual` };
  if (!padrao.test(v)) {
    return {
      ok: false,
      motivo: "formato_invalido",
      porque: `${onde} veio ${JSON.stringify(v)}, que nao e decimal textual do contrato (sem expoente, sem '+')`,
    };
  }
  return { ok: true, valor: v };
}

// ---------------------------------------------------------------------------------------------------------
// AS ORIGENS (RN-C11): a chamada e o caminho de onde cada numero veio.
// ---------------------------------------------------------------------------------------------------------

export const ORIGENS_DO_HISTORICO: Record<string, string> = {
  execucoes: "info.userFills({user})[] — [V]; cada execucao vem do venue, nao ha linha nossa",
  instante_da_execucao: "info.userFills({user})[].time — [V], o relogio do venue",
  lado: "info.userFills({user})[].side — [V] (`B` = compra, `A` = venda)",
  quantidade: "info.userFills({user})[].sz — [V]",
  preco: "info.userFills({user})[].px — [V]",
  taxa: "info.userFills({user})[].fee — [V], a taxa que o venue cobra nesta execucao",
  moeda: "info.userFills({user})[].feeToken — [V], a moeda em que a taxa e cobrada",
  resultado_do_venue_por_execucao: "info.userFills({user})[].closedPnl — [V], POR EXECUCAO; nao se soma (FR-018)",
  referencia_do_cliente:
    "info.userFills({user})[].cloid e, quando a execucao o nao traz, info.historicalOrders({user})[].order.cloid casado pelo `oid` — [V] o `cloid` que o venue guardou; a referencia do cliente so se DERIVA (cloid.ts), nunca se le de volta",
  identidade_no_venue: "info.userFills({user})[].oid/`tid`/`hash` — [V], a identidade da execucao no venue",
  taxas_da_conta: "info.userFees({user}).userCrossRate/userAddRate/feeSchedule — [V], a TABELA de taxas desta conta",
  funding_da_conta: "info.userFunding({user})[] — [V], os pagamentos de funding DESTA conta",
  funding_publicado: "info.fundingHistory({coin})[] — [V], a taxa de funding publicada pelo venue, por periodo",
  instante_da_leitura: "o maior `time` das execucoes lidas — [V]: e o relogio do VENUE que data esta leitura",
  marca_de_posse: "NAO existe: o venue guarda `cloid` (0x + 32 hexadecimais) e o contrato pede um inteiro de 31 bits",
  resultado_realizado_do_instrumento:
    "NAO existe por instrumento: o venue publica o resultado POR EXECUCAO (`closedPnl`) — somar as parcelas seria reconstruir (FR-018)",
};

// ---------------------------------------------------------------------------------------------------------
// A LEITURA. PURA: recebe o que o venue respondeu e devolve o historico — ou a falha, nomeada.
// ---------------------------------------------------------------------------------------------------------

export function lerHistorico(respostas: RespostasDoHistorico, pedido: PedidoDeHistorico): ResultadoDeHistorico {
  const bruto = veio(respostas.execucoes);
  const todas = lista(bruto);

  // Sem a leitura das execucoes nao ha historico nenhum — e a leitura falhada DIZ-SE, nao se preenche.
  if (todas === undefined) {
    return {
      ok: false,
      motivo: "campo_obrigatorio_ausente",
      porque:
        `o historico do instrumento ${pedido.instrumento} nao se leu: ${razaoDaFalha(respostas.execucoes, "userFills")} — ` +
        "sem as execucoes nao ha trilho do dinheiro, e o que nao se leu NAO vira zero nem vira «sem historico» (FR-018)",
    };
  }

  // O registo de ORDENS do venue: e dele que sai o `cloid` quando a execucao o nao traz (casamento pelo `oid`).
  const historicas = lista(veio(respostas.ordens));
  const cloidPorOid = new Map<string, string>();
  if (historicas !== undefined) {
    for (const h of historicas) {
      const o = objecto(objecto(h)?.order);
      const oid = o !== undefined ? identificador(o.oid) : undefined;
      const cloid = o !== undefined ? texto(o.cloid) : undefined;
      if (oid === undefined || cloid === undefined) continue;
      if (!FORMA_DO_CLOID.test(cloid)) continue; // uma forma que nao se conhece nao entra no mapa (e o caso di-lo)
      cloidPorOid.set(oid, cloid);
    }
  }

  const execucoes: ExecucaoDoHistorico[] = [];
  const naoPublicados: string[] = [];
  const moedasVistas = new Set<string>();
  let maiorInstante = 0;
  let algumaSemReferencia = false;
  let algumaComResultado = false;

  for (const item of todas) {
    const f = objecto(item);
    if (f === undefined) continue;
    const coin = f !== undefined ? texto(f.coin) : undefined;
    // SO o instrumento pedido: o venue devolve a conta inteira e o filtro e do PEDIDO, nao uma escolha nossa.
    if (coin === undefined || coin !== pedido.instrumento) continue;

    const instante = numero(f.time);
    if (instante === undefined || !Number.isInteger(instante) || instante < 0) {
      return {
        ok: false,
        motivo: "campo_obrigatorio_ausente",
        porque: `uma execucao de ${pedido.instrumento} veio sem o instante do venue (\`time\`) legivel: sem data nao se data o dinheiro`,
      };
    }
    const lado = f.side === "B" ? "buy" : f.side === "A" ? "sell" : undefined;
    if (lado === undefined) {
      return {
        ok: false,
        motivo: "valor_fora_do_conjunto",
        porque: `uma execucao de ${pedido.instrumento} veio com o lado ${JSON.stringify(f.side)}, que nao e nem \`B\` nem \`A\`: nao se adivinha o lado de uma execucao`,
      };
    }
    const quantidade = decimal(`userFills[${coin}].sz`, f.sz, DECIMAL_POSITIVO);
    if (!quantidade.ok) return { ok: false, motivo: quantidade.motivo, porque: quantidade.porque };
    const preco = decimal(`userFills[${coin}].px`, f.px, DECIMAL_POSITIVO);
    if (!preco.ok) return { ok: false, motivo: preco.motivo, porque: preco.porque };

    // A TAXA e o campo que nao pode faltar: o contrato exige-a em cada execucao, e uma taxa ausente NAO
    // vira zero (o zero pareceria um custo medido). Sem saber a taxa, a execucao nao se serve.
    const taxa = decimal(`userFills[${coin}].fee`, f.fee, DECIMAL_NAO_NEGATIVO);
    if (!taxa.ok) {
      return {
        ok: false,
        motivo: taxa.motivo,
        porque:
          `${taxa.porque} — a TAXA desta execucao (oid ${identificador(f.oid) ?? "(sem oid)"}, ${instante} ms) fica ` +
          "DESCONHECIDA, e uma taxa desconhecida NAO vira zero (FR-018: o zero pareceria um custo medido)",
      };
    }

    const execucao: ExecucaoDoHistorico = {
      instante_ms: instante,
      lado,
      quantidade: quantidade.valor,
      preco: preco.valor,
      taxa: taxa.valor,
      identidade_no_venue: {
        ...(identificador(f.oid) !== undefined ? { oid: identificador(f.oid) as string } : {}),
        ...(identificador(f.tid) !== undefined ? { tid: identificador(f.tid) as string } : {}),
        ...(texto(f.hash) !== undefined ? { hash: texto(f.hash) as string } : {}),
      },
    };

    // O resultado POR EXECUCAO do venue: campo proprio da leitura, e NAO se soma a nada.
    const resultado = decimal(`userFills[${coin}].closedPnl`, f.closedPnl);
    if (resultado.ok) {
      execucao.resultado_do_venue = resultado.valor;
      algumaComResultado = true;
    }

    // A referencia de cliente, na forma que o venue guardou: o `cloid` da propria execucao e, quando ela
    // o nao traz, o da ORDEM casada pelo `oid` no registo do venue. Sem `cloid`, nao ha referencia a ler —
    // e a referencia NAO se adivinha (o contrato di-lo opaca, e a derivacao e de mao unica).
    const oid = identificador(f.oid);
    const cloidCru = f.cloid === undefined || f.cloid === null ? undefined : f.cloid;
    if (cloidCru !== undefined && (typeof cloidCru !== "string" || !FORMA_DO_CLOID.test(cloidCru))) {
      return {
        ok: false,
        motivo: "formato_invalido",
        porque: `uma execucao de ${pedido.instrumento} trouxe \`cloid\` em ${JSON.stringify(cloidCru)}, que nao e a forma deste venue (0x + 32 hexadecimais): nao se serve uma referencia que nao se sabe ler`,
      };
    }
    const cloid = cloidCru !== undefined ? cloidCru : oid !== undefined ? cloidPorOid.get(oid) : undefined;
    if (cloid !== undefined && PADRAO_CORRELACAO.test(cloid)) {
      execucao.referencia_do_cliente = cloid;
    } else {
      algumaSemReferencia = true;
    }

    const dir = texto(f.dir);
    if (dir !== undefined) execucao.dir = dir;
    if (typeof f.crossed === "boolean") execucao.crossed = f.crossed;

    // A moeda da taxa: o venue ESCREVE-A (`feeToken`). Moedas que nao batem entre execucoes sao ditas.
    const moeda = texto(f.feeToken);
    if (moeda !== undefined) moedasVistas.add(moeda);

    maiorInstante = Math.max(maiorInstante, instante);
    execucoes.push(execucao);
  }

  if (execucoes.length === 0) {
    return {
      ok: false,
      motivo: "campo_obrigatorio_ausente",
      porque:
        `o venue respondeu ${todas.length} execucao(oes) da conta e NENHUMA do instrumento ${pedido.instrumento}: ` +
        "o contrato exige pelo menos uma, e uma linha vazia inventada seria pior do que a ausencia dita — " +
        "lista vazia NAO e «zero execucoes» (e uma ausencia, e diz-se)",
    };
  }

  // ---- as taxas DA CONTA (a tabela do venue; nao um total pago) -----------------------------------------
  const taxasDaConta = lerTaxasDaConta(respostas.taxas);

  // ---- o funding: o da CONTA e o PUBLICADO pelo venue ---------------------------------------------------
  const fundingDaConta = lerFundingDaConta(respostas.funding_da_conta, pedido.instrumento);
  const fundingPublicado = lerFundingPublicado(respostas.funding_publicado);

  // ---- a moeda, o resultado por instrumento e a marca ----------------------------------------------------
  // MEDIDO nesta conta (30 set 2026, so leitura): o venue escreve a moeda da taxa como `USDC` — QUATRO
  // letras, no `feeToken` das execucoes (cru e pelo SDK oficial). Ate a 1.4.0 a forma do contrato para
  // este campo era `^[A-Z]{3}$` (tres) e esta leitura ficava sem a poder ler; a emenda 1.5.0 alargou-a
  // a de TRES a CINCO letras, e a 1.6.0 alargou-a ao universo MEDIDO do venue (`^[A-Za-z0-9]{1,11}$`:
  // 1863 simbolos distintos, de 1 a 11 caracteres, com digitos e minusculas). O nome do venue continua a
  // NAO se normalizar: `USDC` nao e `USD`, e o unico dos 1863 que a forma nova recusa (`JPL `, com
  // espaco) continua a recusar — a banda para no alfanumerico de 1 a 11, e nao vai mais longe.
  const moedas = [...moedasVistas];
  const cabemNaForma = moedas.filter((m) => MOEDA.test(m));
  let moeda: Grandeza<string>;
  if (moedas.length === 1 && cabemNaForma.length === 1) {
    moeda = { estado: "lido", valor: moedas[0] as string, origem: ORIGENS_DO_HISTORICO.moeda as string };
  } else if (moedas.length === 0) {
    moeda = {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.moeda,
      porque:
        "as execucoes do venue nao declararam em que moeda a taxa e cobrada (`feeToken`): sem isso o contrato " +
        "nao aceita a carga, e nao se escreve uma moeda por nossa conta (a moeda nao se deduz do instrumento)",
    };
  } else if (moedas.length === 1) {
    moeda = {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.moeda,
      porque:
        `as execucoes do venue declaram a moeda da taxa como ${JSON.stringify(moedas[0])}, e a forma do contrato ` +
        "para este campo e de UM a ONZE caracteres alfanumericos, maiusculas ou minusculas (`^[A-Za-z0-9]{1,11}$`, " +
        "desde a emenda 1.6.0, que a mediu contra os 1863 simbolos do venue): a grandeza " +
        "fica DESCONHECIDA e o nome do venue NAO se normaliza para caber (escrever uma moeda que o venue nao " +
        "escreveu seria a mesa a corrigi-lo). O que a emenda alargou foi o que o venue deu; o resto continua a " +
        "recusar, e o motivo e dito pelo nome",
    };
  } else {
    moeda = {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.moeda,
      porque: `as execucoes do venue declaram moedas diferentes (${moedas.join(", ")}): escolher uma seria uma escolha nossa`,
    };
  }

  const resultadoRealizado: Grandeza<string> = {
    estado: "nao_publicado",
    origem: ORIGENS_DO_HISTORICO.resultado_realizado_do_instrumento,
    porque:
      "o venue publica o resultado realizado POR EXECUCAO (`closedPnl` em `userFills`) e NAO um numero por " +
      `instrumento: esta leitura leu ${execucoes.length} execucao(oes)` +
      (algumaComResultado ? ", cada uma com o resultado do venue em campo proprio" : "") +
      ". Somar essas parcelas para o apresentar como «o resultado do instrumento» seria RECONSTRUIR o " +
      "resultado — o defeito que FR-018/RN-H14 proibem (a conta da corretora nao e a soma das parcelas que " +
      "ela reporta). O resultado por instrumento fica DESCONHECIDO, e a mesa nao o recebe inventado",
  };

  const marcaDePosse: Grandeza<number> = {
    estado: "nao_publicado",
    origem: ORIGENS_DO_HISTORICO.marca_de_posse,
    porque:
      "este venue guarda a marca na forma `cloid` (0x + 32 hexadecimais, 128 bits — `cloid.ts`) e o contrato " +
      "declara a marca como INTEIRO de 31 bits (ficha << 19 | ciclo, em `contracts/vocabulario.json`): o inteiro " +
      "NAO esta dentro do `cloid`, porque a nossa derivacao e um hash da referencia de cliente. Medido nesta " +
      "conta: 415 de 415 ordens com `cloid` nulo e nenhuma execucao com `cloid`. Nao se converte uma coisa na " +
      "outra, e nao se escreve zero — zero pareceria uma marca medida",
  };

  if (moeda.estado === "nao_publicado") naoPublicados.push("historico.moeda");
  naoPublicados.push("historico.resultado_realizado");
  naoPublicados.push("historico.execucoes[].marca_de_posse");
  if (algumaSemReferencia) naoPublicados.push("historico.execucoes[].referencia_do_cliente");
  naoPublicados.push("historico.execucoes[].funding");

  return {
    ok: true,
    leitura: {
      conta: pedido.conta,
      instrumento: pedido.instrumento,
      moeda,
      instante_ms: maiorInstante,
      janela: {
        ...(pedido.inicio_ms !== undefined ? { inicio_ms: pedido.inicio_ms } : {}),
        nota:
          pedido.inicio_ms !== undefined
            ? `as execucoes foram pedidas a partir de ${pedido.inicio_ms} ms (a janela e do CHAMADOR, declarada no pedido)`
            : "o pedido nao declarou janela: leu-se o que o venue devolveu (as execucoes mais recentes da conta)",
      },
      execucoes,
      taxas_da_conta: taxasDaConta,
      funding_da_conta: fundingDaConta,
      funding_publicado: fundingPublicado,
      resultado_realizado_do_instrumento: resultadoRealizado,
      marca_de_posse: marcaDePosse,
      origens: { ...ORIGENS_DO_HISTORICO },
      nao_publicados: naoPublicados,
      notas: [
        "o trilho do dinheiro e o do VENUE: esta leitura nao calcula nenhum total — nem de taxas, nem de " +
          "funding, nem de resultado (FR-018/RN-H14: somar e do venue, nunca da mesa)",
        "`resultado_do_venue` de cada execucao e o `closedPnl` do venue, POR EXECUCAO, e nao se soma a nada; " +
          "ele NAO entra na carga do contrato, que nao tem campo de resultado por execucao — e tem-no de proposito",
        "uma grandeza do contrato que o venue nao publica fica `nao_publicado`, pelo nome, com a razao: nunca " +
          "zero, nunca um valor plausivel vindo da documentacao",
      ],
    },
  };
}

function lerTaxasDaConta(resposta: Resposta | undefined): Grandeza<TaxasDaConta> {
  const raiz = objecto(veio(resposta));
  if (raiz === undefined) {
    return {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.taxas_da_conta,
      porque: `${razaoDaFalha(resposta, "userFees")} — sem a tabela da conta nao se sabe a taxa DELA, e a taxa de tabela publica nao se escreve por nossa conta (RN-C1)`,
    };
  }
  const tabela = objecto(raiz.feeSchedule);
  const nao_lidos: string[] = [];
  const taxas: TaxasDaConta = {
    nota:
      "a TABELA de taxas desta conta, como o venue a declara. NAO e um total pago: o venue publica a taxa de " +
      "cada execucao (`fee`) e a tabela da conta — um total seria uma conta nossa, e nao se faz (FR-018)",
  };
  const cruzamento = decimal("userFees.userCrossRate", raiz.userCrossRate);
  if (cruzamento.ok) taxas.taxa_de_cruzamento = cruzamento.valor;
  const adicao = decimal("userFees.userAddRate", raiz.userAddRate);
  if (adicao.ok) taxas.taxa_de_adicao = adicao.valor;
  if (tabela !== undefined) {
    const t: { cruzamento?: string; adicao?: string } = {};
    const c = decimal("userFees.feeSchedule.cross", tabela.cross);
    if (c.ok) t.cruzamento = c.valor;
    const a = decimal("userFees.feeSchedule.add", tabela.add);
    if (a.ok) t.adicao = a.valor;
    if (t.cruzamento !== undefined || t.adicao !== undefined) taxas.tabela = t;
  }
  const referencia = decimal("userFees.activeReferralDiscount", raiz.activeReferralDiscount);
  if (referencia.ok) taxas.desconto_de_referencia = referencia.valor;
  const staking = decimal("userFees.activeStakingDiscount", raiz.activeStakingDiscount);
  if (staking.ok) {
    taxas.desconto_de_staking = staking.valor;
  } else if (raiz.activeStakingDiscount !== undefined && raiz.activeStakingDiscount !== null) {
    // O venue declara o desconto de staking como OBJECTOS (`{bpsOfMaxSupply, discount}`, medido), e nao como o
    // decimal que o contrato pede. Nao se achata nem se escolhe um dos dois: diz-se que nao se leu.
    nao_lidos.push(`userFees.activeStakingDiscount (veio em ${typeof raiz.activeStakingDiscount}, e nao em decimal textual)`);
  }
  if (nao_lidos.length > 0) {
    taxas.nota +=
      ". Nao se leu, e di-lo: " + nao_lidos.join("; ") + " — nao se achata o que o venue declara de outra forma";
  }

  if (
    taxas.taxa_de_cruzamento === undefined &&
    taxas.taxa_de_adicao === undefined &&
    taxas.tabela === undefined &&
    taxas.desconto_de_referencia === undefined &&
    taxas.desconto_de_staking === undefined
  ) {
    return {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.taxas_da_conta,
      porque: "o venue respondeu `userFees` num objecto sem nenhuma das taxas declaradas (userCrossRate/userAddRate/feeSchedule): nao se escreve uma taxa por nossa conta",
    };
  }
  return { estado: "lido", valor: taxas, origem: ORIGENS_DO_HISTORICO.taxas_da_conta as string };
}

function lerFundingDaConta(resposta: Resposta | undefined, instrumento: string): Grandeza<FundingDaConta[]> {
  const itens = lista(veio(resposta));
  if (itens === undefined) {
    return {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.funding_da_conta,
      porque: `${razaoDaFalha(resposta, "userFunding")} — o funding da conta fica DESCONHECIDO, e uma leitura falhada nunca vira zero`,
    };
  }
  const lidos: FundingDaConta[] = [];
  let ilegiveis = 0;
  for (const item of itens) {
    const o = objecto(item);
    const delta = objecto(o?.delta);
    const coin = texto(delta?.coin);
    const instante = numero(o?.time);
    const valor = decimal("userFunding[].delta.usdc", delta?.usdc);
    if (coin === undefined || instante === undefined || !valor.ok) {
      // Uma entrada que nao se le NAO se inventa nem se salta em silencio: conta-se e diz-se.
      ilegiveis += 1;
      continue;
    }
    if (coin !== instrumento) continue;
    const taxa = decimal("userFunding[].delta.fundingRate", delta?.fundingRate);
    const hash = texto(o?.hash);
    lidos.push({
      instrumento: coin,
      instante_ms: instante,
      valor: valor.valor,
      ...(taxa.ok ? { taxa: taxa.valor } : {}),
      ...(hash !== undefined ? { hash } : {}),
    });
  }
  return {
    estado: "lido",
    valor: lidos,
    origem: ORIGENS_DO_HISTORICO.funding_da_conta as string,
    nota:
      `o venue devolveu ${itens.length} actualizacao(oes) de funding da CONTA e esta leitura mostra as deste ` +
      `instrumento (${lidos.length}); o venue nao publica um total, e nenhum total e calculado aqui` +
      (ilegiveis > 0
        ? `. ${ilegiveis} entrada(s) NAO eram legiveis e NAO foram inventadas nem somadas — ficam ditas como nao lidas`
        : ""),
  };
}

function lerFundingPublicado(resposta: Resposta | undefined): Grandeza<{ ponta: FundingPublicado[]; periodos_no_venue: number; nota: string }> {
  const itens = lista(veio(resposta));
  if (itens === undefined) {
    return {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.funding_publicado,
      porque: `${razaoDaFalha(resposta, "fundingHistory")} — sem a taxa publicada nao se sabe o funding do periodo, e nao se escreve uma taxa por nossa conta (RN-C1)`,
    };
  }
  const todos: FundingPublicado[] = [];
  for (const item of itens) {
    const o = objecto(item);
    const taxa = decimal("fundingHistory[].fundingRate", o?.fundingRate);
    const instante = numero(o?.time);
    if (!taxa.ok || instante === undefined) continue;
    todos.push({ instante_ms: instante, taxa: taxa.valor });
  }
  if (todos.length === 0) {
    return {
      estado: "nao_publicado",
      origem: ORIGENS_DO_HISTORICO.funding_publicado,
      porque:
        itens.length === 0
          ? "o venue respondeu uma lista VAZIA de `fundingHistory` para este instrumento: nao publicou nenhuma taxa. " +
            "Uma lista vazia e uma DECLARACAO do venue — nao e zero, e nao se escreve zero por ela"
          : `o venue respondeu ${itens.length} entrada(s) de \`fundingHistory\` e nenhuma era legivel (sem \`time\` ou sem \`fundingRate\`): a taxa publicada fica desconhecida, e nao se inventa a que falta`,
    };
  }
  const PONTA = 5;
  return {
    estado: "lido",
    origem: ORIGENS_DO_HISTORICO.funding_publicado as string,
    valor: {
      ponta: todos.slice(-PONTA),
      periodos_no_venue: todos.length,
      nota:
        `o venue devolveu ${todos.length} periodos de funding deste instrumento; esta leitura guarda a PONTA ` +
        `(os ${Math.min(PONTA, todos.length)} mais recentes) e CONTA o que veio — a serie inteira nao entra, e ` +
        "o contrato nao tem campo para ela. Nenhum total de funding e calculado aqui",
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// A CARGA DO CONTRATO — o mapeamento mecanico, sem decidir nada.
//
// O que sai daqui vai tal e qual para o envelope `historico`, e quem julga se esta completo e O ESQUEMA DO
// CONTRATO (a validacao do processo). Onde o venue nao deu a grandeza, a CHAVE NAO E ESCRITA: uma chave
// ausente e o que o contrato chama ausencia (D4) — e `null` nao existe.
// ---------------------------------------------------------------------------------------------------------

export function cargaDoHistorico(leitura: LeituraDoHistorico): Record<string, unknown> {
  const carga: Record<string, unknown> = {
    instrumento: leitura.instrumento,
    instante_ms: leitura.instante_ms,
  };
  if (leitura.moeda.estado === "lido") carga.moeda = leitura.moeda.valor;
  if (leitura.resultado_realizado_do_instrumento.estado === "lido") {
    carga.resultado_realizado = leitura.resultado_realizado_do_instrumento.valor;
  }
  carga.execucoes = leitura.execucoes.map((e) => {
    const linha: Record<string, unknown> = {
      instante_ms: e.instante_ms,
      lado: e.lado,
      quantidade: e.quantidade,
      preco: e.preco,
      taxa: e.taxa,
    };
    // `marca_de_posse` NAO entra, e a razao mudou de forma na 1.5.0 sem mudar de sentido: o contrato
    // passou a admitir as DUAS formas que o manifesto pode declarar (o inteiro de 31 bits e o `cloid`),
    // mas este venue nao guardou marca NENHUMA nesta conta (415 de 415 ordens com `cloid` nulo, medido).
    // Como nao ha, nao se escreve — e nao se escreve zero (zero pareceria uma marca medida).
    if (e.referencia_do_cliente !== undefined) linha.referencia_do_cliente = e.referencia_do_cliente;
    // `funding` por execucao NAO entra: este venue nao o reporta por execucao, e o contrato declara-o
    // OPCIONAL por execucao (1.5.0, com a ausencia declarada) — ausente e o que ele chama «o venue nao
    // o reporta». Zero seria um custo medido, e nao ha nenhum a medir.
    // `resultado_do_venue` NAO entra: o contrato nao tem campo de resultado por execucao (de proposito),
    // e a fonte declarada do resultado por instrumento e POR EXECUCAO (`closedPnl`) — somar e proibido.
    return linha;
  });
  return carga;
}
