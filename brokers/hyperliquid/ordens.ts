// A TRADUCAO DE ORDENS do conector Hyperliquid — da boleta (unidades neutras) para a accao do venue.
//
// O QUE ESTE FICHEIRO E: uma funcao PURA que recebe a boleta, o manifesto sondado, o saldo da conta e o preco
// do venue (estes dois ULTIMOS sao LIDOS do venue e entregues como DADO) e devolve a ordem que o venue aceita —
// ou uma RECUSA NOMEADA. Sem rede, sem ficheiro, sem relogio: corre offline, e por isso os casos dele correm
// sempre, com ou sem credencial.
//
// AS TRES REGRAS QUE MUDAM FACE AO MOTOR ANTIGO (docs/regra-de-negocio-conector.md §1):
//   1. NADA se ajusta em silencio. O preco obedece a regra do venue (no maximo 5 algarismos significativos e no
//      maximo `6 - szDecimals` casas decimais; preco INTEIRO e sempre aceite) e, se nao couber, RECUSA com
//      motivo — nunca se arredonda o preco para o fazer caber (RN-H4, RN-H5, FR-007). O preco aceito sai
//      devolvido EXACTAMENTE como entrou.
//   2. A ALAVANCAGEM e QUALQUER inteiro de 1 ate `alavancagem_maxima` do instrumento — nao so os degraus que o
//      outro motor oferecia. Nao inteira, ou acima do maximo, RECUSA e diz o maximo (RN-H6, FR-008).
//   3. A REFERENCIA DE CLIENTE nao vai crua para o venue: vira `cloid` de 128 bits por derivacao PURA — a mesma
//      referencia da sempre o mesmo `cloid`, e e isso que faz o reenvio nao duplicar (RN-H9, FR-011).
//
// O QUE ELE NAO FAZ: nao decide se se opera, nem o lado, nem o tamanho, nem o momento (RN-C5, RN-C15); nao le
// estrategia, mandato nem fichas; nao julga risco. Nao importa o `core` (RN-E1).
//
// O TAMANHO: a quantidade calculada e ajustada AO PASSO por BAIXO (RN-H4 — o venue negoceia em passos de
// `10^-szDecimals`). Ajustar por baixo nunca aumenta o risco do dono; ajustar por CIMA aumentaria, e por isso
// nao se faz. O valor ajustado vai DECLARADO na resposta — nunca escondido. Abaixo do minimo do instrumento ou
// do valor minimo por ordem do venue, RECUSA (RN-H5).
//
// O QUE NAO EXISTE AQUI: nenhum valor do venue escrito no codigo. O valor minimo por ordem, o passo, o tick e a
// alavancagem maxima vem do MANIFESTO (sondado a cada arranque, FR-001). A unica constante de regra e a da
// documentacao oficial do venue (5 algarismos significativos no preco, RN-H4), declarada e nomeada abaixo; o
// numero de casas decimais do preco NAO se digita: sai do `tick`, que o manifesto declara.

import { derivarCloid } from "./cloid.ts";

export type Recusa = { ok: false; motivo: string; porque: string };
export type Feito = { ok: true; accao: AccaoDoVenue };
export type Resultado = Feito | Recusa;

/** Os TIF do venue, conjunto FECHADO: `Alo` e Add Liquidity Only (o post-only) e `Ioc` e Immediate-or-Cancel. */
export const TIFS_DO_VENUE = ["Alo", "Ioc"] as const;
export type Tif = (typeof TIFS_DO_VENUE)[number];

/** A unidade do instrumento, como o manifesto a declara. Nenhum destes numeros e nosso. */
export type UnidadeDoManifesto = {
  simbolo: string;
  minimo: string;
  passo: string;
  tick: string;
  alavancagem_maxima: string;
};

/** A parte do manifesto que esta traducao consome. O manifesto inteiro (contracts/manifesto.schema.json) e maior. */
export type ManifestoDoVenue = {
  instrumentos: UnidadeDoManifesto[];
  tipos_de_ordem: string[];
  parcial_suportada: string[];
  sabe_ajustar_alavancagem: boolean;
  reduce_only_suportado: boolean;
  idempotencia: boolean;
  marca_de_posse: string;
  /**
   * O PISO de valor por ordem do venue: ABAIXO dele o venue RECUSA a ordem.
   *
   * O nome e o do contrato (`contracts/manifesto.schema.json`): ate a 1.4.0 este valor viajava em
   * `teto_de_valor_por_ordem`, um nome que MENTIA — carregava o MINIMO (§5.d da regra de negocio:
   * «Order must have minimum value of $10») e era lido como tecto. A emenda 1.4.0 renomeou-o; esta
   * traducao le-o pelo nome novo, e recusa abaixo dele (igual ao piso PASSA).
   */
  minimo_de_valor_por_ordem: string;
};

/** A boleta do contrato (contracts/boleta.schema.json), em unidades NEUTRAS. Nao se altera — traduz-se. */
export type Boleta = {
  instrumento: string;
  lado: string;
  tipo: string;
  saldo_pct: string;
  alavancagem: string;
  parcial: string;
  desvio_maximo: string;
  prazo_da_passiva_ms: number;
  destino_do_resto: string;
  reduce_only: boolean;
  /** A VIRADA (1.10.0): `true` faz esta traducao somar a posicao viva a' quantidade nova (ver a porta 8). */
  reverter: boolean;
  /**
   * O TAMANHO RELATIVO A' POSICAO VIVA (1.11.0, D-013), OBRIGATORIO no contrato (D4): `1` = a posicao inteira
   * (= nao e' uma reducao parcial); abaixo de `1` = essa fraccao do que esta' aberto. Quem a converte em
   * quantidade e' esta traducao, com a posicao viva que o VENUE publica.
   */
  posicao_pct: string;
  referencia_do_cliente: string;
  marca_de_posse: number;
};

