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
export const TIPOS_DA_MESA = ["transicao", "recusa", "ciclo", "marca", "mandato"] as const;
export type TipoDaLinha = (typeof TIPOS_DA_MESA)[number];

import type { PedidoDeBoleta } from "../ciclo/decisao.ts";

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
   * Em `boleta`: A BOLETA QUE A MESA COMPOS, tal e qual. Vive aqui porque a mao (mesa -> conector) a vai ler
   * daqui para a entregar, e porque uma decisao de abrir sem a boleta a' vista e' uma decisao que ninguem pode
   * conferir depois. Sem ela o registo diz QUE se decidiu, e nao O QUE teria saido.
   */
  boleta?: PedidoDeBoleta;
  /**
   * Em `ciclo`: o que a mesa decidiu fazer (`abrir|fechar|adoptar|nada`).
   *
   * Entra no registo por causa do SC-011: sem ele, um dia de operacao e reconstruivel quanto ao ESTADO e
   * nao quanto as DECISOES - e `nada` sem motivo passaria despercebido, que e exactamente a linha que
   * torna o dia inexplicavel (a mesa nao fez, e ninguem sabe porque).
   */
  acao?: string | null;
  /**
   * Em `ciclo` com `acao: "abrir"`: A BARRA DA ENTRADA (D-021) — o instante do venue arredondado ao relogio da
   * ficha. E' OBRIGATORIA nessa linha, e `registarCiclo` recusa a entrada sem ela.
   *
   * Porque vive no registo, e nao so' em memoria: o travao de uma entrada por barra era uma `Map` que um
   * reinicio apagava, e o reinicio passou a ser caminho normal (ficha ligada a quente, RN-V10). Sem a barra
   * escrita, um reinicio a meio de uma barra deixaria passar uma SEGUNDA entrada na mesma barra — e uma
   * segunda entrada na mesma barra e' dinheiro a dobrar sem sinal nenhum a dobrar.
   */
  barra_ms?: number;
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
  boleta?: PedidoDeBoleta,
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
  boleta?: PedidoDeBoleta,
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
  boleta?: PedidoDeBoleta,
  /** A barra da entrada (D-021). Obrigatoria quando `acao === "abrir"` — ver a regra abaixo. */
  barra_ms?: number,
): void {
  if (acao === "nada" && !motivo) {
    // A linha mais perigosa do registo: a mesa nao fez, e nao diz porque. SC-011 conta estas.
    throw new Error(
      `decisao de nao-fazer sem motivo (${instrumento}): "nada" sem motivo torna o dia inexplicavel - ` +
        "quem le o registo nao distingue 'nao havia nada a fazer' de 'havia e a mesa nao fez'.",
    );
  }
  if (acao === "abrir" && (typeof barra_ms !== "number" || !Number.isFinite(barra_ms))) {
    // A BARRA DA ENTRADA E' OBRIGATORIA, e nao por gosto de completude: e' dela que a mesa volta a saber, depois
    // de um reinicio, se a barra actual ja' teve entrada. Sem ela, um reinicio a meio de uma barra compraria uma
    // segunda posicao no mesmo sinal (D-021) — e o registo, que existe para o dia ser reconstruivel, ficaria sem
    // a resposta justamente na linha em que ela decide dinheiro.
    throw new Error(
      `entrada sem barra no registo (${instrumento}): sem a barra da entrada, um reinicio da mesa nao sabe se a ` +
        "barra actual ja' teve entrada, e o travao de uma entrada por barra (D-021) ficaria por repor.",
    );
  }
  registar({ instante_ms, tipo: "ciclo", conta, instrumento, acao, motivo, nota, boleta, barra_ms }, caminho);
}

/**
 * UMA MUDANCA DO MANDATO EM VIGOR: um par que ENTRA no mandato, ou que SAI dele (RN-V10).
 *
 * Mudar os termos de uma mesa em operacao e' outro assunto — e a RN-V10 diz que tem registo proprio. Passou a
 * ser um acontecimento normal: quem escreve a configuracao e' o operador (a vista das fichas do dono, reescrita
 * a cada leitura), e uma ficha ligada a quente tem de entrar sem reiniciar a mesa. Entra um par por linha, com
 * o motivo — uma mudanca de termos em silencio seria exactamente o que a RN-V10 proibe.
 */
export function registarMudancaDeMandato(
  instante_ms: number,
  instrumento: string,
  entrou: boolean,
  motivo: string,
  nota: string,
  caminho?: string,
  conta?: string,
): void {
  registar({
    instante_ms,
    tipo: "mandato",
    conta,
    instrumento,
    de: entrou ? "fora_do_mandato" : "em_vigor",
    para: entrou ? "em_vigor" : "fora_do_mandato",
    motivo,
    nota,
  }, caminho);
}

