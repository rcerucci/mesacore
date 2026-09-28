// As condicoes do instrumento: das leituras para o que se pode fazer.
//
// Tudo o que decide aqui vem de DADO (`condicoes.json`): o que cada condicao impede, e a ordem por que
// e reportada. Este ficheiro so soma impedimentos - e a soma e o ponto.
//
// A razao de somar em vez de escolher UMA condicao: `congelada` (o setup calou-se) e `divergente` (o
// numero nao bate) podem estar activas ao mesmo tempo, e cada uma impede uma coisa diferente. Com uma
// condicao so, uma das duas restricoes desaparecia - e a que desaparecia era a que impedia fechar
// sobre um numero que se sabe errado.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deveAvisar, eventoConhecido, type ConfiguracaoDaConta } from "../config/configuracao.ts";

export type NomeDeCondicao =
  | "normal"
  | "sem_leitura"
  | "divergente"
  | "congelada"
  | "mercado_fechado"
  | "dado_velho";

export interface EfeitoDaCondicao {
  impede_abrir: boolean;
  impede_fechar: boolean;
  impede_cancelar: boolean;
  /**
   * O NOME do evento que esta condicao levanta - nao um booleano.
   *
   * A diferenca vale a pena: com um booleano aqui, a mesa decidia sozinha o que avisa, e a FR-042 diz
   * que a lista e do dono (`conta.eventos_que_avisam[]`). Guardando o NOME, quem decide se avisa e a
   * config, e este ficheiro so diz de que evento se trata. Nome inexistente no conjunto fechado
   * (`eventos.json`) faz GRITAR - um erro de escrita nao desliga um alarme em silencio.
   */
  evento: string | null;
  regra: string;
  porque: string;
  chave?: string;
}

interface LivroDeCondicoes {
  nota: string;
  condicoes: Record<NomeDeCondicao, EfeitoDaCondicao>;
  precedencia: NomeDeCondicao[];
  porque_desta_ordem: string;
  limite_de_idade: { chave: string; comparacao: string; porque: string };
}

let cache: LivroDeCondicoes | null = null;

export function livroDeCondicoes(): LivroDeCondicoes {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(join(import.meta.dir, "condicoes.json"), "utf8"),
    ) as LivroDeCondicoes;
  }
  return cache;
}

export interface Falhas {
  leitura?: boolean;
  setup_respondeu?: boolean;
}

export interface Situacao {
  /** A condicao que da o nome ao que se ve primeiro (a mais grave, pela precedencia declarada). */
  condicao: NomeDeCondicao;
  /** Todas as condicoes activas, em ordem de precedencia - os impedimentos SOMAM-SE. */
  impedimentos: NomeDeCondicao[];
  abre: boolean;
  fecha: boolean;
  cancela: boolean;
  /** Calculado da config do dono (FR-042) - nunca escrito aqui. */
  alarma: boolean;
  /** Os eventos levantados pelas condicoes activas (nome + se o dono pediu para avisar). */
  eventos: { nome: string; avisa: boolean }[];
  porque: string;
}

export function situacaoDoInstrumento(
  leitura: { idade_do_dado_ms: number; estado_do_mercado: "aberto" | "fechado" },
  limiteDeIdadeMs: number | null,
  falhas: Falhas = {},
  divergente = false,
  config: ConfiguracaoDaConta,
): Situacao {
  const livro = livroDeCondicoes();
  const activas = new Set<NomeDeCondicao>(["normal"]);

  if (falhas.leitura === true) activas.add("sem_leitura");
  if (falhas.setup_respondeu === false) activas.add("congelada");
  if (divergente) activas.add("divergente");
  if (leitura.estado_do_mercado === "fechado") activas.add("mercado_fechado");

  // A idade do dado: "acima do limite declarado" (RN-D3) - o limite em si nao e velho.
  if (limiteDeIdadeMs !== null && leitura.idade_do_dado_ms > limiteDeIdadeMs) {
    activas.add("dado_velho");
  }

  const ordem = livro.precedencia.filter((c) => activas.has(c));
  const impedimentos = ordem.filter((c) => c !== "normal");

  const impede = (efeito: keyof EfeitoDaCondicao) =>
    impedimentos.some((c) => (livro.condicoes[c] as any)[efeito] === true);

  // O aviso NAO se decide aqui: aqui sabe-se apenas de QUE evento se trata. Quem decide se ele avisa
  // e a lista do dono (FR-042) - e e por isso que a config entra nesta funcao.
  const eventos = impedimentos
    .map((c) => livro.condicoes[c].evento)
    .filter((e): e is string => e !== null);
  const alarma = eventos.some((e) => deveAvisar(config, e));

  const condicao: NomeDeCondicao = impedimentos[0] ?? "normal";
  const efeitoDaCabeca = livro.condicoes[condicao];

  return {
    condicao,
    impedimentos,
    abre: !impede("impede_abrir"),
    fecha: !impede("impede_fechar"),
    cancela: !impede("impede_cancelar"),
    alarma,
    eventos: eventos.map((nome) => ({ nome, avisa: deveAvisar(config, nome) })),
    porque:
      impedimentos.length === 0
        ? efeitoDaCabeca.porque
        : impedimentos
            .map((c) => `${c}: ${livro.condicoes[c].porque}`)
            .join(" | "),
  };
}

