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
  limite_de_idade_ms: number | null;
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
  /** O setup propos algo que o contrato recusa (nao e o mesmo que nada propor). */
  proposta_invalida?: boolean;
  /** O motivo do contrato para essa recusa - vai para o registo. */
  motivo_do_contrato?: string | null;
  falhas?: Falhas;
  /** Divergencia declarada por quem le (ex.: a reconciliacao explicou um numero que nao bate). */
  divergente?: boolean;
  restricoes?: { sem_margem?: boolean };
  invalidos_seguidos_antes?: number;
}

export function decidirInstrumento(entrada: EntradaDoInstrumento): Decisao {
  const { mercado, proposta } = entrada;
  const posicao = mercado.posicao ?? null;
  const nossa = posicao !== null && entrada.marcas_nossas_conhecidas.includes(posicao.marca_de_posse);
  const alheia = posicao !== null && !nossa;

  // Uma posicao que nao e nossa E uma divergencia: a mesa esperava outra coisa (ou nada).
  const situacao = situacaoDoInstrumento(
    { idade_do_dado_ms: mercado.idade_do_dado_ms, estado_do_mercado: mercado.estado },
    entrada.limite_de_idade_ms,
    entrada.falhas ?? {},
    (entrada.divergente ?? false) || alheia,
    entrada.config,
  );

  const base = {
    instrumento: mercado.instrumento,
    condicao: situacao.condicao,
    impedimentos: situacao.impedimentos,
    invalidos_seguidos: 0,
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
      invalidos_seguidos: (entrada.invalidos_seguidos_antes ?? 0) + 1,
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
  } else {
    acao = "abrir";
    ladoDaBoleta = lado;
    reduce_only = false;
  }

  // 4. As travas, por ordem: primeiro o que a mesa DEVE, depois se PODE, depois se CABE.
  if (acao === "abrir" && entrada.desconhecido != null) {
    return {
      ...base,
      acao: "nada",
      motivo: "abrir_bloqueado_por_desconhecido",
      avisa: false,
      boleta: null,
    };
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
