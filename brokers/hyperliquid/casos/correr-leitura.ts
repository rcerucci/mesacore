// Corre os casos da LEITURA DA CONTA — em DADO, sem rede e sem chave.
// Um caso passa, ou e divergente: nao ha "quase".
//
// A `leitura_base` e a leitura COMO O VENUE A DEU (medida a 29 set 2026, em
// specs/004-conector-hyperliquid/relatorios/sonda-real.txt §3.1): as duas carteiras com os seus numeros
// medidos, zero posicoes, o instante do venue e o agente que assina por esta conta. Os casos de POSICAO
// partem de um DUBLE DECLARADO no mesmo relatorio (§3.2, provas 3 e 4) — NAO de uma medicao do venue — e
// cada um di-lo na sua nota: um numero que o venue nao deu nao entra aqui travestido de medicao.
//
// O que este corredor mede, e que nao e so "devolveu ok":
//   * o `motivo` de cada recusa existe no CONJUNTO FECHADO do contrato (contracts/vocabulario.json) — a
//     comparacao e contra a fonte, nao contra um literal escrito aqui;
//   * NENHUM `null` atravessa a leitura: varre-se o resultado e um `null` reprova o caso (o contrato nao
//     tem `null`; ausencia e a chave que nao esta la);
//   * uma posicao sem distancia de liquidacao TEM de dizer por que — e a distancia fica AUSENTE, nunca
//     zero, que pareceria um numero medido (FR-017);
//   * `confirmadas_pelo_venue` conta o que o venue respondeu, e nao o que se assume: bate com `nomes`, e
//     `nao_lidas` e o complemento — tres contagens que tem de fechar;
//   * os numeros da leitura sao DECIMAIS TEXTUAIS do contrato (nunca virgula flutuante do JSON);
//   * os campos que o caso declara AUSENTES nao existem mesmo (uma chave que la estivesse com zero ou com
//     um texto vazio passaria por "presente").

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerConta, type PedidoDeLeitura, type RespostasDaConta } from "../leitura.ts";
import { entradas, itens } from "./blocos.ts";

const RAIZ = join(import.meta.dir, "..", "..", "..");
const ficheiro = process.argv[2] ?? join(import.meta.dir, "leitura.casos.json");

function lerJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

const casos = lerJson(ficheiro);
const vocabulario = lerJson(join(RAIZ, "contracts", "vocabulario.json"));

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Copia profunda. Um caso NUNCA toca no objecto partilhado: sem copia, o primeiro caso que apaga um
 *  campo apagava-o para toda a bateria e os seguintes passavam a medir outra coisa. */
function copiar(v: any): any {
  if (Array.isArray(v)) return v.map(copiar);
  if (v !== null && typeof v === "object") {
    const saida: any = {};
    for (const [k, valor] of Object.entries(v)) saida[k] = copiar(valor);
    return saida;
  }
  return v;
}

/** Funde a mudanca do caso sobre a base, devolvendo SEMPRE objectos novos. Um `null` no JSON e um VALOR
 *  (o venue publica `liquidationPx: null`), e nao "nao mexer": por isso se copia, nao se salta.
 *
 *  Uma LISTA e substituida inteira, e nao fundida item a item: um caso que mexa numa posicao declara a
 *  posicao toda, e le-se no caso o que o venue (ou o duble declarado) respondeu. Fundir por indice
 *  deixaria a posicao meio caso e meio base — um fixture que ninguem consegue ler. */
function fundir(base: any, mudanca: any): any {
  const saida = copiar(base);
  if (mudanca === undefined || mudanca === null) return saida;
  for (const [k, v] of Object.entries(mudanca)) {
    const ambosObjectos =
      v !== null && typeof v === "object" && !Array.isArray(v) &&
      saida[k] !== null && typeof saida[k] === "object" && !Array.isArray(saida[k]);
    saida[k] = ambosObjectos ? fundir(saida[k], v) : copiar(v);
  }
  return saida;
}

/** `posicoes[0].distancia_de_liquidacao`: caminho com indices, para a ausencia de uma chave se poder medir. */
function porCaminho(obj: any, caminho: string): unknown {
  let alvo: any = obj;
  for (const parte of caminho.split(".")) {
    const m = /^([A-Za-z0-9_]+)((?:\[[0-9]+\])*)$/.exec(parte);
    if (m === null) return undefined;
    alvo = alvo === undefined || alvo === null ? undefined : alvo[m[1] as string];
    const indices = (m[2] as string).match(/\[[0-9]+\]/g);
    for (const idx of indices === null ? [] : indices) {
      alvo = Array.isArray(alvo) ? alvo[Number(idx.slice(1, -1))] : undefined;
    }
  }
  return alvo;
}

