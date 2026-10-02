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
export type { Falhas };
import { montarBoleta, type Decisao, type Mandato, type Template } from "./decisao.ts";

const LADOS = ["buy", "sell", "hold", "caixa"] as const;

export interface EntradaDoInstrumento {
  mercado: any;
  proposta: any | null;
  ficha: string;
  ciclo: number;
  ligacao: "ligada" | "sem_ligacao";
  mandato: Mandato;
  template: Template;
  marcas_nossas_conhecidas: number[];
  config: ConfiguracaoDaConta;
  desconhecido?: { motivo: string; instante_ms: number } | null;
  mesa_pausada?: boolean;
  proposta_invalida?: boolean;
  motivo_do_contrato?: string | null;
  barra_atual?: number;
  barra_da_ultima_entrada?: number | null;
  barra_do_sinal_esperada?: number;
  falhas?: Falhas;
  divergente?: boolean;
  banda?: ConferenciaDaBanda | null;
  restricoes?: { sem_margem?: boolean };
}

function exigirFalhas(entrada: EntradaDoInstrumento, instrumento: string): Falhas {
  if (entrada.falhas === undefined || entrada.falhas === null) {
    throw new Error(
      `o ciclo de ${instrumento} nao recebeu as falhas da leitura (\`falhas\`): tratar o ausente como vazio e' ` +
        "decidir a bem de uma leitura que ninguem conferiu",
    );
  }
  return entrada.falhas;
}

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
  const instrumento: string = String(mercado?.instrumento);
  if (!instrumento || instrumento === "undefined" || instrumento === "null") {
    throw new Error(
      "o ciclo nao recebeu o instrumento da leitura (`mercado.instrumento`): sem saber de que instrumento se " +
        "fala, a decisao nao tem dono — e uma decisao sem dono nao se pode registar (RN-D4)",
    );
  }
  const posicao = mercado.posicao ?? null;
  const marca = posicao !== null && typeof posicao.marca_de_posse === "number" ? posicao.marca_de_posse : null;
  const nossa = marca !== null && entrada.marcas_nossas_conhecidas.includes(marca);
  const alheia = posicao !== null && !nossa;
  const situacao = situacaoDoInstrumento(
    { idade_do_dado_ms: mercado.idade_do_dado_ms, estado_do_mercado: mercado.estado },
    entrada.ligacao,
    exigirFalhas(entrada, instrumento),
    exigirDivergente(entrada, instrumento) || alheia,
    entrada.config,
  );
  const base = {
    instrumento: mercado.instrumento,
    condicao: situacao.condicao,
    impedimentos: situacao.impedimentos,
    motivo_do_contrato: null as string | null,
    desconhecido: entrada.desconhecido ?? null,
  };
  const tolera = (entrada.mandato as { tolera_posicao_manual?: unknown }).tolera_posicao_manual;
  if (typeof tolera !== "boolean") {
    throw new Error(
      `o ciclo de ${instrumento} nao recebeu \`tolera_posicao_manual\` (booleano) no mandato: sem a chave ` +
        "nao se sabe se uma posicao aberta a mao se tolera, e nao se assume",
    );
  }
  const tempoMaximo = (entrada.mandato as { tempo_maximo_em_posicao?: unknown }).tempo_maximo_em_posicao;
  if (typeof tempoMaximo !== "string") {
    throw new Error(
      `o ciclo de ${instrumento} nao recebeu \`tempo_maximo_em_posicao\` (string; vazio = sem limite): ` +
        "chave ausente nao e' sem limite",
    );
  }
  if (alheia) {
    return {
      ...base,
      acao: "nada",
      motivo: tolera ? "posicao_manual_tolerada_nao_gerida" : "posicao_alheia_relatada_nao_gerida",
      avisa: true,
      boleta: null,
    };
  }
  if (nossa && tempoMaximo !== "") {
    return {
      ...base,
      acao: "nada",
      motivo: "tempo_maximo_sem_instante_de_abertura",
      avisa: true,
      boleta: null,
    };
  }
  const lado = proposta?.lado;
  const ladoValido = typeof lado === "string" && (LADOS as readonly string[]).includes(lado);
  if (!ladoValido) {
    return {
      ...base,
      acao: "nada",
      motivo: "proposta_ausente_tratada_como_hold",
      avisa: true,
      boleta: null,
      motivo_do_contrato: entrada.proposta_invalida === true ? (entrada.motivo_do_contrato ?? null) : null,
    };
  }
  if (lado === "hold") {
    return { ...base, acao: "nada", motivo: "proposta_sem_lado_a_executar", avisa: situacao.alarma, boleta: null };
  }
  let acao: Decisao["acao"];
  let ladoDaBoleta: string;
  let reduce_only: boolean;
  if (lado === "caixa") {
    if (!nossa) {
      return { ...base, acao: "nada", motivo: "sem_posicao_para_fechar", avisa: situacao.alarma, boleta: null };
    }
    acao = "fechar";
    ladoDaBoleta = posicao.lado === "buy" ? "sell" : "buy";
    reduce_only = true;
  } else if (nossa && posicao.lado !== lado) {
    acao = "fechar";
    ladoDaBoleta = lado;
    reduce_only = true;
  } else {
    acao = "abrir";
    ladoDaBoleta = lado;
    reduce_only = false;
  }
  if (acao === "abrir" && Number(entrada.proposta?.barra_ms) !== entrada.barra_do_sinal_esperada) {
    return { ...base, acao: "nada", motivo: "proposta_de_barra_antiga", avisa: situacao.alarma, boleta: null };
  }
  if (acao === "abrir" && entrada.mesa_pausada === true) {
    return { ...base, acao: "nada", motivo: "mesa_pausada_nao_abre", avisa: false, boleta: null };
  }
  if (acao === "abrir" && entrada.desconhecido != null) {
    return { ...base, acao: "nada", motivo: "abrir_bloqueado_por_desconhecido", avisa: false, boleta: null };
  }
  if (acao === "abrir" && entrada.banda != null && entrada.banda.accao !== "seguir") {
    return { ...base, acao: "nada", motivo: "abrir_bloqueado_por_divergencia_de_banda", avisa: true, boleta: null };
  }
  if (acao === "abrir") {
    for (const campo of ["stop_pct", "tp_pct"] as const) {
      const doSetup = entrada.template?.[campo];
      if (doSetup === undefined) continue;
      const veredicto = cabeNaBanda(doSetup, entrada.mandato?.bandas?.[campo]);
      if (veredicto.veredicto === "dentro") continue;
      return {
        ...base,
        acao: "nada",
        motivo: veredicto.veredicto === "fora" ? "parametro_do_setup_fora_da_banda" : "parametro_do_setup_nao_conferivel",
        avisa: true,
        boleta: null,
      };
    }
  }
  if (acao === "abrir" && !situacao.abre) {
    return { ...base, acao: "nada", motivo: "abrir_impedido_pela_condicao", avisa: situacao.alarma, boleta: null };
  }
  if (acao === "fechar" && !situacao.fecha) {
    return { ...base, acao: "nada", motivo: "fechar_impedido_pela_condicao", avisa: situacao.alarma, boleta: null };
  }
  if (
    acao === "abrir" &&
    entrada.barra_atual !== undefined &&
    entrada.barra_da_ultima_entrada !== undefined &&
    entrada.barra_da_ultima_entrada === entrada.barra_atual
  ) {
    return { ...base, acao: "nada", motivo: "entrada_ja_feita_nesta_barra", avisa: situacao.alarma, boleta: null };
  }
  if (acao === "abrir" && entrada.restricoes?.sem_margem === true) {
    return { ...base, acao: "nada", motivo: "sem_margem_no_ciclo", avisa: situacao.alarma, boleta: null };
  }
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

export function descricaoDaCondicao(condicao: NomeDeCondicao, impedimentos: NomeDeCondicao[]): string {
  return impedimentos.length === 0 ? condicao : `${condicao} (${impedimentos.join("+")})`;
}

export function decidirSemLeitura(entrada: {
  instrumento: string;
  ligacao: "ligada" | "sem_ligacao";
  config: ConfiguracaoDaConta;
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
