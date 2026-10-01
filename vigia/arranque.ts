// O ARRANQUE DO OPERADOR — o que ele decide ANTES do primeiro tick, a partir do que ja' esta' no disco.
//
// Duas coisas, as duas com a MESMA origem (o ficheiro dos desfechos, `desfechos-<conta>.jsonl`) e a MESMA regra
// (o `cloid` que o VENUE guardou, de `cloidDoPreenchimento`):
//
//  1. NAO REENVIAR O QUE JA' FOI ENVIADO. O operador rele o registo desde o inicio (`posicaoNoRegisto = 0`) e o
//     carteiro levava TODAS as boletas que encontrasse — incluindo a abertura que ja' estava preenchida. Nesta
//     conta o registo tem exactamente UMA boleta, e reiniciar reenviava-a: uma ordem a mais no venue.
//
//     COMO SE SABE QUE FOI ENVIADA: pelo DESFECHO GRAVADO — e nao por um campo novo inventado no registo
//     (nada la' o diz, e um campo desses obrigaria a mesa a escreve-lo). Uma boleta cuja referencia tem linha
//     em `desfechos-<conta>.jsonl` ja' chegou ao venue e NAO se reenvia; uma boleta SEM desfecho reenvia-se —
//     foi enviada e o venue nao respondeu, e e' exactamente para isso que o `cloid` e' derivado da referencia:
//     a mesma referencia da' o mesmo `cloid`, e o reenvio nao duplica ordem (RN-H9).
//
//  2. RECONSTRUIR O MAPA. O mapa (`marcas-<conta>.jsonl`) so' ganhava linhas em RUNTIME: ao reiniciar, o
//     processo novo nao sabia das marcas que o processo anterior ja' tinha confirmado, e a posicao ABERTA
//     voltava a ler-se SEM marca — a mesa tratava-a como ALHEIA (`posicao_alheia_relatada_nao_gerida`) e
//     relatava-a sem a gerir. O mapa reconstroi-se a partir dos desfechos CONFIRMADOS que estao no ficheiro,
//     com a MESMA funcao que o runtime usa (`cloidDoPreenchimento`) — uma segunda regra sobre a mesma pergunta
//     era o defeito a nascer outra vez, noutro sitio.
//
// O QUE ESTE FICHEIRO NAO FAZ: nao decide se se opera (RN-C5), nao envia nada, e nao julga a classificacao por
// conta propria — a classificacao que confirma a ordem e' a do `cloidDoPreenchimento`.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { cloidDoPreenchimento } from "../brokers/hyperliquid/cloid.ts";

/** Uma boleta ja' enviada, na forma em que o operador a guarda na memoria (`envios`, `vigia/operador.ts`). */
export type EnvioRegistado = { marca: number; referencia: string; instrumento: string; recusado: boolean };

/** Uma linha de `desfechos-<conta>.jsonl`, como o operador a escreve: o ENVIO, mais o desfecho do venue. */
type LinhaDeDesfecho = {
  quando: string;
  marca: number;
  referencia: string;
  instrumento: string;
  recusado: boolean;
  desfecho: unknown;
};