/** O pedido: a boleta + o manifesto + os dois numeros que SO o conector tem (lidos do venue). */
export type Pedido = {
  conta: string;
  boleta: Boleta;
  manifesto: ManifestoDoVenue;
  /** Equity da conta, decimal textual — LIDO do venue, nunca calculado por nos. */
  saldo: string;
  /** Preco de referencia/limite, decimal textual — LIDO do venue (marca ou cotacao). */
  preco: string;
  /**
   * A POSICAO VIVA, quando a boleta pede a virada (`reverter: true`) — a quantidade em unidades neutras, LIDA do
   * venue pelo conector. A mesa nao a calcula (RN-B0) e nao a manda na boleta: e' entrada desta traducao, como o
   * `saldo` e o `preco`, e vem so' do que o venue disse.
   */
  posicao_a_reverter?: string;
  /** O LADO da posicao viva — para a virada recusar quando nao ha nada a virar (a posicao ja' esta' do lado). */
  lado_da_posicao?: string;
  /**
   * A POSICAO VIVA, em unidades neutras, LIDA do venue — a mesma que `posicao_a_reverter` (a virada le'-a para
   * saber o que fechar; a REDUCAO PARCIAL le'-a para saber de quanto e' a fraccao). Como o `saldo` e o `preco`,
   * e' DADO entregue a esta traducao: a mesa nao a calcula (RN-B0) e nao a manda na boleta.
   */
  posicao_viva?: string;
};

/** A accao que o venue aceita, ja traduzida. NAO leva a referencia de cliente crua — leva o `cloid`. */
export type AccaoDoVenue = {
  instrumento: string;
  lado: "buy" | "sell";
  tipo: "mercado" | "limite";
  tif: Tif;
  quantidade: string;
  /** O preco QUE VAI PARA O VENUE. No `limite` e', caracter a caracter, o da boleta; no `mercado` e' o mais
   *  agressivo que o `desvio_maximo` declarado permite, quantizado a regra de preco do venue SEM sair da banda. */
  preco: string;
  /** O preco de REFERENCIA lido do venue (a marca) — a regua de que o desvio foi medido (RN-B11). */
  preco_de_referencia: string;
  /** O desvio declarado na boleta, em percentagem de movimento — [C], nunca um numero nosso. */
  desvio_maximo: string;
  nocional: string;
  alavancagem: string;
  reduce_only: boolean;
  /** A VIRADA: a ordem que sai tem de FECHAR o que esta' aberto e ABRIR o novo, num so' envio (netting). */
  reverter: boolean;
  cloid: string;
};

// ---------------------------------------------------------------------------------------------------------
// Formas do contrato (contracts/_defs/forma.schema.json) e regra de preco do venue (RN-H4).
// ---------------------------------------------------------------------------------------------------------

