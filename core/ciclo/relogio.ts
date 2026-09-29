// O RELOGIO DA MESA: o que ela faz enquanto ninguem lhe fala.
//
// Existe por causa de uma regra so - FR-006/RN-V6: uma mesa em operacao NUNCA depende de o vigia estar
// vivo. Sem relogio, a mesa so agiria quando lhe chegasse uma linha pela costura; o vigia morria, ninguem
// mandava mais nada, e a operacao parava. Isso e exactamente o contrario do que a fronteira promete, e e
// o que a US2 mede: com o vigia morto, N ciclos tem de dar N linhas novas no registo (SC-001).
//
// Um CICLO e uma volta: le os instrumentos que a operacao declara, decide cada um, e escreve no registo.
// A mesa decide e REGISTA; a entrega a corretora e do conector, no recorte dele - aqui nao ha socket, nao
// ha chave, e a boleta que a decisao produziu fica no registo, que e onde se pode ler o que se decidiu.
//
// O RISCO NAO VEM DAQUI. O mandato de cada instrumento sai da configuracao do DONO (`config.fichas`), e a
// operacao so traz o que o conector e o setup reportam (mercado, proposta, ficha em vigor, template). Se a
// operacao nomear um instrumento que o dono nao governou, a mesa GRITA no arranque do relogio: decidir sem
// mandato seria decidir por ele, e inventar um mandato por omissao e a forma mais silenciosa de o fazer.
//
// A PAUSA NAO PARA O RELOGIO. `pausada` suspende ABRIR e mais nada: defender continua. Por isso o ciclo
// corre com a mesa pausada ou em operacao, e o unico estado que o desliga e `parada` (nao ha operacao para
// defender). Um `if (pausada) return` aqui seria a mesma falha pela porta do lado.

import { readFileSync } from "node:fs";
import { registarCiclo } from "../estado/registo.ts";
import { lerParaOCiclo, type LeituraCompacta } from "../leitura/fixtures.ts";
import type { ConfiguracaoDaConta } from "../config/configuracao.ts";
import type { Marcas } from "../estado/marcas.ts";
import type { Estado } from "../estados/maquina.ts";
import type { Mandato, Template } from "./decisao.ts";
import { decidirInstrumento } from "./ciclo.ts";

/** O que a operacao declara de um instrumento: o que o conector e o setup reportam, e a ficha em vigor. */
export interface InstrumentoDaOperacao {
  /** A leitura compacta do instrumento (a porta de leitura valida-a contra o contrato). */
  leitura: LeituraCompacta;
  /** A proposta do setup, ou `null` quando ele nada propos - que NAO e o mesmo que `hold`. */
  proposta?: { lado?: unknown; setup?: unknown; relogio?: unknown } | null;
  /** O nome da ficha em vigor (o par risco+setup do lado do setup). */
  ficha: string;
  /** O lado do setup: quem escolhe o tipo de ordem e o setup (RN-B8). */
  template: Template;
  /** As marcas de posse que este lado conhece - e por elas que a posse se reconhece. */
  marcas_nossas_conhecidas?: number[];
}

export interface Operacao {
  nota?: string;
  /** O estado da ligacao reportado pelo conector (emenda 28 set 2026). */
  ligacao?: "ligada" | "sem_ligacao";
  instrumentos: Record<string, InstrumentoDaOperacao>;
}

/** Le a operacao. Nao se le: GRITA - um relogio sobre nada ciclaria em branco e pareceria operacao. */
export function lerOperacao(caminho: string): Operacao {
  let operacao: Operacao;
  try {
    operacao = JSON.parse(readFileSync(caminho, "utf8")) as Operacao;
  } catch (erro) {
    throw new Error(
      `a operacao nao se leu (${caminho}): ${(erro as Error).message}. Sem ela o relogio ciclaria sobre ` +
        "nada, e um ciclo sobre nada e uma mesa que parece a operar e nao opera.",
    );
  }
  const instrumentos = Object.keys(operacao?.instrumentos ?? {});
  if (instrumentos.length === 0) {
    throw new Error(`a operacao nao declara instrumento nenhum (${caminho}): um ciclo sem instrumentos nao decide nada.`);
  }
  return operacao;
}