/** Existe no conjunto fechado? Uma condicao inventada nao passa. */
export function condicaoConhecida(nome: string): boolean {
  return Object.prototype.hasOwnProperty.call(livroDeCondicoes().condicoes, nome);
}

/** O conjunto fechado das condicoes, como o data-model o declara. */
export const CONDICOES_DO_DATA_MODEL = [
  "normal",
  "sem_leitura",
  "divergente",
  "congelada",
  "mercado_fechado",
  "dado_velho",
] as const;

/**
 * Confere o livro das condicoes. Devolve as falhas: vazia = coerente.
 *
 * Este ficheiro governa TODAS as decisoes do ciclo, e por isso tem o mesmo tratamento da tabela de
 * transicoes: e dado, e conferido por programa. Uma condicao que exista no data-model e falte aqui
 * seria uma condicao que o ciclo nao sabe travar; uma condicao a mais seria uma trava que ninguem
 * sabe nomear; e uma condicao na precedencia que nao exista no livro seria uma ordem que nao ordena
 * nada. Aceita um livro por parametro para a prova negativa poder quebra-lo em memoria.
 */
export function conferirLivro(livro: LivroDeCondicoes = livroDeCondicoes()): string[] {
  const falhas: string[] = [];
  const declaradas = Object.keys(livro.condicoes);
  const efeitos = ["impede_abrir", "impede_fechar", "impede_cancelar"] as const;

  for (const nome of CONDICOES_DO_DATA_MODEL) {
    if (!declaradas.includes(nome)) {
      falhas.push(`condicao '${nome}' do conjunto fechado nao tem efeito declarado no livro`);
    }
  }
  for (const nome of declaradas) {
    if (!(CONDICOES_DO_DATA_MODEL as readonly string[]).includes(nome)) {
      falhas.push(`condicao '${nome}' no livro nao consta do conjunto fechado`);
    }
    const efeito = (livro.condicoes as any)[nome];
    for (const campo of efeitos) {
      if (typeof efeito[campo] !== "boolean") {
        falhas.push(`condicao '${nome}': '${campo}' tem de ser booleano declarado`);
      }
    }
    for (const campo of ["regra", "porque"]) {
      if (typeof efeito[campo] !== "string" || efeito[campo].length === 0) {
        falhas.push(`condicao '${nome}': '${campo}' em falta - uma trava sem razao escrita le-se mal`);
      }
    }
    if (efeito.evento !== null && !eventoConhecido(efeito.evento)) {
      falhas.push(
        `condicao '${nome}': evento '${efeito.evento}' nao consta do conjunto fechado (eventos.json)`,
      );
    }
  }

  // A precedencia tem de ser uma ordem TOTAL do conjunto: cada condicao exactamente uma vez.
  for (const nome of CONDICOES_DO_DATA_MODEL) {
    const vezes = livro.precedencia.filter((c) => c === nome).length;
    if (vezes !== 1) {
      falhas.push(`precedencia: '${nome}' aparece ${vezes} vezes (tem de aparecer exactamente uma)`);
    }
  }
  for (const nome of livro.precedencia) {
    if (!declaradas.includes(nome)) {
      falhas.push(`precedencia: '${nome}' nao existe no livro`);
    }
  }

  return falhas;
}