const PADRAO_DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const PADRAO_DECIMAL_POSITIVO = /^(0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$/;
const PADRAO_INTEIRO_POSITIVO = /^[1-9][0-9]*$/;
const PADRAO_INSTRUMENTO = /^[A-Z0-9][A-Z0-9._/-]{1,31}$/;
const PADRAO_CORRELACAO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

/**
 * A regra de preco do venue, lida na documentacao oficial (RN-H4): no maximo 5 algarismos significativos e no
 * maximo `6 - szDecimals` casas decimais; preco INTEIRO e sempre aceite (o venue aceita `123456` e recusa
 * `12345.6`). O numero de casas aceites NAO se digita: sai do `tick` declarado no manifesto, que e
 * `10^-(6-szDecimals)` — logo `decimais(tick) == 6 - szDecimals`.
 */
const ALGARISMOS_SIGNIFICATIVOS_DO_PRECO = 5;

/** A ordem em que as portas sao conferidas — o motivo que o dono le e o da PRIMEIRA que falha. */
export const ORDEM_DAS_PORTAS = [
  "forma_dos_campos",
  "instrumento_no_manifesto",
  "capacidades_declaradas",
  "alavancagem_inteira_no_intervalo",
  "referencia_vira_cloid",
  "preco_cabe_na_regra_do_venue",
  "quantidade_e_minimos",
] as const;

/** A traducao tipo-neutral -> (tipo, TIF) do venue. Onde nao houver par, RECUSA — nunca improvisa. */
const TRADUCAO_DE_TIPO: Record<string, { tipo: "mercado" | "limite"; tif: Tif }> = {
  mercado: { tipo: "mercado", tif: "Ioc" },
  limite: { tipo: "limite", tif: "Alo" },
};

function recusa(motivo: string, porque: string): Recusa {
  return { ok: false, motivo, porque };
}

function exigirTexto(valor: unknown, nome: string): { ok: true; valor: string } | Recusa {
  if (valor === undefined) return recusa("campo_obrigatorio_ausente", `falta ${nome} — a ausencia nao se preenche com valor neutro (D4)`);
  if (valor === null) return recusa("valor_nulo_nao_permitido", `${nome} veio a null, e null nao existe no contrato (D4)`);
  if (typeof valor !== "string") return recusa("tipo_invalido", `${nome} tem de ser texto, e veio ${typeof valor}`);
  return { ok: true, valor };
}

// ---------------------------------------------------------------------------------------------------------
// Aritmetica em DECIMAL TEXTUAL com BigInt: nunca virgula flutuante (D4 — dinheiro nao e float).
// ---------------------------------------------------------------------------------------------------------

function decimais(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** O valor escalado: `"12.34"` -> `1234n` (escala 2). Trabalha-se sempre com inteiros escalados. */
function escalado(s: string): bigint {
  const i = s.indexOf(".");
  return i < 0 ? BigInt(s) : BigInt(s.slice(0, i) + s.slice(i + 1));
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Escreve um inteiro escalado como decimal textual do contrato, sem zeros a direita (valor identico). */
function formatar(valor: bigint, escala: number): string {
  if (escala === 0) return valor.toString();
  const dig = valor.toString().padStart(escala + 1, "0");
  const inteiro = dig.slice(0, dig.length - escala);
  const fracao = dig.slice(dig.length - escala).replace(/0+$/, "");
  return fracao === "" ? inteiro : `${inteiro}.${fracao}`;
}

/** Algarismos significativos de um decimal textual: zeros a esquerda nao contam. */
function algarismosSignificativos(s: string): number {
  return s.replace(".", "").replace(/^0+/, "").length;
}

/**
 * A COMPARACAO EXACTA de dois decimais textuais NAO NEGATIVOS, sem virgula flutuante.
 *
 * Existe para a reducao parcial (1.11.0): «`posicao_pct` esta' abaixo de `1`?» e' uma pergunta de LIMITE, e um
 * limite comparado em `Number()` e' o defeito seguinte — `0.1 + 0.2 > 0.3` ja' decidiu quem ficava de fora na
 * fila da contenda (T066) e aqui decide quanto da posicao se fecha. As escalas alinham-se multiplicando, que e'
 * exacto em inteiros.
 */
function compararDecimais(a: string, b: string): number {
  const escalaA = decimais(a);
  const escalaB = decimais(b);
  const escala = Math.max(escalaA, escalaB);
  const x = escalado(a) * pow10(escala - escalaA);
  const y = escalado(b) * pow10(escala - escalaB);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * O preco cabe na regra do venue? So o preco INTEIRO escapa aos 5 algarismos significativos (o venue aceita
 * inteiros sempre); as casas decimais sao as do `tick`, para qualquer preco.
 */
function cabeNoPreco(preco: string, tick: string): { cabe: boolean; porque: string } {
  const casas = decimais(preco);
  const casasAceitas = decimais(tick);
  if (casas === 0) return { cabe: true, porque: "preco inteiro: o venue aceita sempre" };
  if (casas > casasAceitas) {
    return {
      cabe: false,
      porque: `o venue aceita no maximo ${casasAceitas} casa(s) decimal(is) neste instrumento (tick ${tick}) e o preco ${preco} tem ${casas}`,
    };
  }
  const significativos = algarismosSignificativos(preco);
  if (significativos > ALGARISMOS_SIGNIFICATIVOS_DO_PRECO) {
    return {
      cabe: false,
      porque: `o venue aceita no maximo ${ALGARISMOS_SIGNIFICATIVOS_DO_PRECO} algarismos significativos no preco e o preco ${preco} tem ${significativos}`,
    };
  }
  return { cabe: true, porque: `${significativos} algarismo(s) significativo(s) e ${casas} casa(s) decimal(is)` };
}

// ---------------------------------------------------------------------------------------------------------
// A traducao.
// ---------------------------------------------------------------------------------------------------------

export function traduzirOrdem(pedido: Pedido): Resultado {
  const boleta = (pedido as unknown as { boleta?: unknown })?.boleta;
  if (boleta === undefined || boleta === null || typeof boleta !== "object") {
    return recusa("campo_obrigatorio_ausente", "sem boleta nao ha pedido a traduzir");
  }
  const b = boleta as Record<string, unknown>;

  // ---- porta 1: a forma dos campos que este ficheiro consome -------------------------------------------------
  const instrumentoR = exigirTexto(b.instrumento, "boleta.instrumento");
  if (!instrumentoR.ok) return instrumentoR;
  const instrumento = instrumentoR.valor;
  if (!PADRAO_INSTRUMENTO.test(instrumento)) {
    return recusa("formato_invalido", `o instrumento ${JSON.stringify(instrumento)} nao tem a forma do contrato`);
  }

  const ladoR = exigirTexto(b.lado, "boleta.lado");
  if (!ladoR.ok) return ladoR;
  if (ladoR.valor !== "buy" && ladoR.valor !== "sell") {
    return recusa("valor_fora_do_conjunto", `a traducao so conhece buy e sell; veio ${JSON.stringify(ladoR.valor)}`);
  }
  const lado: "buy" | "sell" = ladoR.valor;

  const tipoR = exigirTexto(b.tipo, "boleta.tipo");
  if (!tipoR.ok) return tipoR;
  const tipo = tipoR.valor;

  const parcialR = exigirTexto(b.parcial, "boleta.parcial");
  if (!parcialR.ok) return parcialR;
  const parcial = parcialR.valor;

  const referenciaR = exigirTexto(b.referencia_do_cliente, "boleta.referencia_do_cliente");
  if (!referenciaR.ok) return referenciaR;
  const referencia = referenciaR.valor;
  if (!PADRAO_CORRELACAO.test(referencia)) {
    return recusa("formato_invalido", `a referencia_do_cliente ${JSON.stringify(referencia)} nao tem a forma do contrato`);
  }

  const saldoPctR = exigirTexto(b.saldo_pct, "boleta.saldo_pct");
  if (!saldoPctR.ok) return saldoPctR;
  const saldo_pct = saldoPctR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(saldo_pct)) {
    return recusa("formato_invalido", `saldo_pct tem de ser decimal textual estritamente positivo, e veio ${JSON.stringify(saldo_pct)}`);
  }

  const alavancagemR = exigirTexto(b.alavancagem, "boleta.alavancagem");
  if (!alavancagemR.ok) return alavancagemR;
  const alavancagem = alavancagemR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(alavancagem)) {
    return recusa("formato_invalido", `alavancagem tem de ser decimal textual estritamente positivo, e veio ${JSON.stringify(alavancagem)}`);
  }

  if (b.reduce_only === undefined) return recusa("campo_obrigatorio_ausente", "falta boleta.reduce_only");
  if (b.reduce_only === null) return recusa("valor_nulo_nao_permitido", "boleta.reduce_only veio a null (D4)");
  if (typeof b.reduce_only !== "boolean") return recusa("tipo_invalido", `boleta.reduce_only tem de ser booleano, e veio ${typeof b.reduce_only}`);
  const reduce_only = b.reduce_only;

  // A VIRADA (1.10.0). Obrigatoria (D4: a ausencia nao e' um valor — «nao e' reversao» e' `false`, e a ausencia
  // diria «nao foi declarado»), e com a unica combinacao impossivel recusada a' porta: `reverter` e `reduce_only`
  // dizem coisas OPOSTAS sobre a mesma ordem. Escolher uma por precedencia seria a mesa a decidir em lugar do
  // dono — quem recusa e' a traducao, e nomeia as duas.
  if (b.reverter === undefined) return recusa("campo_obrigatorio_ausente", "falta boleta.reverter");
  if (b.reverter === null) return recusa("valor_nulo_nao_permitido", "boleta.reverter veio a null (D4)");
  if (typeof b.reverter !== "boolean") return recusa("tipo_invalido", `boleta.reverter tem de ser booleano, e veio ${typeof b.reverter}`);
  const reverter = b.reverter;
  if (reverter && reduce_only) {
    return recusa(
      "reversao_com_reduce_only",
      "a boleta pede `reverter: true` e `reduce_only: true` na mesma ordem: «inverte» e «reduz, nunca inverte» " +
        "nao cabem juntas, e nao se resolve por precedencia",
    );
  }

  // O TAMANHO RELATIVO A' POSICAO VIVA (1.11.0, D-013). Obrigatorio (D4: «nao e' parcial» e' `1`, um valor
  // DECLARADO — a ausencia diria «nao foi declarado»), e com as DUAS declaracoes da reducao parcial conferidas
  // AQUI, antes de existir qualquer quantidade:
  //
  //   * acima de `1` RECUSA (`valor_fora_da_banda`): uma ordem nao reduz mais do que a posicao que existe;
  //   * abaixo de `1` e' uma REDUCAO PARCIAL, e exige `reduce_only: true` (`reducao_parcial_sem_reduce_only`):
  //     as duas declaracoes diriam coisas opostas sobre a mesma ordem, e nao se resolve por precedencia. (A
  //     VIRADA nunca chega aqui: `reverter: true` com `reduce_only: true` ja' recusou acima, logo uma virada com
  //     `posicao_pct` abaixo de `1` cai nesta mesma regra — uma virada nao e' uma reducao parcial.)
  const posicaoPctR = exigirTexto(b.posicao_pct, "boleta.posicao_pct");
  if (!posicaoPctR.ok) return posicaoPctR;
  const posicao_pct = posicaoPctR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(posicao_pct)) {
    return recusa("formato_invalido", `posicao_pct tem de ser decimal textual estritamente positivo, e veio ${JSON.stringify(posicao_pct)}`);
  }
  const comparacaoComInteiro = compararDecimais(posicao_pct, "1");
  if (comparacaoComInteiro > 0) {
    return recusa(
      "valor_fora_da_banda",
      `posicao_pct vem ${posicao_pct}: acima de 1 uma ordem reduziria mais do que a posicao que existe, e a ` +
        "quantidade vem da posicao — recusa, em vez de a cortar por conta propria",
    );
  }
  const reducaoParcial = comparacaoComInteiro < 0;
  if (reducaoParcial && reduce_only !== true) {
    return recusa(
      "reducao_parcial_sem_reduce_only",
      `a boleta pede uma reducao PARCIAL (posicao_pct ${posicao_pct}) e nao declara reduce_only: uma fraccao da ` +
        "posicao e' uma reducao, e quem reduz nunca inverte — as duas declaracoes teriam de dizer a mesma coisa",
    );
  }

  const contaR = exigirTexto((pedido as unknown as Record<string, unknown>)?.conta, "conta");
  if (!contaR.ok) return contaR;
  const conta = contaR.valor;

  const saldoR = exigirTexto((pedido as unknown as Record<string, unknown>)?.saldo, "saldo");
  if (!saldoR.ok) return saldoR;
  const saldo = saldoR.valor;
  if (!PADRAO_DECIMAL.test(saldo)) {
    return recusa("formato_invalido", `saldo tem de ser decimal textual nao negativo, e veio ${JSON.stringify(saldo)}`);
  }

  const precoR = exigirTexto((pedido as unknown as Record<string, unknown>)?.preco, "preco");
  if (!precoR.ok) return precoR;
  const preco = precoR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(preco)) {
    return recusa("formato_invalido", `preco tem de ser decimal textual estritamente positivo, e veio ${JSON.stringify(preco)}`);
  }

  const manifesto = (pedido as unknown as { manifesto?: unknown })?.manifesto;
  if (manifesto === undefined || manifesto === null || typeof manifesto !== "object") {
    return recusa("campo_obrigatorio_ausente", "sem manifesto nao ha unidades declaradas e nao ha traducao");
  }
  const m = manifesto as Record<string, unknown>;

  // ---- porta 2: o instrumento existe no manifesto (sem unidade nao ha traducao) ------------------------------
  const instrumentos = m.instrumentos;
  if (!Array.isArray(instrumentos)) {
    return recusa("campo_obrigatorio_ausente", "o manifesto nao declara `instrumentos`");
  }
  const unidade = (instrumentos as UnidadeDoManifesto[]).find((u) => u?.simbolo === instrumento);
  if (!unidade) {
    return recusa("instrumento_desconhecido_no_manifesto", `o instrumento ${instrumento} nao consta das unidades declaradas pelo conector`);
  }
  for (const campo of ["minimo", "passo", "tick", "alavancagem_maxima"] as const) {
    const valor = unidade[campo];
    if (typeof valor !== "string" || !PADRAO_DECIMAL_POSITIVO.test(valor)) {
      return recusa("campo_obrigatorio_ausente", `o manifesto nao declara ${campo} para ${instrumento}`);
    }
  }

  // ---- porta 3: as capacidades que a boleta pede estao DECLARADAS no manifesto (RN-C7) ----------------------
  const tipos = m.tipos_de_ordem;
  if (!Array.isArray(tipos) || !(tipos as string[]).includes(tipo)) {
    return recusa("capacidade_nao_declarada", `o manifesto nao declara o tipo de ordem ${JSON.stringify(tipo)}`);
  }
  const par = TRADUCAO_DE_TIPO[tipo];
  if (!par) {
    return recusa("capacidade_nao_declarada", `este conector nao sabe traduzir o tipo ${JSON.stringify(tipo)} para Alo/Ioc — recusa, nao improvisa`);
  }

  const parciais = m.parcial_suportada;
  if (!Array.isArray(parciais) || !(parciais as string[]).includes(parcial)) {
    return recusa("capacidade_nao_declarada", `o manifesto nao declara a politica de parcial ${JSON.stringify(parcial)}`);
  }

  if (m.marca_de_posse !== "cloid") {
    return recusa("capacidade_nao_declarada", `o manifesto declara a marca de posse ${JSON.stringify(m.marca_de_posse)} e este conector so sabe derivar cloid`);
  }

  if (reduce_only === true && m.reduce_only_suportado !== true) {
    return recusa(
      "capacidade_nao_declarada",
      "a boleta pede reduce_only e o manifesto nao declara `reduce_only_suportado`: recusa, em vez de mandar um reduce-only que o venue pode ignorar",
    );
  }

  // ---- porta 3-bis: O STOP E O TP TEM DE SAIR OU RECUSAR — nunca sair sem eles (29/09/2026) ---------------
  //
  // MEDIDO (bateria de teste, P10): a boleta com `stop_pct`/`tp_pct` produzia um payload IDENTICO ao de uma
  // boleta sem nada disso — o campo era aceite pela validacao e nao chegava a lado nenhum. O stop VEM DO SETUP
  // (RN-S11) e e' a proteccao que o dono autorizou: uma ordem que sai sem ele, em silencio, deixa a mesa a
  // acreditar numa proteccao que nao existe. E' o FR-007 — nada se adapta em silencio.
  //
  // A RECUSA e' o estado de hoje, e e' deliberada: este conector NAO sabe ainda mandar o stop. O venue TEM o
  // verbo (medido nos tipos do SDK: `t: { trigger: { tpsl: "tp"|"sl", triggerPx, isMarket } }`), e o manifesto
  // declara se ele prende o stop a' ordem (`stop_anexo`). Enquanto a ordem trigger nao for implementada — com o
  // cancelamento que ela exige para nao deixar ordem a descansar, D-012 — a resposta honesta e' esta: recusar
  // COM NOME, em vez de entregar uma posicao desprotegida a quem pediu proteccao.
  for (const campo of ["stop_pct", "tp_pct"] as const) {
    const pedido = (boleta as Record<string, unknown>)[campo];
    if (pedido === undefined) continue;
    return recusa(
      "capacidade_nao_declarada",
      `a boleta pede \`${campo}\` e este conector NAO manda stop nenhum: o venue declara ` +
        `\`stop_anexo: ${JSON.stringify(m.stop_anexo)}\` e o verbo que existe nele e' a ordem \`trigger\` (tpsl), que ainda nao ` +
        `esta implementada. Recusa nomeada, e nao uma posicao que sai desprotegida — a mesa ficaria a acreditar ` +
        `numa proteccao que nao existe (FR-007)`,
    );
  }

  // ---- porta 3-ter: o `destino_do_resto` nao vira recusa — a razao, medida, esta' escrita aqui ------------
  //
  // MEDIDO (P10 da bateria): `cancelar` e `agressivo` produziam o MESMO payload. A primeira leitura disto foi
  // "silêncio, recusa-se". Foi CORRIGIDA pela medicao seguinte (a bancada das ordens, 22 de 40 casos vermelhos de
  // uma vez): para o UNICO tipo alcancavel depois do D-012 (`mercado`, tif `Ioc`), o resto NAO existe — o `Ioc`
  // cancela o que nao encheu, e portanto `cancelar` esta' HONRADO pelo proprio TIF, por construcao. O que fica
  // por honrar e' o `agressivo` (nao ha nada que persiga o resto) e o par no tipo `limite` (`Alo`, que descansa) —
  // esse e' inalcancavel enquanto o D-012 recusar o `limite`. Nao se inventa uma recusa para um campo que o
  // venue cumpre por outra via: isso trocaria um silencio por um bloqueio, e a matriz da cobertura diz qual dos
  // dois casos e' qual.

  // ---- porta 4: a alavancagem e QUALQUER inteiro de 1 ate ao maximo do instrumento (RN-H6) -------------------
  if (m.sabe_ajustar_alavancagem !== true) {
    return recusa("capacidade_nao_declarada", "a boleta pede alavancagem e o manifesto nao declara `sabe_ajustar_alavancagem`");
  }
  if (!PADRAO_INTEIRO_POSITIVO.test(alavancagem)) {
    return recusa(
      "formato_invalido",
      `a alavancagem tem de ser um INTEIRO (o venue aceita qualquer inteiro de 1 ate ${JSON.stringify(unidade.alavancagem_maxima)}), e veio ${JSON.stringify(alavancagem)}`,
    );
  }
  const maxima = unidade.alavancagem_maxima;
  if (!PADRAO_INTEIRO_POSITIVO.test(maxima)) {
    return recusa("valor_fora_da_banda", `o manifesto declara alavancagem_maxima ${JSON.stringify(maxima)}, que nao e um inteiro`);
  }
  if (BigInt(alavancagem) > BigInt(maxima)) {
    return recusa(
      "valor_fora_da_banda",
      `a alavancagem ${alavancagem} excede a maxima do instrumento (${maxima}); o venue aceita QUALQUER inteiro de 1 ate ${maxima} — nao se adapta para o valor abaixo, recusa-se`,
    );
  }

  // ---- porta 5: a referencia de cliente vira cloid (nunca vai crua) ------------------------------------------
  const cloidR = derivarCloid(conta, instrumento, referencia);
  if (!cloidR.ok) return cloidR;

  // ---- porta 5-bis: o PRECO A ENVIAR. No `limite` e' o da boleta, EXACTO (o preco de uma ordem de limite
  //      e' o ponto dela, e a prova FR-009 continua a ser caracter a caracter). No `mercado` o venue nao tem
  //      ordem de mercado nativa: manda-se um Ioc com um preco que CRUZA, e esse preco sai do DESVIO
  //      DECLARADO na boleta ([C] — a mesa manda-o; o manifesto diz o que o venue aceita). O preco e' o mais
  //      agressivo que a banda permite, quantizado a regra de preco do venue POR DENTRO da banda (nunca a
  //      excede) e sempre do lado agressivo da referencia; se nem isso couber, RECUSA em vez de aproximar.
  const desvioR = exigirTexto(b.desvio_maximo, "boleta.desvio_maximo (o desvio que a MESA pede)");
  if (!desvioR.ok) return desvioR;
  const desvio = desvioR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(desvio)) {
    return recusa("formato_invalido", `o desvio maximo da boleta (${JSON.stringify(desvio)}) nao e decimal positivo (a grandeza e' ignorada, nunca suposta)`);
  }
  const bandaR = exigirTexto(m.desvio_maximo, "manifesto.desvio_maximo (o desvio que o venue aceita)");
  if (!bandaR.ok) return bandaR;
  const banda = bandaR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(banda)) {
    return recusa("formato_invalido", `o desvio que o manifesto declara (${JSON.stringify(banda)}) nao e decimal positivo`);
  }
  if (escalado(desvio) * pow10(decimais(banda)) > escalado(banda) * pow10(decimais(desvio))) {
    return recusa(
      "valor_fora_da_banda",
      `a boleta pede desvio de ${desvio}% e o manifesto so declara ${banda}% como aceite pelo venue: recusa, nao se corta o desvio para caber (o desvio nao e' nosso para o baixar)`,
    );
  }

  const precoParaEnviar =
    par.tipo === "limite" ? ({ ok: true as const, valor: preco } as const) : precoAgressivo(preco, desvio, lado, unidade.tick);
  if (!precoParaEnviar.ok) return precoParaEnviar;
  const precoDeEnvio = precoParaEnviar.valor;

  // ---- porta 6-a: as CASAS da referencia (a marca) cabem no instrumento? -----------------------------------
  //
  // A referencia e' a REGUA de que o desvio e' medido (RN-B11). Se ela traz mais casas decimais do que o
  // instrumento admite no proprio tick, nao e' uma marca — e' uma leitura estragada (o venue publica a marca
  // na grelha do proprio instrumento; medido a 29/09/2026 no `metaAndAssetCtxs`: BTC szDecimals=5
  // `markPx 83835.0` · APT 0.7887 · MATIC 0.37035 — todos dentro da grelha). RECUSA nomeada, e nao se
  // arredonda a regua para a poder usar.
  //
  // PORQUE SO AS CASAS, E NAO A REGRA INTEIRA: os 5 algarismos significativos sao a regra do preco que se
  // MANDA (porta 6, abaixo), nao a da marca — e a marca real toca nessa contagem (`83835.0` tem 6 digitos e e'
  // a marca que o venue publicou para o BTC). O caso `ordens/mercado-preco-quantizado-POR-DENTRO-da-banda-do-venue`
  // prova-o com a marca `83867.0`: como regua tem de ser aceitavel, e quem passa a regra e' o preco quantizado
  // que sai. A ORDEM DESTA PORTA importa: com ela a correr depois de `precoAgressivo`, o preco derivado (que
  // sai sempre quantizado, por construcao) passava — e a regua estragada ia ao venue sem ninguem a ler.
  const casasDaReferencia = decimais(preco);
  const casasDoInstrumento = decimais(unidade.tick);
  if (casasDaReferencia > casasDoInstrumento) {
    return recusa(
      "valor_fora_da_banda",
      `a marca que o venue publicou (${preco}) tem ${casasDaReferencia} casa(s) decimal(is) e este instrumento admite ${casasDoInstrumento} (tick ${unidade.tick}) — recusa, nao se arredonda a regua de que o desvio e' medido`,
    );
  }

  // ---- porta 6: o preco QUE VAI cabe na regra do venue? se nao, RECUSA — nunca arredonda --------------------
  const cabimento = cabeNoPreco(precoDeEnvio, unidade.tick);
  if (!cabimento.cabe) {
    return recusa("valor_fora_da_banda", `o preco ${precoDeEnvio} nao cabe na regra do venue: ${cabimento.porque} — recusa, nao arredonda`);
  }

  // ---- porta 7: a quantidade, o minimo do instrumento e o valor minimo por ordem -----------------------------
  const passo = unidade.passo;
  const casasPasso = decimais(passo);

  // quantidade = (saldo_pct/100) * saldo * alavancagem / preco, ajustada ao passo POR BAIXO.
  // Tudo em inteiros escalados (BigInt): a divisao inteira de positivos e o floor, sem virgula flutuante.
  const p = decimais(saldo_pct);
  const s = decimais(saldo);
  const q = decimais(preco);
  const numerador = escalado(saldo_pct) * escalado(saldo) * BigInt(alavancagem) * pow10(q);
  const denominador = 100n * escalado(preco) * pow10(p + s);
  const k = (numerador * pow10(casasPasso)) / denominador;

  const minimoDeValorR = exigirTexto(m.minimo_de_valor_por_ordem, "manifesto.minimo_de_valor_por_ordem (o PISO de valor por ordem do venue)");
  if (!minimoDeValorR.ok) return minimoDeValorR;
  const minimoDeValor = minimoDeValorR.valor;
  if (!PADRAO_DECIMAL_POSITIVO.test(minimoDeValor)) {
    return recusa("formato_invalido", `o minimo de valor por ordem do venue (${JSON.stringify(minimoDeValor)}) nao e decimal positivo`);
  }

  if (k === 0n) {
    return recusa(
      "minimo_do_instrumento_acima_da_banda",
      `a quantidade que cabe na banda e menor que o passo do instrumento (${passo}): ajustar para baixo daria zero — recusa, nao se manda uma ordem que nao existe`,
    );
  }

  const minimo = unidade.minimo;
  if (k * pow10(decimais(minimo)) < escalado(minimo) * pow10(casasPasso)) {
    return recusa(
      "minimo_do_instrumento_acima_da_banda",
      `a quantidade calculada fica abaixo do minimo do instrumento (${minimo}): recusa, nao se arredonda para cima (aumentaria o risco do dono sem ele ter autorizado)`,
    );
  }

  // ---- porta 8: A VIRADA (1.10.0) ---------------------------------------------------------------------------
  //
  // A mesa NAO calcula unidades (RN-B0) e nao sabe o que esta' aberto no venue: a boleta pede a virada
  // (`reverter: true`) e diz o LADO, e a POSICAO VIVA entra por `pedido.posicao_a_reverter`, que o CONECTOR le'
  // do venue. Aqui somam-se as duas — a ordem que sai tem de FECHAR o que esta' aberto E abrir o novo, num so'
  // envio. E' por isso que ela sai SEM `reduce_only`: reduzir E abrir na mesma ordem e' exactamente o que a
  // virada pede, e o venue (netting) faz as duas coisas com o tamanho certo.
  //
  // Porque NAO se verifica se a posicao cabe no passo: ela vem do VENUE, que a quantiza no mesmo `szDecimals` de
  // que este manifesto deriva o passo (`manifesto.ts`: `passo = 10^-szDecimals`) — a soma de dois multiplos do
  // passo e' um multiplo do passo. Um motivo para um caso impossivel seria um motivo sem produtor; se um dia a
  // posicao vier fora do passo, o venue recusa a ordem e o desfecho di-lo, que e' onde isso se ve'.
  let quantidade = k;
  let casasDaQuantidade = casasPasso;
  if (reverter) {
    const posicaoR = exigirTexto(pedido.posicao_a_reverter, "posicao_a_reverter");
    if (!posicaoR.ok) {
      return recusa(
        "reversao_sem_posicao_a_reverter",
        "a boleta pede a virada (`reverter: true`) e a posicao viva nao entrou na traducao: sem ela nao se sabe " +
          "o que fechar, e mandar so' o lado novo seria uma entrada a mais com o registo a dizer `reverse`",
      );
    }
    if (!PADRAO_DECIMAL_POSITIVO.test(posicaoR.valor)) {
      return recusa(
        "reversao_sem_posicao_a_reverter",
        `a posicao viva veio ${JSON.stringify(posicaoR.valor)}: sem posicao POSITIVA para fechar nao ha virada a fazer`,
      );
    }
    if (pedido.lado_da_posicao === lado) {
      return recusa(
        "reversao_sem_posicao_a_reverter",
        `a posicao viva ja' esta' do lado ${lado}, que e' o lado da boleta: nao ha nada a virar (uma virada para o ` +
          "proprio lado seria uma entrada a mais)",
      );
    }
    const casasPosicao = decimais(posicaoR.valor);
    const escalaSoma = Math.max(casasPasso, casasPosicao);
    quantidade = k * pow10(escalaSoma - casasPasso) + escalado(posicaoR.valor) * pow10(escalaSoma - casasPosicao);
    casasDaQuantidade = escalaSoma;
  } else if (reducaoParcial || (reduce_only === true && comparacaoComInteiro === 0)) {
    // ---- porta 8-bis: A REDUCAO PARCIAL (1.11.0) — e, desde o D-022, TAMBEM O FECHO --------------------------
    //
    // UM FECHO COM `posicao_pct: "1"` FECHA A POSICAO INTEIRA, e a quantidade sai do VENUE (`posicao_pct x
    // posicao_viva`), nao do `saldo_pct`. Era o que faltava: o contrato diz, desde a 1.11.0, que `1` e' «a
    // posicao INTEIRA», e o codigo tratava `"1"` como «nao e' parcial» — deixando a quantidade sair do saldo.
    // Medido no D-022: as duas leituras COINCIDEM hoje (residuo 0,00% nas tres posicoes) e DIVERGEM assim que o
    // preco anda — a -0,22% o fecho excede a posicao e o venue RECUSA (o par fica ABERTO), a +0,65% sobra
    // residuo (posicao orfa). Um `caixa` significa SAIR: sai-se do que esta' aberto.
    // A ABERTURA NAO MUDA: com `reduce_only` false, a quantidade continua a sair do `saldo_pct` (a condicao
    // exige as duas coisas — e' um FECHO e e' a posicao inteira).
    //
    // A boleta diz a FRACCAO (`posicao_pct`) e a POSICAO VIVA vem do VENUE — a mesa nao a calcula e nao a manda
    // (RN-B0), como no `saldo` e no `preco`. Sem ela nao ha' de quanto calcular: uma fraccao de nada nao e' uma
    // ordem, e inventar uma quantidade seria decidir o tamanho do lado de ca'. Num fecho sem posicao viva, a
    // recusa NOMEIA-SE (`reducao_parcial_sem_posicao_viva`) em vez de mandar uma ordem que o venue recusaria.
    const posicaoR = exigirTexto(pedido.posicao_viva, "posicao_viva");
    if (!posicaoR.ok) {
      return recusa(
        "reducao_parcial_sem_posicao_viva",
        `a boleta pede ${comparacaoComInteiro === 0 ? "um FECHO da posicao INTEIRA" : `uma reducao PARCIAL (posicao_pct ${posicao_pct})`} ` +
          "e a posicao viva nao entrou na traducao: a posicao e' do VENUE, e nem uma fraccao de nada nem o " +
          "fecho do que nao se sabe sao ordens",
      );
    }
    if (!PADRAO_DECIMAL_POSITIVO.test(posicaoR.valor)) {
      return recusa(
        "reducao_parcial_sem_posicao_viva",
        `a posicao viva veio ${JSON.stringify(posicaoR.valor)}: sem uma posicao POSITIVA nao ha' fraccao que se calcule`,
      );
    }
    // quantidade = posicao_pct x posicao_viva, ajustada ao passo POR BAIXO — como toda a quantidade deste
    // ficheiro: ajustar por baixo REDUZ MENOS do que foi pedido (nunca aumenta o risco do dono; e uma reducao
    // maior do que a pedida seria a mesa a fechar mais do que o dono autorizou).
    const expoente = decimais(posicao_pct) + decimais(posicaoR.valor) - casasPasso;
    const bruto = escalado(posicao_pct) * escalado(posicaoR.valor);
    const kParcial = expoente >= 0 ? bruto / pow10(expoente) : bruto * pow10(-expoente);
    if (kParcial === 0n) {
      return recusa(
        "minimo_do_instrumento_acima_da_banda",
        `a fraccao pedida (posicao_pct ${posicao_pct} de ${posicaoR.valor}) e' menor que o passo do instrumento ` +
          `(${passo}): ajustar para baixo daria zero — recusa, nao se manda uma ordem que nao existe`,
      );
    }
    const minimoParcial = unidade.minimo;
    if (kParcial * pow10(decimais(minimoParcial)) < escalado(minimoParcial) * pow10(casasPasso)) {
      return recusa(
        "minimo_do_instrumento_acima_da_banda",
        `a fraccao pedida (posicao_pct ${posicao_pct} de ${posicaoR.valor}) fica abaixo do minimo do instrumento ` +
          `(${minimoParcial}): recusa, em vez de arredondar a reducao para cima (fecharia mais do que foi pedido)`,
      );
    }
    quantidade = kParcial;
    casasDaQuantidade = casasPasso;
  }

  // O nocional e' o da ordem QUE SE MANDA: quantidade x o preco que vai para o venue (no `mercado` isso e'
  // o CAP da banda declarada, e nao a referencia — declarar o nocional pela referencia seria declarar menos
  // exposicao do que a ordem pode empenhar). Na virada, a ordem que se manda e' a SOMA — logo o nocional e' o da
  // soma, e nao o da perna nova.
  const nocionalEscalado = quantidade * escalado(precoDeEnvio);
  const escalaNocional = casasDaQuantidade + decimais(precoDeEnvio);
  if (nocionalEscalado * pow10(decimais(minimoDeValor)) < escalado(minimoDeValor) * pow10(escalaNocional)) {
    return recusa(
      "minimo_do_instrumento_acima_da_banda",
      `o valor da ordem fica abaixo do minimo por ordem do venue (${minimoDeValor}): recusa, em vez de aumentar a ordem para la chegar`,
    );
  }

  return {
    ok: true,
    accao: {
      instrumento,
      lado,
      tipo: par.tipo,
      tif: par.tif,
      quantidade: formatar(quantidade, casasDaQuantidade),
      // O preco QUE VAI PARA O VENUE. No `limite` sai EXACTAMENTE como entrou (FR-009, caracter a caracter);
      // no `mercado` sai o Ioc que cruza, por dentro da banda declarada — e a referencia e o desvio de que
      // ele saiu vao declarados na accao, para quem envia poder provar de onde veio.
      preco: precoDeEnvio,
      nocional: formatar(nocionalEscalado, escalaNocional),
      alavancagem,
      reduce_only,
      reverter,
      cloid: cloidR.cloid,
      // O preco de REFERENCIA e o desvio ficam DECLARADOS na accao: quem envia tem de poder provar que
      // o preco que saiu esta dentro da banda que a boleta pediu, e de onde ele foi medido.
      preco_de_referencia: preco,
      desvio_maximo: desvio,
    },
  };
}

