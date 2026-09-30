// O ciclo: a passagem por um instrumento, e a decisao que sai dela.
//
// A ordem dentro do ciclo e o que faz a diferença entre uma mesa que se defende e uma que se atrapalha:
//
//   1. a POSICAO e lida do venue (nunca de um registo nosso - FR-022), e a posse vem da MARCA
//   2. a CONDICAO e somada das leituras (condicoes.ts)
//   3. o LADO vem do setup (RN-T4); ausente ou invalido e hold, com a invalidade contada
//   4. a DECISAO e travada pelo que a condicao impede - e so depois se ve se cabe (sem_margem)
//
// A mesa NAO envia nada (R5): devolve a decisao. Quem envia e o processo que liga o core ao conector.

import type { ConfiguracaoDaConta } from "../config/configuracao.ts";
import { cabeNaBanda, type ConferenciaDaBanda } from "./banda.ts";
import { situacaoDoInstrumento, type Falhas, type NomeDeCondicao } from "./condicoes.ts";
import { montarBoleta, type Decisao, type Mandato, type Template } from "./decisao.ts";

const LADOS = ["buy", "sell", "hold", "caixa"] as const;

export interface EntradaDoInstrumento {
  /** A mensagem `mercado` do contrato, ja validada pela porta de leitura. */
  mercado: any;
  /** A proposta do setup, ja validada - ou `null` quando ele nada propos. */
  proposta: any | null;
  ficha: string;
  ciclo: number;
  /**
   * O estado da ligacao reportado pelo conector (emenda 28 set 2026). Era `limite_de_idade_ms`, um
   * numero que o codigo recebia de fora e o dono nao podia governar: em varejo o silencio do tick nao
   * distingue mercado calmo de ligacao morta.
   */
  ligacao: "ligada" | "sem_ligacao";
  mandato: Mandato;
  template: Template;
  /** As marcas de posse que a mesa sabe compor: e por elas que a posse se reconhece. */
  marcas_nossas_conhecidas: number[];
  /** A configuracao do dono. Entra por causa de uma chave so: quem avisa (FR-042). */
  config: ConfiguracaoDaConta;
  /**
   * A marca `desconhecido` deste instrumento, quando existe.
   *
   * Nao e uma condicao, e e de proposito: as condicoes descrevem o que se LEU (o look, o setup, o
   * mercado); o desconhecido e uma divida da mesa consigo propria, que so uma reconciliacao paga.
   * Juntar as duas coisas faria `condicao` depender das marcas - e uma mesa reiniciada sem o ficheiro
   * de marcas passaria a ver o mundo de outra maneira.
   */
  desconhecido?: { motivo: string; instante_ms: number } | null;
  /**
   * A mesa esta pausada?
   *
   * A pausa suspende ABRIR e mais nada: defender continua. Por isso este campo entra na trava logo antes
   * das outras, e nao como um caminho paralelo - o CB, a reconciliacao e o fecho correm exactamente o mesmo
   * codigo com a mesa pausada ou em operacao. Pausar nao pode ser sinónimo de nao ver.
   */
  mesa_pausada?: boolean;
  /**
   * O setup propos algo que o contrato recusa (nao e o mesmo que nada propor).
   *
   * A invalidade fica REGISTADA (com a razao do contrato ao lado) e nao alimenta contador nenhum: a
   * emenda de 28 set 2026 tirou o «N invalidos seguidos inibem a mesa» - o numero era vago porque
   * depende do erro, e travar a mesa por causa desconhecida e puni-la por um erro que pode ser do mundo.
   */
  proposta_invalida?: boolean;
  /** O motivo do contrato para essa recusa - vai para o registo. */
  motivo_do_contrato?: string | null;
  falhas?: Falhas;
  /** Divergencia declarada por quem le (ex.: a reconciliacao explicou um numero que nao bate). */
  divergente?: boolean;
  /**
   * A conferencia da banda da ultima resolucao deste instrumento (D-001).
   *
   * Quando ela NAO passou - uma divergencia provada (a corretora executou fora do que o dono autorizou)
   * ou um numero que nao se conseguiu conferir - a mesa NAO abre risco novo aqui. Fechar/reduzir continua
   * permitido: reduzir risco e sempre permitido, mesmo sem leitura e mesmo sem ligacao (RN-M9).
   */
  banda?: ConferenciaDaBanda | null;
  restricoes?: { sem_margem?: boolean };
}