function apagar(obj: any, caminho: string): void {
  const partes = caminho.split(".");
  let alvo: any = obj;
  for (const k of partes.slice(0, -1)) {
    if (alvo === undefined || alvo === null) return;
    alvo = alvo[k];
  }
  const ultimo = partes[partes.length - 1];
  if (alvo !== undefined && alvo !== null && ultimo !== undefined) delete alvo[ultimo];
}

/** O PRIMEIRO `null` que a leitura deixou passar, pelo caminho. Nao ha `null` no contrato. */
function primeiroNull(obj: any, caminho = ""): string | undefined {
  if (obj === null) return caminho === "" ? "(a raiz)" : caminho;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const achado = primeiroNull(obj[i], `${caminho}[${i}]`);
      if (achado !== undefined) return achado;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const achado = primeiroNull(v, caminho === "" ? k : `${caminho}.${k}`);
      if (achado !== undefined) return achado;
    }
  }
  return undefined;
}

/** Todo `motivo` que a leitura escreveu, pelo caminho — para o conferir contra o conjunto do contrato. */
function motivos(obj: any, caminho = ""): { caminho: string; motivo: unknown }[] {
  const achados: { caminho: string; motivo: unknown }[] = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => achados.push(...motivos(v, `${caminho}[${i}]`)));
  } else if (obj !== null && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "motivo") achados.push({ caminho: `${caminho}.${k}`, motivo: v });
      else achados.push(...motivos(v, `${caminho}.${k}`));
    }
  }
  return achados;
}

function texto(v: unknown): v is string {
  return typeof v === "string";
}

let total = 0;
let ok = 0;
let divergentes = 0;

function registar(caso: string, esperadoOk: boolean, problemas: string[]): void {
  total++;
  const linha = {
    caso,
    implementacao: "hyperliquid",
    veredicto: problemas.length === 0 ? "ok" : "divergente",
    esperado_ok: esperadoOk,
    ...(problemas.length ? { problemas } : {}),
  };
  console.log(JSON.stringify(linha));
  if (problemas.length === 0) ok++;
  else divergentes++;
}