/**
 * O preco de um Ioc de MERCADO que CRUZA — o unico jeito de mandar «a mercado» a um venue que nao tem ordem
 * de mercado nativa (na Hyperliquid uma ordem a mercado e' um Ioc com um preco que cruza).
 *
 * DE ONDE VEM O PRECO: do `desvio_maximo` que a boleta DECLARA ([C] — a mesa manda-o), medido sobre o preco
 * de referencia que o conector RELEU do venue no momento do envio (RN-B11). Nada aqui e' um numero nosso:
 * o desvio e' o da boleta, a referencia e' a do venue.
 *
 * COMO SE QUANTIZA: o valor alvo (`referencia +/- desvio%`) nao cabe, em geral, na regra de preco do venue
 * (no maximo 5 algarismos significativos e no maximo as casas do `tick`). A quantizacao faz-se SEMPRE POR
 * DENTRO DA BANDA — para o lado da referencia — e nunca para fora: o preco que sai fica em
 * `[referencia, referencia*(1+desvio)]` numa compra e em `[referencia*(1-desvio), referencia]` numa venda.
 * Arredondar para fora da banda seria alargar o desvio declarado por conta propria, e isso nao se faz.
 *
 * SE NEM ASSIM DER: se o desvio declarado nao chegar para o preco quantizado ficar do lado AGRESSIVO da
 * referencia (banda mais estreita que a granularidade do preco do venue), RECUSA. Um Ioc com preco igual a
 * referencia nao cruza — sai uma ordem que nao negoceia — e fingir que cruza seria decidir no escuro.
 */
