// O LEITOR da chave `conta.retencao_ledger` (RN-L6).
//
// A regra, por inteiro: «O ledger **nunca se reescreve**, mas a **retencao e declarada**: o que fica
// integral (o que se pode reexecutar), por quanto tempo, e o que passa a agregado. Sem regra escrita, um
// dia alguem apaga "para limpar" e perde-se o arquivo de tumulos.»
//
// Este ficheiro NAO apaga, NAO compacta e NAO reescreve nada. Faz as duas coisas que dao sentido a
// declaracao: (1) LE-A - e recusa uma declaracao ilegivel em vez de lhe dar um valor por omissao; (2) diz,
// para cada linha do registo, de que lado da fronteira ela esta. A compactacao em si e' acto OPERACIONAL
// (alguem, fora da mesa, agrega o que passou) - quem o corre le daqui a fronteira e o destino, e e' por
// isso que a fronteira e' um numero CALCULADO e nao uma regra de bolso escrita em prosa.
//
// A OMISSAO NAO APAGA NADA. Sem declaracao, nenhuma linha e' classificada como passada: o que se perde
// por nao haver regra e' a distincao, nunca o arquivo.

import type { LinhaDoRegisto } from "./registo.ts";

/** Um dia em ms (o tempo do contrato e' UTC em ms, RN-D2). */
export const MS_POR_DIA = 86_400_000;

/** A banda da declaracao. E' a MESMA do conferidor da configuracao
 *  (`tools/verificar-config/conferir-config.ts`): uma declaracao, uma banda. */
export const DIAS_INTEGRAL_MINIMO = 0;
export const DIAS_INTEGRAL_MAXIMO = 36_500;

export interface Retencao {
  /** Dias que ficam INTEGRAIS - o que se pode reexecutar. */
  dias_integral: number;
  /** O nome do que as linhas passam a ser depois da fronteira (agregado declarado pelo dono). */
  depois: string;
}

export interface Leitura {
  /** `null` quando a declaracao nao existe ou esta ilegivel - e nunca com um valor inventado. */
  retencao: Retencao | null;
  /** Vazio so quando a declaracao foi lida. Diz o que faltou, em palavras. */
  porque: string;
}

/** A forma textual de um inteiro que a configuracao aceita (`^-?(0|[1-9][0-9]*)$`). */
const INTEIRO = /^-?(0|[1-9][0-9]*)$/;

/**
 * Le a declaracao do que a configuracao traz. Aceita o numero e a sua forma textual (a configuracao aceita
 * as duas, e uma casa so pode ter UMA regra) e recusa tudo o resto.
 */
export function lerRetencao(bruto: unknown): Leitura {
  if (bruto === undefined || bruto === null) {
    return { retencao: null, porque: "`conta.retencao_ledger` nao esta declarada (RN-L6): sem declaracao nao se compacta nada" };
  }
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    return { retencao: null, porque: "`conta.retencao_ledger` tem de ser um objecto `{dias_integral, depois}`" };
  }
  const { dias_integral, depois } = bruto as { dias_integral?: unknown; depois?: unknown };

  const texto = typeof dias_integral === "number" ? String(dias_integral) : dias_integral;
  if (typeof texto !== "string" || !INTEIRO.test(texto)) {
    return { retencao: null, porque: `\`dias_integral\` tem de ser um inteiro sem casas decimais, e veio ${JSON.stringify(dias_integral ?? null)}` };
  }
  const dias = Number(texto);
  if (dias < DIAS_INTEGRAL_MINIMO || dias > DIAS_INTEGRAL_MAXIMO) {
    return { retencao: null, porque: `\`dias_integral\` tem de estar entre ${DIAS_INTEGRAL_MINIMO} e ${DIAS_INTEGRAL_MAXIMO}, e veio ${texto}` };
  }
  if (typeof depois !== "string" || depois.trim() === "") {
    return { retencao: null, porque: "`depois` tem de dizer o nome do agregado (texto nao vazio): sem destino declarado, a fronteira nao manda nada para lado nenhum" };
  }
  return { retencao: { dias_integral: dias, depois }, porque: "" };
}

export interface Fronteira {
  /** O instante da fronteira. As linhas com `instante_ms >= fronteira_ms` sao INTEGRAIS. */
  fronteira_ms: number;
  dias_integral: number;
  depois: string;
}

/** A fronteira, calculada a partir de um instante de referencia (o `agora` de quem le). */
export function fronteiraDaRetencao(retencao: Retencao, agora_ms: number): Fronteira {
  return {
    fronteira_ms: agora_ms - retencao.dias_integral * MS_POR_DIA,
    dias_integral: retencao.dias_integral,
    depois: retencao.depois,
  };
}

export interface Classificacao {
  integrais: LinhaDoRegisto[];
  passadas: LinhaDoRegisto[];
  /** A fronteira usada - `null` quando nao havia declaracao (e entao nada passou). */
  fronteira: Fronteira | null;
  /** Diz o que se fez e por que razao. Nunca vazio. */
  porque: string;
}

/**
 * Classifica as linhas de um registo contra a declaracao.
 *
 * A FRONTEIRA E' INCLUSIVA DO LADO DO INTEGRAL: uma linha com `instante_ms === fronteira_ms` ainda e'
 * integral. As duas metades estao em caso (`na-fronteira-e-integral` e `um-ms-antes-ja-passou`), porque uma
 * borda que ninguem mede e' uma borda que muda sozinha.
 */
export function classificar(linhas: LinhaDoRegisto[], retencao: Retencao | null, agora_ms: number): Classificacao {
  if (retencao === null) {
    return {
      integrais: [...linhas],
      passadas: [],
      fronteira: null,
      porque: "sem `conta.retencao_ledger` declarada nao se classifica NADA como passado: o registo fica integral por inteiro, e a falta da regra nao pode apagar o arquivo de tumulos (RN-L6)",
    };
  }
  const fronteira = fronteiraDaRetencao(retencao, agora_ms);
  const integrais: LinhaDoRegisto[] = [];
  const passadas: LinhaDoRegisto[] = [];
  for (const linha of linhas) {
    if (linha.instante_ms >= fronteira.fronteira_ms) integrais.push(linha);
    else passadas.push(linha);
  }
  return {
    integrais,
    passadas,
    fronteira,
    porque: `${integrais.length} linha(s) integral(is) e ${passadas.length} passada(s) para \`${fronteira.depois}\` (a fronteira e' ${fronteira.fronteira_ms}, ${fronteira.dias_integral} dia(s) antes de ${agora_ms})`,
  };
}