for (const c of casos.casos) {
  const base = c.base !== undefined ? casos.bases[c.base] : casos.bases.real;
  const respostas = fundir(base, c.respostas);
  for (const caminho of itens(c.remover, "remover") as string[]) apagar(respostas, caminho);
  const pedido: PedidoDeLeitura = { conta: casos.conta, ...(casos.instrumento !== undefined ? { instrumento: casos.instrumento } : {}) };

  const r = lerConta(respostas as RespostasDaConta, pedido);
  const problemas: string[] = [];

  if (r.ok !== !!c.esperadoOk) {
    problemas.push(`ok=${r.ok}, esperado=${!!c.esperadoOk}${r.ok ? "" : ` (${r.motivo}: ${r.porque})`}`);
  } else if (!r.ok) {
    if (c.motivo_esperado && r.motivo !== c.motivo_esperado) problemas.push(`motivo=${r.motivo}, esperado=${c.motivo_esperado}`);
    if (!texto(r.motivo) || !Object.prototype.hasOwnProperty.call(vocabulario.motivos, r.motivo)) {
      problemas.push(`motivo ${JSON.stringify(r.motivo)} nao existe no conjunto fechado do contrato`);
    }
    if (!texto(r.porque) || r.porque.length < 20) problemas.push("a recusa nao se explica (porque vazio ou curto)");
    if (c.porque_esperado !== undefined && r.porque !== c.porque_esperado) {
      problemas.push(`porque=${JSON.stringify(r.porque)}, esperado=${JSON.stringify(c.porque_esperado)}`);
    }
  } else {
    const L = r.leitura as any;

    // Nada de `null` atravessa a leitura (o contrato nao tem `null`).
    const sujo = primeiroNull(L);
    if (sujo !== undefined) problemas.push(`a leitura deixou passar um null em ${sujo}`);

    // As tres contagens das carteiras tem de FECHAR, e `confirmadas` nao se assume: conta o que respondeu.
    const nomes: unknown = L.carteiras?.nomes;
    const naoLidas: unknown = L.carteiras?.nao_lidas;
    if (!Array.isArray(nomes) || !Array.isArray(naoLidas)) {
      problemas.push("`carteiras.nomes`/`carteiras.nao_lidas` nao sao listas");
    } else {
      if (nomes.length + naoLidas.length !== 2) {
        problemas.push(`nomes (${nomes.length}) + nao_lidas (${naoLidas.length}) nao da as DUAS carteiras do venue`);
      }
      if (L.carteiras.confirmadas_pelo_venue !== nomes.length) {
        problemas.push(`confirmadas_pelo_venue=${L.carteiras.confirmadas_pelo_venue} e nomes=${nomes.length}: contagens que nao fecham`);
      }
    }

    // Os numeros da leitura sao decimais textuais — nunca virgula flutuante do JSON.
    for (const caminho of ["carteiras.perpetuo.equity", "carteiras.perpetuo.nocional_total", "carteiras.perpetuo.margem_usada", "carteiras.perpetuo.retiravel"]) {
      const v = porCaminho(L, caminho);
      if (v !== undefined && (!texto(v) || !DECIMAL.test(v))) problemas.push(`${caminho}=${JSON.stringify(v)} nao e decimal textual`);
    }
    for (const campo of ["unidades", "preco_medio", "nocional", "margem", "resultado_nao_realizado", "preco_de_liquidacao"]) {
      for (let i = 0; i < itens(L.posicoes, "posicoes").length; i++) {
        const v = porCaminho(L, `posicoes[${i}].${campo}`);
        if (v !== undefined && (!texto(v) || !DECIMAL.test(v))) problemas.push(`posicoes[${i}].${campo}=${JSON.stringify(v)} nao e decimal textual`);
      }
    }

    // Sem distancia, TEM de estar dito por que — e a distancia fica AUSENTE (nunca zero).
    for (let i = 0; i < itens(L.posicoes, "posicoes").length; i++) {
      const porque = porCaminho(L, `posicoes[${i}].porque_sem_distancia`);
      const distancia = porCaminho(L, `posicoes[${i}].distancia_de_liquidacao`);
      if (porque !== undefined && distancia !== undefined) {
        problemas.push(`posicoes[${i}]: diz que nao tem distancia (${JSON.stringify(porque)}) E publica ${JSON.stringify(distancia)}`);
      }
      if (porque === undefined && distancia === undefined) {
        problemas.push(`posicoes[${i}]: sem distancia de liquidacao e sem razao — ausencia sem razao parece esquecimento (FR-017)`);
      }
      if (distancia !== undefined) {
        const valor = porCaminho(L, `posicoes[${i}].distancia_de_liquidacao.valor`);
        if (!texto(valor) || !DECIMAL.test(valor)) problemas.push(`posicoes[${i}].distancia_de_liquidacao.valor=${JSON.stringify(valor)} nao e decimal textual`);
      }
    }

    // Todo `motivo` escrito pela leitura (a carteira que nao se leu) existe no conjunto fechado.
    for (const { caminho, motivo } of motivos(L)) {
      if (!texto(motivo) || !Object.prototype.hasOwnProperty.call(vocabulario.motivos, motivo)) {
        problemas.push(`${caminho}=${JSON.stringify(motivo)} nao existe no conjunto fechado do contrato`);
      }
    }

    for (const [caminho, esperado] of entradas(c.conferir, "conferir")) {
      const veio = porCaminho(L, caminho as string);
      if (JSON.stringify(veio) !== JSON.stringify(esperado)) {
        problemas.push(`${caminho}=${JSON.stringify(veio)}, esperado=${JSON.stringify(esperado)}`);
      }
    }
    for (const caminho of itens(c.ausentes, "ausentes") as string[]) {
      const veio = porCaminho(L, caminho as string);
      if (veio !== undefined) problemas.push(`${caminho} devia estar AUSENTE e veio ${JSON.stringify(veio)}`);
    }
  }

  registar(c.caso, !!c.esperadoOk, problemas);
}

console.error(`leitura: ${total} casos · ${ok} ok · ${divergentes} divergentes · ${casos.casos.length} declarados`);
process.exit(divergentes === 0 ? 0 : 1);