function precoAgressivo(
  referencia: string,
  desvio: string,
  lado: "buy" | "sell",
  tick: string,
): { ok: true; valor: string } | Recusa {
  if (!PADRAO_DECIMAL_POSITIVO.test(referencia)) {
    return recusa("formato_invalido", `o preco de referencia lido do venue (${JSON.stringify(referencia)}) nao e decimal positivo`);
  }
  const casasRef = decimais(referencia);
  const casasDoTick = decimais(tick);
  const e = decimais(desvio);

  // alvo = referencia * (100*10^e +/- desvio) / (100*10^e), em inteiros escalados (sem virgula flutuante)
  const fator = 100n * pow10(e) + (lado === "buy" ? 1n : -1n) * escalado(desvio);
  const denominador = 100n * pow10(e) * pow10(casasRef);
  const numerador = escalado(referencia) * fator; // o alvo, na escala `casasRef`

  // T = alvo na escala do tick, truncado PARA DENTRO da banda (compra: por baixo; venda: por cima)
  let escala = casasDoTick;
  const bruto = numerador * pow10(escala);
  let t = lado === "buy" ? bruto / denominador : (bruto + denominador - 1n) / denominador;

  // A regra de preco do venue: retira-se precisao POR DENTRO da banda ate caberem 5 algarismos significativos.
  while (escala > 0 && algarismosSignificativos(formatar(t, escala)) > ALGARISMOS_SIGNIFICATIVOS_DO_PRECO) {
    t = lado === "buy" ? t / 10n : (t + 9n) / 10n;
    escala -= 1;
  }

  const preco = formatar(t, escala);
  if (t <= 0n) {
    return recusa("valor_fora_da_banda", `o desvio declarado (${desvio}%) leva o preco a zero a partir da referencia ${referencia}: recusa`);
  }
  // A comparacao usa a escala do decimal ESCRITO (o `formatar` larga os zeros a direita, e a escala muda com ele)
  const casasDoPreco = decimais(preco);
  const comparacao = escalado(preco) * pow10(casasRef) - escalado(referencia) * pow10(casasDoPreco);
  const agressivo = lado === "buy" ? comparacao > 0n : comparacao < 0n;
  if (!agressivo) {
    return recusa(
      "valor_fora_da_banda",
      `o desvio declarado de ${desvio}% nao chega para cruzar o preco do venue dentro da regra dele: a referencia ${referencia} com a granularidade ${tick} so deixa preco ${preco}, que nao e' do lado agressivo — recusa, nao se alarga o desvio por conta propria`,
    );
  }
  return { ok: true, valor: preco };
}
