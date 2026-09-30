// O registo da mesa: uma linha por acontecimento, com o motivo sempre presente.
//
// FR-041: toda a transicao, toda a recusa e todo o desfecho ficam registrados com instante e motivo.
// SC-011: um dia de operacao tem de ser reconstruivel a partir daqui, SEM LER CODIGO - e cada linha
// traz o motivo da decisao de NAO fazer.
//
// Os tipos de linha sao um conjunto FECHADO PROPRIO (R8 do specs/002). O contrato (recorte 001) tem
// `tipos_de_linha_do_registo` = snapshot | proposta | boleta | desfecho, que sao as mensagens DO
// CONTRATO; uma transicao de estado ou uma recusa de comando nao sao mensagens do contrato - sao
// acontecimentos da mesa. Quando o ledger tiver o seu recorte, as duas listas tem de ser
// reconciliadas: uma delas ganha, e nao ha duas verdades sobre a mesma linha.

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tiposDeLinhaDoRegisto } from "../livro-de-motivos.ts";

export const CAMINHO_DO_REGISTO = join(import.meta.dir, ".registo.jsonl");

/** Os tipos de linha da MESA. Nao se confundem com os do contrato (ver cabecalho). */
export const TIPOS_DA_MESA = ["transicao", "recusa", "ciclo", "marca"] as const;
export type TipoDaLinha = (typeof TIPOS_DA_MESA)[number];

export interface LinhaDoRegisto {
  instante_ms: number;
  tipo: TipoDaLinha;
  /**
   * DE QUE CONTA fala a linha (residuo do D-004). Vem de `conta.identificador` da configuracao - o nome que
   * distingue duas contas do mesmo venue.
   *
   * Opcional, e de proposito: uma mesa que nao saiba qual e' escreve a linha SEM conta, e isso diz-se. O que
   * nao pode acontecer e' a linha ficar muda sobre o assunto quando ha mais de uma conta: sem este campo, a
   * perda maxima (CB), a sessao e a reconciliacao NAO sao atribuiveis (ver D-004).
   */
  conta?: string;
  /**
   * Em `ciclo`: o que a mesa decidiu fazer (`abrir|fechar|adoptar|nada`).
   *
   * Entra no registo por causa do SC-011: sem ele, um dia de operacao e reconstruivel quanto ao ESTADO e
   * nao quanto as DECISOES - e `nada` sem motivo passaria despercebido, que e exactamente a linha que
   * torna o dia inexplicavel (a mesa nao fez, e ninguem sabe porque).
   */
  acao?: string | null;
  de?: string;
  para?: string;
  instrumento?: string;
  verbo?: string;
  autor?: string;
  motivo: string | null;
  nota?: string;
}

let cacheTiposDoContrato: string[] | null = null;

/** Os tipos de linha do CONTRATO, lidos como dado (nunca reescritos aqui). */
export function tiposDoContrato(): string[] {
  if (!cacheTiposDoContrato) cacheTiposDoContrato = tiposDeLinhaDoRegisto();
  return cacheTiposDoContrato;
}

export function registar(linha: LinhaDoRegisto, caminho: string = CAMINHO_DO_REGISTO): void {
  if (!TIPOS_DA_MESA.includes(linha.tipo)) {
    throw new Error(`tipo de linha fora do conjunto da mesa: ${linha.tipo}`);
  }
  if (linha.tipo === "recusa" && !linha.motivo) {
    // Uma recusa sem motivo no registo e a pior linha possivel: parece um acontecimento e nao explica
    // nada. SC-011 conta exactamente estas.
    throw new Error("linha de recusa sem motivo: recusa sem motivo nao se registra, corrige-se.");
  }
  appendFileSync(caminho, JSON.stringify(linha) + "\n");
}

/** Uma transicao aceite. `conta` e' o `conta.identificador` da configuracao (D-004), quando se conhece. */
export function registarTransicao(
  instante_ms: number,
  de: string,
  para: string,
  verbo: string,
  autor: string,
  motivo: string | null,
  nota: string,
  caminho?: string,
  conta?: string,
): void {
  registar({ instante_ms, tipo: "transicao", conta, de, para, verbo, autor, motivo, nota }, caminho);
}

