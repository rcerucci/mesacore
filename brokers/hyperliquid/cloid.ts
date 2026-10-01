// O `cloid` do venue — a referencia de cliente do contrato traduzida para a forma que a Hyperliquid aceita.
//
// O QUE ESTE FICHEIRO E: a derivacao PURA da referencia. A MESMA referencia da SEMPRE o mesmo `cloid` — e e
// isso que faz o reenvio nao duplicar ordem (RN-H9, RN-C4, FR-011). Nao ha relogio, rede, ficheiro nem
// aleatoriedade dentro: se um instante entrasse na derivacao, cada reenvio seria uma ordem NOVA, que e
// exactamente o defeito que se quer evitar.
//
// O QUE ELE NAO FAZ: nao decide se se opera, nem o lado, nem o tamanho, nem o preco, nem o momento (RN-C5,
// RN-C15). Traduz a referencia — e so. Nao importa o `core` (RN-E1).
//
// A FORMA (medida na documentacao oficial do venue e nos tipos do SDK, RN-H9): `cloid` e uma string
// hexadecimal de 128 bits — `0x` + 32 digitos. Este ficheiro NUNCA devolve outra forma; se a derivacao
// produzisse outra coisa, era agora que se sabia, e nao no venue.
//
// A DERIVACAO DECLARADA (vai no manifesto, FR-005): sha256 sobre o dominio + conta + instrumento +
// referencia, truncado aos primeiros 16 bytes. Nenhuma derivacao e "a certa" por natureza — o que a regra
// exige e que seja FIXA e DECLARADA. Esta e fixa e esta escrita aqui, em cima da mesa.

import { createHash } from "node:crypto";

export type Feito = { ok: true; cloid: string };
export type Recusa = { ok: false; motivo: string; porque: string };
export type Resultado = Feito | Recusa;

/** A forma do `cloid` da Hyperliquid: `0x` + 32 hexadecimais (128 bits). Nao ha outra. */
export const FORMA_DO_CLOID = /^0x[0-9a-f]{32}$/;

/** O dominio separa esta derivacao de qualquer outro uso do mesmo hash (evita cruzar derivacoes). */
const DOMINIO = "mesacore/cloid/v1";

/** A derivacao escrita como TEXTO, para o manifesto poder nomea-la (FR-005). Nao e para ser interpretada. */
export const DERIVACAO_DO_CLOID =
  'sha256("mesacore/cloid/v1" + conta + instrumento + referencia_do_cliente), primeiros 16 bytes (128 bits), ' +
  "escrito como 0x + 32 hexadecimais minusculos";

// As formas vem do CONTRATO, nao de gosto nosso: `correlacao` e `instrumento` de contracts/_defs/forma.schema.json.
// Um nome inventado aqui nao passa pelo conjunto fechado (D5).
const PADRAO_CORRELACAO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const PADRAO_INSTRUMENTO = /^[A-Z0-9][A-Z0-9._/-]{1,31}$/;

function recusa(motivo: string, porque: string): Recusa {
  return { ok: false, motivo, porque };
}

/**
 * Deriva o `cloid` de (conta, instrumento, referencia de cliente). PURA: o resultado depende so dos tres
 * argumentos — chamada duas vezes com os mesmos tres, da o mesmo (e e isso a idempotencia do reenvio).
 *
 * Fail-closed: ausente, nulo, vazio ou fora da forma do contrato NAO vira um derivado de nada — recusa com
 * motivo nomeado do conjunto fechado do contrato.
 */
export function derivarCloid(conta: string, instrumento: string, referencia: string): Resultado {
  const campos: [string, unknown][] = [
    ["conta", conta],
    ["instrumento", instrumento],
    ["referencia_do_cliente", referencia],
  ];
  for (const [nome, valor] of campos) {
    if (valor === undefined) return recusa("campo_obrigatorio_ausente", `falta ${nome}: sem ele nao ha cloid a derivar`);
    if (valor === null) return recusa("valor_nulo_nao_permitido", `${nome} veio a null, e null nao existe no contrato (D4)`);
    if (typeof valor !== "string" || valor === "") {
      return recusa("formato_invalido", `${nome} tem de ser texto nao vazio, e veio ${JSON.stringify(valor)}`);
    }
  }

  if (!PADRAO_INSTRUMENTO.test(instrumento)) {
    return recusa("formato_invalido", `o instrumento ${JSON.stringify(instrumento)} nao tem a forma do contrato`);
  }
  if (!PADRAO_CORRELACAO.test(referencia)) {
    return recusa(
      "formato_invalido",
      `a referencia_do_cliente ${JSON.stringify(referencia)} nao tem a forma que o contrato exige (correlacao)`,
    );
  }

  // A referencia NAO vai crua para o venue: entra so como material da derivacao, e sai hasheda.
  const material = [DOMINIO, conta, instrumento, referencia].join("\u0000");
  const cloid = "0x" + createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);

  // Invariante da forma: se um dia a derivacao mudar de tamanho, o vermelho aparece aqui — nao no venue.
  if (!FORMA_DO_CLOID.test(cloid)) {
    return recusa("formato_invalido", `a derivacao produziu ${cloid}, que nao e a forma do venue`);
  }
  return { ok: true, cloid };
}