function objecto(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * AS LINHAS DO FICHEIRO DOS DESFECHOS, ja' lidas e conferidas campo a campo.
 *
 * Uma linha ILEGIVEL RECUSA o arranque inteiro — nao se salta por cima dela, pela mesma razao que o mapa o
 * faz: uma linha que nao se le' e' uma boleta que pode voltar a sair (ordem a dobrar) E uma marca que nao entra
 * no mapa (posicao viva a ler-se como alheia). O ficheiro e' escrito por este processo, uma linha INTEIRA de
 * cada vez: um buraco nele e' um defeito que se tem de ver, nao um caso a tolerar em silencio.
 */
function lerLinhas(caminho: string): LinhaDeDesfecho[] {
  if (!existsSync(caminho)) return [];
  const linhas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");
  return linhas.map((l, i) => {
    const posicao = i + 1;
    let bruto: unknown;
    try {
      bruto = JSON.parse(l);
    } catch {
      throw new Error(
        `o ficheiro de desfechos (${caminho}) tem uma linha ilegivel na posicao ${posicao}: um buraco no ` +
          "registo das ordens decide duas coisas por engano — o que se reenvia e o que e' nosso",
      );
    }
    const o = objecto(bruto);
    if (o === undefined) {
      throw new Error(`a linha ${posicao} de ${caminho} nao e' um objecto: sem forma nao se sabe que boleta saiu`);
    }
    const referencia = typeof o.referencia === "string" && o.referencia !== "" ? o.referencia : undefined;
    if (referencia === undefined) {
      throw new Error(
        `a linha ${posicao} de ${caminho} nao traz \`referencia\`: sem ela nao se sabe que boleta ja' saiu, e a ` +
          "unica saida segura seria reenviar (que e' o defeito)",
      );
    }
    const instrumento = typeof o.instrumento === "string" && o.instrumento !== "" ? o.instrumento : undefined;
    if (instrumento === undefined) {
      throw new Error(`a linha ${posicao} de ${caminho} nao traz \`instrumento\`: a marca nao tem par a que pertencer`);
    }
    const marcaBruta = o.marca;
    if (typeof marcaBruta !== "number" || !Number.isFinite(marcaBruta)) {
      throw new Error(
        `a linha ${posicao} de ${caminho} nao traz \`marca\` numerica (veio ${JSON.stringify(marcaBruta)}): sem a ` +
          "marca a posse nao se reconstroi",
      );
    }
    const quando = typeof o.quando === "string" && o.quando !== "" ? o.quando : undefined;
    if (quando === undefined) {
      throw new Error(`a linha ${posicao} de ${caminho} nao traz \`quando\`: a marca reconstruida ficaria sem instante`);
    }
    return { quando, marca: marcaBruta, referencia, instrumento, recusado: o.recusado === true, desfecho: o.desfecho };
  });
}

/**
 * AS REFERENCIAS QUE O DESFECHO GRAVADO PROVA QUE JA' SAIRAM — a memoria que o processo perdeu ao reiniciar.
 *
 * Cada linha do ficheiro (desfecho do venue, ou resolucao) so' existe porque uma boleta NOSSA foi entregue ao
 * conector: e' a prova de envio que o registo nao guarda. Devolve-se com a mesma forma do mapa `envios` do
 * operador, para o arranque o poder semear sem traduzir nada.
 */
export function enviosJaRegistados(caminhoDosDesfechos: string): Map<string, EnvioRegistado> {
  const ja = new Map<string, EnvioRegistado>();
  for (const l of lerLinhas(caminhoDosDesfechos)) {
    ja.set(l.referencia, { marca: l.marca, referencia: l.referencia, instrumento: l.instrumento, recusado: l.recusado });
  }
  return ja;
}

/**
 * A REGRA DO CARTEIRO, com nome: esta boleta ja' saiu? Sim quando o desfecho dela esta' gravado.
 *
 * Existe como funcao (e nao como um `envios.has` solto no meio do laco) para a regra ter UM dono e um caso que
 * a mede: sem esta paragem, o arranque reenvia a boleta ja' preenchida, e um reenvio a mais e' dinheiro a
 * dobrar. O caso gemelo — boleta SEM desfecho — tem de CONTINUAR a sair: silenciar reenvios legitimos seria
 * trocar um defeito por outro.
 */
export function jaSaiu(referencia: string, jaEnviados: Map<string, EnvioRegistado>): boolean {
  return jaEnviados.has(referencia);
}

/** O que a reconstrucao do mapa fez — numeros para o arranque os poder dizer no log. */
export type ReconstrucaoDoMapa = {
  desfechos_lidos: number;
  marcas_reconstruidas: number;
  marcas_ja_no_mapa: number;
  desfechos_que_nao_confirmam: number;
};

/**
 * OS `cloid` QUE O MAPA JA' TEM — a chave do mapa e' o `cloid` (o que o venue guardou), e e' por ele que a
 * leitura de mercado liga a execucao a' marca (`leitura-do-mercado.ts`). Uma linha ilegivel RECUSA: um mapa com
 * buracos decide a posse por engano.
 */
function cloidsNoMapa(caminho: string): Set<string> {
  if (!existsSync(caminho)) return new Set();
  const linhas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");
  const cloids = new Set<string>();
  for (const l of linhas) {
    let bruto: unknown;
    try {
      bruto = JSON.parse(l);
    } catch {
      throw new Error(`o mapa de marcas (${caminho}) tem uma linha ilegivel: a posse nao se decide com um mapa furado`);
    }
    const r = objecto(bruto);
    const cloid = r !== undefined ? r.cloid : undefined;
    if (typeof cloid === "string" && cloid !== "") cloids.add(cloid);
  }
  return cloids;
}

/**
 * O MAPA RECONSTRUIDO A PARTIR DOS DESFECHOS CONFIRMADOS QUE ESTAO NO FICHEIRO.
 *
 * Append-only, como o mapa: o que ja' la' esta' nao se reescreve nem se repete; o que FALTA acrescenta-se. A
 * linha reconstruida tem a MESMA forma da linha de runtime (`apontarMarca`, `vigia/operador.ts`) — o mapa
 * continua a ser um registo de uma so' forma, e nao dois dialectos. O `quando` e' o INSTANTE DO DESFECHO: a
 * marca foi confirmada pelo venue naquele instante, e e' isso que a linha reconstruida esta' a dizer.
 *
 * O que NAO confirma nao entra: a carga passa pela MESMA guarda do runtime (`cloidDoPreenchimento`), e um
 * desfecho recusado, desconhecido, ou sem o `cloid` do venue NAO produz marca nenhuma — e' contado e dito.
 */
export function reconstruirMapaDeMarcas(caminhoDosDesfechos: string, caminhoDoMapa: string): ReconstrucaoDoMapa {
  const linhas = lerLinhas(caminhoDosDesfechos);
  const existentes = cloidsNoMapa(caminhoDoMapa);
  let reconstruidas = 0;
  let jaNoMapa = 0;
  let semConfirmacao = 0;
  for (const l of linhas) {
    const confirmado = cloidDoPreenchimento(l.desfecho);
    if (!confirmado.ok) {
      semConfirmacao += 1;
      continue;
    }
    if (existentes.has(confirmado.cloid)) {
      jaNoMapa += 1;
      continue;
    }
    appendFileSync(
      caminhoDoMapa,
      JSON.stringify({
        cloid: confirmado.cloid,
        marca: l.marca,
        referencia: l.referencia,
        instrumento: l.instrumento,
        quando: l.quando,
      }) + "\n",
    );
    existentes.add(confirmado.cloid);
    reconstruidas += 1;
  }
  return {
    desfechos_lidos: linhas.length,
    marcas_reconstruidas: reconstruidas,
    marcas_ja_no_mapa: jaNoMapa,
    desfechos_que_nao_confirmam: semConfirmacao,
  };
}