/**
 * As FALHAS da leitura, ou recusa.
 *
 * `falhas` era opcional na entrada e o codigo fazia `?? {}` — «nao sei se houve falha» virava «nao houve falha
 * nenhuma». Quem leu sabe-o, e declara-o; nao declarar nao pode contar como ausencia de problemas.
 */
function exigirFalhas(entrada: EntradaDoInstrumento, instrumento: string): Falhas {
  if (entrada.falhas === undefined || entrada.falhas === null) {
    throw new Error(
      `o ciclo de ${instrumento} nao recebeu as falhas da leitura (\`falhas\`): tratar o ausente como vazio e' ` +
        "decidir a bem de uma leitura que ninguem conferiu",
    );
  }
  return entrada.falhas;
}

/** A DIVERGENCIA da leitura, ou recusa. `?? false` dizia «nao diverge» sem ninguem o ter dito. */
function exigirDivergente(entrada: EntradaDoInstrumento, instrumento: string): boolean {
  if (typeof entrada.divergente !== "boolean") {
    throw new Error(
      `o ciclo de ${instrumento} nao recebeu a divergencia da leitura (\`divergente\`): o ausente nao e' "nao divergente"`,
    );
  }
  return entrada.divergente;
}

export function decidirInstrumento(entrada: EntradaDoInstrumento): Decisao {
  const { mercado, proposta } = entrada;
  const posicao = mercado.posicao ?? null;
  // A MARCA DE POSSE e' o que diz de quem e' a posicao (RN-T16.1). Quando o venue a nao da (a leitura vinda
  // do venue vai sem marca: o mapa marca -> ficha e' item por fazer), uma posicao NAO e' nossa — e uma
  // posicao que nao e' nossa relata-se e nao se gere. `includes(undefined)` diria a mesma coisa por acidente;
  // a guarda diz a intencao.
  const marca = posicao !== null && typeof posicao.marca_de_posse === "number" ? posicao.marca_de_posse : null;
  const nossa = marca !== null && entrada.marcas_nossas_conhecidas.includes(marca);
  const alheia = posicao !== null && !nossa;

  // Uma posicao que nao e nossa E uma divergencia: a mesa esperava outra coisa (ou nada).
  const situacao = situacaoDoInstrumento(
    { idade_do_dado_ms: mercado.idade_do_dado_ms, estado_do_mercado: mercado.estado },
    entrada.ligacao,
    // AS FALHAS DA LEITURA e a DIVERGENCIA: quem as sabe e' quem leu. Ausentes = recusa, nunca "nenhuma falha"
    // nem "nao divergente" — era por ai' que uma leitura por conferir virava uma decisao.
    exigirFalhas(entrada, String(mercado?.instrumento ?? "(sem nome)")),
    exigirDivergente(entrada, String(mercado?.instrumento ?? "(sem nome)")) || alheia,
    entrada.config,
  );

  const base = {
    instrumento: mercado.instrumento,
    condicao: situacao.condicao,
    impedimentos: situacao.impedimentos,
    motivo_do_contrato: null as string | null,
    desconhecido: entrada.desconhecido ?? null,
  };

  // 1. Posicao alheia: relata-se e NAO se gere (FR-021). Nada mais neste instrumento acontece.
  if (alheia) {
    return {
      ...base,
      acao: "nada",
      motivo: "posicao_alheia_relatada_nao_gerida",
      avisa: true,
      boleta: null,
    };
  }

  // 2. O lado: os quatro valores de RN-T4, e nada mais.
  const lado = proposta?.lado;
  const ladoValido = typeof lado === "string" && (LADOS as readonly string[]).includes(lado);

  if (!ladoValido) {
    return {
      ...base,
      acao: "nada",
      motivo: "proposta_ausente_tratada_como_hold",
      avisa: true,
      boleta: null,
      // Quando a invalidade vem de uma proposta que o contrato recusou, o motivo DELE fica registrado:
      // "a proposta era invalida" e menos util do que "a proposta tinha um valor fora do conjunto".
      motivo_do_contrato: entrada.proposta_invalida === true ? (entrada.motivo_do_contrato ?? null) : null,
    };
  }

  if (lado === "hold") {
    return {
      ...base,
      acao: "nada",
      motivo: "proposta_sem_lado_a_executar",
      avisa: situacao.alarma,
      boleta: null,
    };
  }

  // 3. A intencao: abrir, ou ir para caixa (fechar em reduce-only).
  let acao: Decisao["acao"];
  let ladoDaBoleta: string;
  let reduce_only: boolean;

  if (lado === "caixa") {
    if (!nossa) {
      return {
        ...base,
        acao: "nada",
        motivo: "sem_posicao_para_fechar",
        avisa: situacao.alarma,
        boleta: null,
      };
    }
    acao = "fechar";
    // Fechar NUNCA inverte: o lado da boleta e o oposto da posicao que existe (RN-B5).
    ladoDaBoleta = posicao.lado === "buy" ? "sell" : "buy";
    reduce_only = true;
  } else if (nossa && posicao.lado !== lado) {
    // O LADO OPOSTO A' NOSSA POSICAO NAO E' ABRIR — E' REDUZIR (D-013, medido 29/09/2026).
    //
    // O que se mediu, na bateria de teste do venue (P15): com posicao nossa aberta, uma proposta do lado oposto
    // produzia `acao: "abrir"` e a boleta saia com `reduce_only: false` — e o venue FAZ NETTING: a mesma ordem
    // do mesmo tamanho ZEROU a posicao, e o registo ficou a dizer `abrir` sobre uma reducao. Pior: se a boleta
    // fosse MAIOR que a posicao, o mesmo caminho entregava uma VIRADA NUMA SO' ORDEM — exactamente o que a
    // virada de mao em dois passos (o vocabulario nao tem verbo para ela) existe para nao deixar acontecer.
    //
    // A CORRECCAO, e porque e' esta: `reduce_only` e' a unica forma de dizer «reduz, nunca inverte» sem a mesa
    // calcular unidades (que nao e' dela, RN-B0) — o venue corta no tamanho da posicao, e a boleta pode ir por
    // cima sem risco. A accao fica `fechar`, que e' o nome que o vocabulario ja tem para «isto so' reduz»
    // (`abrir | fechar | adoptar | nada`): uma REDUCAO PARCIAL continua sem nome proprio, e isso esta' declarado
    // como o que falta ao vocabulario — mas o perigo (a virada em silencio) fica fechado hoje.
    acao = "fechar";
    ladoDaBoleta = lado;
    reduce_only = true;
  } else {
    acao = "abrir";
    ladoDaBoleta = lado;
    reduce_only = false;
  }

  // 4. As travas, por ordem: primeiro o que a mesa DEVE, depois se PODE, depois se CABE.
  if (acao === "abrir" && entrada.mesa_pausada === true) {
    return {
      ...base,
      acao: "nada",
      motivo: "mesa_pausada_nao_abre",
      // O motivo aponta para a PAUSA, e nao para a estrategia: o dono que pausou tem de poder ler que foi
      // ele - senao o registo sugere que o setup e que nao quis abrir.
      avisa: false,
      boleta: null,
    };
  }

  if (acao === "abrir" && entrada.desconhecido != null) {
    return {
      ...base,
      acao: "nada",
      motivo: "abrir_bloqueado_por_desconhecido",
      avisa: false,
      boleta: null,
    };
  }

  // 3.5. A CONFERENCIA DA BANDA (D-001): o que a corretora executou nao passou o que o dono autorizou.
  // Nao se abre risco novo neste instrumento - nem com uma divergencia provada, nem com um numero que
  // nao se conseguiu conferir. Fechar/reduzir (o ramo `caixa`, abaixo) continua a passar: reduzir risco
  // e sempre permitido, e travar o fecho aqui seria a mesa a defender-se do lado errado.
  if (acao === "abrir" && entrada.banda != null && entrada.banda.accao !== "seguir") {
    return {
      ...base,
      acao: "nada",
      motivo: "abrir_bloqueado_por_divergencia_de_banda",
      // A divergencia e um dos eventos que o dono declara: ele escreveu que quer ser avisado dela.
      avisa: true,
      boleta: null,
    };
  }

  // 3.6. O QUE O SETUP PEDE CONTRA A BANDA DO DONO (RN-B7, RN-M6.2, RN-S11; D-008). O stop e o tp viajam na
  // boleta como o setup os declarou - e um setup NAO afrouxa a banda. Nao se abre com o parametro fora da
  // banda, nem com um parametro que se declarou e nao se conseguiu conferir (o RN-M6.2 recusa «na validacao»,
  // e a validacao do mandato acontece aqui, onde o valor do setup aparece). Fechar/reduzir continua a passar:
  // o stop nao viaja numa ordem que so' fecha, e reduzir risco e' sempre permitido.
  if (acao === "abrir") {
    for (const campo of ["stop_pct", "tp_pct"] as const) {
      const doSetup = entrada.template?.[campo];
      if (doSetup === undefined) continue; // nao ha' valor a limitar: nada a dizer
      const veredicto = cabeNaBanda(doSetup, entrada.mandato?.bandas?.[campo]);
      if (veredicto.veredicto === "dentro") continue;
      return {
        ...base,
        acao: "nada",
        motivo:
          veredicto.veredicto === "fora"
            ? "parametro_do_setup_fora_da_banda"
            : "parametro_do_setup_nao_conferivel",
        // E' um erro de DECLARACAO do lado do setup, e o dono escreveu que quer ser avisado do que trava a
        // mesa por configuracao: sem aviso, o setup ficaria a pedir um stop que nunca sai e ninguem saberia.
        avisa: true,
        boleta: null,
      };
    }
  }

  if (acao === "abrir" && !situacao.abre) {
    return {
      ...base,
      acao: "nada",
      motivo: "abrir_impedido_pela_condicao",
      avisa: situacao.alarma,
      boleta: null,
    };
  }
  if (acao === "fechar" && !situacao.fecha) {
    return {
      ...base,
      acao: "nada",
      motivo: "fechar_impedido_pela_condicao",
      // O aviso NAO e forcado: vem da condicao. Um fecho travado pelo mercado fechado e esperado e
      // nao alarma; um fecho travado por falta de leitura ou por divergencia alarma, e vem daqui.
      avisa: situacao.alarma,
      boleta: null,
    };
  }

  if (acao === "abrir" && entrada.restricoes?.sem_margem === true) {
    return {
      ...base,
      acao: "nada",
      motivo: "sem_margem_no_ciclo",
      avisa: situacao.alarma,
      boleta: null,
    };
  }

  // 5. Passou tudo: monta-se a boleta (e ela e validada contra o contrato la dentro).
  return {
    ...base,
    acao,
    motivo: null,
    avisa: situacao.alarma,
    boleta: montarBoleta({
      instrumento: mercado.instrumento,
      lado: ladoDaBoleta,
      mandato: entrada.mandato,
      template: entrada.template,
      reduce_only,
      ficha: entrada.ficha,
      ciclo: entrada.ciclo,
    }),
  };
}