/**
 * AS CLASSIFICACOES EM QUE O VENUE CONFIRMA A NOSSA ORDEM — o subconjunto do conjunto FECHADO do contrato
 * (`contracts/vocabulario.json`, `classificacoes_de_desfecho` = `aceite|parcial|desconhecido|recusado`).
 *
 * `desconhecido` NAO confirma (o venue nao respondeu) e `recusado` NAO confirma (o venue negou). So' em
 * `aceite` e `parcial` a ordem que NOS enviamos ficou — e so' nelas o `cloid` que o venue publicou identifica
 * uma posicao NOSSA.
 */
export const CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM: readonly string[] = ["aceite", "parcial"];

export type CloidDoPreenchimento =
  | { ok: true; cloid: string }
  | { ok: false; porque: string };

/**
 * O `cloid` que o VENUE publicou no preenchimento da ordem que NOS enviamos, lido do desfecho.
 *
 * PORQUE ISTO EXISTE, e o defeito que o torna necessario (medido a 01/10/2026, conta `hl-teste-plugin`): a
 * ordem `61581177468` foi preenchida (0.00117 @ 84367.0) e o venue devolveu a NOSSA marca no `cloid`
 * (`resposta_do_venue.bruto.cloid = 0xbf62594cce5cacfd083dd6d15cd97aa8`). O mapa de marcas ficou VAZIO por
 * duas razoes, e e' esta funcao que fecha as duas:
 *
 *   1. a guarda comparava a classificacao com `aceita`/`preenchida` — palavras que o conjunto fechado do
 *      contrato NAO tem (o vocabulario e' `aceite`, nunca `aceita`). Nenhum desfecho passava;
 *   2. a chave registada era o `cloid` DERIVADO AQUI, do NOME da conta — e o conector deriva-o do ENDERECO
 *      (`estado.ficha.conta`). Sao valores diferentes (medido: `0xbf62594c...` do venue contra
 *      `0x349994e8...` do nome): a chave do mapa tem de ser a que o venue guarda, porque e' com ela que se
 *      cruza o que ele publica em `userFills` (`leitura-do-mercado.ts`).
 *
 * Fail-closed: sem confirmacao, sem `cloid`, ou com uma carga que nao se leia, NAO se regista marca nenhuma —
 * e diz-se por que'. Nunca se inventa uma chave: uma marca registada com a chave errada nao liga posicao
 * nenhuma, e uma marca registada sem confirmacao diz que a posicao e' nossa quando o venue nao o disse.
 */
export function cloidDoPreenchimento(carga: unknown): CloidDoPreenchimento {
  if (typeof carga !== "object" || carga === null || Array.isArray(carga)) {
    return {
      ok: false,
      porque: `a carga do desfecho nao e' um objecto (veio ${JSON.stringify(carga)}): sem ela nao se sabe o que o venue respondeu`,
    };
  }
  const c = carga as Record<string, unknown>;
  const classificacao = c.classificacao;
  if (typeof classificacao !== "string" || !CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM.includes(classificacao)) {
    return {
      ok: false,
      porque:
        `a classificacao ${JSON.stringify(classificacao)} nao confirma a nossa ordem: so' ` +
        `\`${CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM.join("`|`")}\` dizem que a ordem que NOS enviamos ficou. ` +
        "Um desfecho sem confirmacao nao regista marca nenhuma (o `cloid` derivado aqui nao vale por confirmacao).",
    };
  }
  const resposta = c.resposta_do_venue;
  const bruto =
    typeof resposta === "object" && resposta !== null && !Array.isArray(resposta)
      ? (resposta as Record<string, unknown>).bruto
      : undefined;
  const cloid =
    typeof bruto === "object" && bruto !== null && !Array.isArray(bruto)
      ? (bruto as Record<string, unknown>).cloid
      : undefined;
  if (typeof cloid !== "string" || cloid === "") {
    return {
      ok: false,
      porque:
        "o venue confirmou a ordem mas nao publicou o `cloid` do preenchimento em `resposta_do_venue.bruto`: " +
        "sem a chave que o VENUE guardou a marca nao se registe — o `cloid` derivado aqui (do nome da conta) " +
        "nao e' o que o venue guardou, e um mapa com a chave errada nao liga posicao nenhuma",
    };
  }
  return { ok: true, cloid };
}