/**
 * AS BARRAS DAS ULTIMAS ENTRADAS, por instrumento, lidas do registo (D-021).
 *
 * A mesa chama isto ao armar o relogio: e' assim que o travao de uma entrada por barra sobrevive ao processo
 * morrer. Quem nao tem entrada no registo fica FORA do mapa — que e' diferente de ter barra nula.
 *
 * Uma entrada sem barra no registo e' uma anomalia que se RECUSA: sem ela nao se sabe se a barra actual ja' teve
 * entrada, e semear o travao com o que nao se sabe seria repor o buraco por outra via.
 */
export function barrasDasUltimasEntradas(caminho?: string): Map<string, number> {
  const barras = new Map<string, number>();
  for (const linha of lerRegisto(caminho)) {
    if (linha.tipo !== "ciclo" || linha.acao !== "abrir" || typeof linha.instrumento !== "string") continue;
    if (typeof linha.barra_ms !== "number" || !Number.isFinite(linha.barra_ms)) {
      throw new Error(
        `o registo tem uma entrada de ${linha.instrumento} sem barra (instante ${linha.instante_ms}): sem ela ` +
          "nao se sabe se a barra actual ja' teve entrada, e semear o travao com o que nao se sabe seria repor o " +
          "buraco por outra via.",
      );
    }
    // O ULTIMO vence: o registo esta' por ordem, e a barra que interessa e' a da entrada mais recente.
    barras.set(linha.instrumento, linha.barra_ms);
  }
  return barras;
}

/**
 * O ULTIMO CICLO ESCRITO NO REGISTO — de onde a mesa CONTINUA, e nao de zero.
 *
 * PORQUE ISTO EXISTE (medido a 04/10/2026, decisao do dono). A referencia do cliente e' `mesa-<ficha>-<ciclo>` e o
 * `cloid` do venue deriva dela. Com o `ciclo` a comecar em 0 em CADA arranque, a corrida nova RE-USA as referencias
 * da anterior; o conector, ao reconciliar ANTES de enviar, encontra o `cloid` antigo no registo de ordens do venue
 * e RECUSA nomeado (`referencia_ja_enviada_ao_venue`) — e o que o motor QUERIA enviar perde-se em silencio (medido:
 * as referencias 47 e 48 de uma corrida apontavam para ordens antigas, oids 6168…/6167…). Continuar a contagem do
 * registo mantem a referencia unica DENTRO da corrida, e a guarda do venue continua a travar o reenvio da MESMA
 * boleta (o `cloid` so' repete para a mesma referencia, e a mesma referencia so' vem da mesma decisao).
 *
 * Le-se do que JA' esta' escrito, sem acrescentar campo nenhum: a `boleta` da linha (quando ha') traz
 * `referencia_do_cliente` com o `ciclo` na cauda, e a `nota` de toda a linha de ciclo comeca por `ciclo N,`.
 * Uma linha ilegivel e' SALTADA (nao se deixa cair o ficheiro todo por causa dela) — sem ciclo legivel nenhum,
 * devolve 0, que e' o comportamento de hoje.
 *
 * LIMITE MEDIDO, e o dono decidiu mante-lo (04/10/2026): isto continua a contagem DENTRO deste registo. Numa
 * pasta de corrida NOVA (o scratch e' podado), o contador volta a 1 e uma referencia pode colidir com uma ordem
 * ANTIGA do venue — medido ao vivo nesta data: `mesa-sigma_v0-000007` foi RECUSADA (`referencia_ja_enviada_ao_venue`)
 * e so' a `-000029` saiu. O risco e' real porque a regra e' «a entrada so' acontece na barra do flip»: uma recusa
 * NESSA barra perde a entrada. Fica dito (e nao escondido); a decisao de o corrigir por outra via e' do dono.
 */
export function ultimoCicloDoRegisto(caminho: string = CAMINHO_DO_REGISTO): number {
  let maior = 0;
  let bruto: string;
  try {
    bruto = readFileSync(caminho, "utf8");
  } catch {
    return 0;
  }
  for (const linha of bruto.split("\n")) {
    if (linha.trim() === "") continue;
    let l: any;
    try {
      l = JSON.parse(linha);
    } catch {
      continue;
    }
    if (l?.tipo !== "ciclo") continue;
    // Sem `?? "literal"` (a casa exige ZERO fallbacks): a ausencia le-se com `typeof`, e o `null` do ternario
    // nao e' um valor por omissao — e' «nao ha'».
    const refCrua = (l?.boleta as Record<string, unknown> | undefined)?.referencia_do_cliente;
    const notaCrua = l?.nota;
    const daReferencia = typeof refCrua === "string" ? /-(\d+)$/.exec(refCrua) : null;
    const daNota = typeof notaCrua === "string" ? /^ciclo (\d+),/.exec(notaCrua) : null;
    const n = daReferencia !== null ? Number(daReferencia[1]) : daNota !== null ? Number(daNota[1]) : null;
    if (n !== null && n > maior) maior = n;
  }
  return maior;
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