/** Nome curto da condicao para o registo, com todos os impedimentos (o que travou, e nao so o primeiro). */
export function descricaoDaCondicao(condicao: NomeDeCondicao, impedimentos: NomeDeCondicao[]): string {
  return impedimentos.length === 0 ? condicao : `${condicao} (${impedimentos.join("+")})`;
}

/**
 * A DECISAO QUANDO A LEITURA NAO CHEGOU (RN-D7, FR-002 a FR-016) — e o caminho que faltava.
 *
 * PORQUE EXISTE. Medido (29/09/2026): ninguem produzia o ficheiro de operacao em producao, e o conector podia
 * estar morto enquanto a mesa ciclava sobre o que tivesse em memoria. A condicao `sem_leitura` estava escrita
 * e conferida no livro (`condicoes.json`) desde o recorte 002 — mas NINGUEM a levantava: a leitura ausente nem
 * chegava ao ciclo (rebentava antes, ou decidia-se com o que la estivesse). Era o mesmo vicio do D-007: uma
 * trava declarada e sem quem a accione.
 *
 * O QUE ESTA FUNCAO FAZ, E O QUE NAO FAZ. Nao julga o mercado: nao ha mercado para julgar. Monta a situacao
 * com a leitura em `null` — o que activa `sem_leitura` — e devolve a decisao de NAO FAZER, com o motivo
 * nomeado. Quem abre e fecha le a condicao: `sem_leitura` impede as duas, e e' por isso que a mesa nao abre
 * risco novo nem fecha as cegas (fechar sem saber o que existe e' adivinhar).
 *
 * A AVISA vem da lista do dono (FR-042), como em qualquer outra decisao: `sem_leitura` levanta o evento
 * `falha_de_leitura`, e quem diz se ele acorda alguem e' `conta.eventos_que_avisam[]`.
 */
export function decidirSemLeitura(entrada: {
  instrumento: string;
  ligacao: "ligada" | "sem_ligacao";
  config: ConfiguracaoDaConta;
  /** A marca `desconhecido` deste instrumento, quando existe (a divida da mesa consigo propria). */
  desconhecido?: { motivo: string; instante_ms: number } | null;
}): Decisao {
  const situacao = situacaoDoInstrumento(null, entrada.ligacao, {}, false, entrada.config);
  return {
    instrumento: entrada.instrumento,
    acao: "nada",
    motivo: "leitura_ausente_no_ciclo",
    condicao: situacao.condicao,
    impedimentos: situacao.impedimentos,
    avisa: situacao.alarma,
    boleta: null,
    motivo_do_contrato: null,
    desconhecido: entrada.desconhecido ?? null,
  };
}