/** Uma recusa de comando. */
export function registarRecusa(
  instante_ms: number,
  de: string,
  verbo: string,
  autor: string,
  motivo: string,
  nota: string,
  caminho?: string,
  conta?: string,
): void {
  registar({ instante_ms, tipo: "recusa", conta, de, verbo, autor, motivo, nota }, caminho);
}

/** Uma decisao do ciclo: o tipo de linha próprio da mesa para o que ela decidiu fazer ou NAO fazer. */
export function registarCiclo(
  instante_ms: number,
  instrumento: string,
  acao: string,
  motivo: string | null,
  nota: string,
  caminho?: string,
  conta?: string,
): void {
  if (acao === "nada" && !motivo) {
    // A linha mais perigosa do registo: a mesa nao fez, e nao diz porque. SC-011 conta estas.
    throw new Error(
      `decisao de nao-fazer sem motivo (${instrumento}): "nada" sem motivo torna o dia inexplicavel - ` +
        "quem le o registo nao distingue 'nao havia nada a fazer' de 'havia e a mesa nao fez'.",
    );
  }
  registar({ instante_ms, tipo: "ciclo", conta, instrumento, acao, motivo, nota }, caminho);
}

/** Le as linhas do registo. Ficheiro ausente = nenhuma linha (e nao um erro). */
export function lerRegisto(caminho: string = CAMINHO_DO_REGISTO): LinhaDoRegisto[] {
  try {
    return readFileSync(caminho, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as LinhaDoRegisto);
  } catch {
    return [];
  }
}

/**
 * O instante em que a mesa entrou num estado, lido do PROPRIO registo.
 *
 * A mesa nao guarda estado em memoria que sobreviva (R3), mas o que ela ESCREVEU persiste - e o pedido de
 * encerramento tem de ser datado para o prazo correr. `null` quando nao ha transicao para aquele estado:
 * nesse caso nao ha pergunta datavel, e quem chama tem de recusar em vez de inventar um instante.
 */
export function ultimaTransicaoPara(estado: string, caminho?: string): LinhaDoRegisto | null {
  return lerRegisto(caminho).filter((l) => l.tipo === "transicao" && l.para === estado).at(-1) ?? null;
}

export function instanteDaUltimaTransicaoPara(estado: string, caminho?: string): number | null {
  return ultimaTransicaoPara(estado, caminho)?.instante_ms ?? null;
}

/**
 * As contas que aparecem no registo (residuo do D-004), e quantas linhas NAO dizem de que conta falam.
 *
 * Devolver as duas coisas e' o ponto: um leitor que so visse os nomes nao saberia que ha linhas mudas - e
 * uma linha muda, num registo com mais de uma conta, e' uma linha que nao se pode atribuir a ninguem.
 */
export function contasNoRegisto(linhas: LinhaDoRegisto[]): { contas: string[]; sem_conta: number } {
  const contas = new Set<string>();
  let sem_conta = 0;
  for (const l of linhas) {
    if (typeof l.conta === "string" && l.conta !== "") contas.add(l.conta);
    else sem_conta += 1;
  }
  return { contas: [...contas].sort(), sem_conta };
}

/**
 * A reconstrucao: le um registo e devolve o estado final - sem ler codigo (SC-011).
 *
 * Com `conta` (residuo do D-004), reconstroi SO as linhas daquela conta. Com mais de uma conta no mesmo
 * registo, o estado final do CONJUNTO nao e' o estado de nenhuma delas: as transicoes de uma intercalam-se
 * nas da outra, e reexecutar tudo junto da' um estado que nenhuma mesa teve. O parametro e' opcional porque
 * um registo de uma conta so' continua a reconstruir-se como sempre.
 */
export function reconstruir(linhas: LinhaDoRegisto[], estado_inicial = "parada", conta?: string): string {
  let estado = estado_inicial;
  for (const l of linhas) {
    if (conta !== undefined && l.conta !== conta) continue;
    if (l.tipo === "transicao" && l.para) estado = l.para;
  }
  return estado;
}