/**
 * Confere que o dono governou cada instrumento da operacao.
 *
 * Grita no ARRANQUE do relogio e nao a cada ciclo: uma vez por volta seria a gritar a mesma coisa N vezes,
 * e a operacao nao muda debaixo dos pes do processo (e lida uma vez). Instrumento sem ficha e instrumento
 * sem mandato - e o mandato e do dono (RN-A1).
 */
export function conferirMandatos(operacao: Operacao, config: ConfiguracaoDaConta): void {
  const fichas = (config?.fichas ?? {}) as Record<string, Partial<Mandato>>;
  const semFicha = Object.keys(operacao.instrumentos).filter(
    (i) => typeof fichas[i]?.saldo_pct !== "string" || typeof fichas[i]?.alavancagem !== "string",
  );
  if (semFicha.length > 0) {
    throw new Error(
      `instrumento sem mandato do dono: ${semFicha.join(", ")}. A operacao reporta-o e a configuracao nao o ` +
        "governa; decidir sem mandato seria decidir pelo dono.",
    );
  }
}

export interface ResultadoDoCiclo {
  ciclo: number;
  /** As linhas que esta volta escreveu no registo. */
  linhas: number;
  /** O que se decidiu, por instrumento. */
  acoes: Record<string, string>;
  /** O motivo de cada decisao, por instrumento. A ACCAO diz o que se fez; o MOTIVO diz por que nao se fez
   *  o resto - e ha perguntas (a liquidacao acabou?) que so o motivo responde. */
  motivos: Record<string, string | null>;
}

export interface FontesDoCiclo {
  operacao: Operacao;
  config: ConfiguracaoDaConta;
  marcas: Marcas;
  /** O estado da mesa AGORA (o relogio le-o a cada volta: entre voltas pode ter mudado). */
  estado: Estado;
  /** O numero da volta. Vem de fora porque o relogio nao guarda contabilidade propria. */
  ciclo: number;
  instante_ms: number;
  caminhoDoRegisto?: string;
}

/** Uma volta do relogio: le, decide, registra. Devolve o que fez, para quem quiser contabilizar. */
export function correrUmCiclo(fontes: FontesDoCiclo): ResultadoDoCiclo {
  const { operacao, config, marcas, estado, ciclo, instante_ms } = fontes;
  const acoes: Record<string, string> = {};
  const motivos: Record<string, string | null> = {};
  let linhas = 0;

  for (const [instrumento, decl] of Object.entries(operacao.instrumentos)) {
    const entradas = lerParaOCiclo(decl.leitura, decl.proposta ?? null, ciclo);
    const mandato = (config.fichas as Record<string, Mandato>)[instrumento]!;
    const marcaDesconhecida = (marcas.desconhecido ?? []).find((d) => d.instrumento === instrumento) ?? null;

    const decisao = decidirInstrumento({
      mercado: entradas.mercado,
      proposta: entradas.proposta,
      proposta_invalida: entradas.proposta_invalida,
      motivo_do_contrato: entradas.motivo_do_contrato,
      ficha: decl.ficha,
      ciclo,
      ligacao: operacao.ligacao ?? "ligada",
      mandato,
      template: decl.template,
      marcas_nossas_conhecidas: decl.marcas_nossas_conhecidas ?? [],
      config,
      desconhecido: marcaDesconhecida,
      mesa_pausada: estado === "pausada",
    });

    registarCiclo(
      instante_ms,
      instrumento,
      decisao.acao,
      decisao.motivo,
      `ciclo ${ciclo}, condicao ${decisao.condicao}${decisao.boleta ? ", com boleta" : ""}`,
      fontes.caminhoDoRegisto,
    );
    acoes[instrumento] = decisao.acao;
    motivos[instrumento] = decisao.motivo;
    linhas += 1;
  }

  return { ciclo, linhas, acoes, motivos };
}
