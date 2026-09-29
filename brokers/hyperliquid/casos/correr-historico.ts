#!/usr/bin/env bun
// A BANCADA DO LEITOR DE HISTORICO (FR-018/FR-019) — o conferidor com dentes dos casos `historico.casos.json`.
//
// O que esta bancada prova, e por que cada prova existe:
//
//   1. A LEITURA. As execucoes, as taxas, o funding e o resultado entram como DADO (a resposta do venue) e saem
//      como grandezas com ORIGEM (RN-C11). Nenhum caso espera um TOTAL: somar e do venue, nunca da mesa.
//   2. O DESCONHECIDO. Uma leitura que falha, um campo que o venue nao deu e uma lista vazia NAO viram zero,
//      nem «sim», nem uma linha inventada: saem `nao_publicado`, pelo nome, com a razao — ou a leitura RECUSA,
//      nomeando o motivo. Fail-closed (a mesma regra da FR-017).
//   3. A PROVA NEGATIVA DE FR-019/FR-018 (`nao_soma_o_resultado`). O conferidor SOMA, so para provar, os
//      `closedPnl` que o venue publicou e exige que esse numero NAO APARECA em lado nenhum da leitura. Se
//      aparecesse, seria a mesa a reconstruir o resultado da corretora — o defeito que a regra proibe.
//   4. A CARGA DO CONTRATO. A carga montada e entregue ao CONTRATO (o esquema, via `validar`) e o veredicto
//      dele e conferido. Onde o venue nao da a grandeza, a CHAVE NAO E ESCRITA: uma chave ausente e o que o
//      contrato chama ausencia (D4: `null` nao existe) — e o conferidor verifica que nenhum `null` viaja.
//
// Uso:  bun run brokers/hyperliquid/casos/correr-historico.ts [--casos <ficheiro>]
// Sai 1 se houver divergencia.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cargaDoHistorico, lerHistorico, type PedidoDeHistorico, type RespostasDoHistorico } from "../historico.ts";
import { validar, versaoVigente } from "../../../contracts/esqueleto/framing.ts";

const CASOS_POR_OMISSAO = join(import.meta.dir, "historico.casos.json");

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Caminhos: `a.b[0].c` — para conferir, mudar e apagar campos das respostas do venue.
// ---------------------------------------------------------------------------------------------------------

type Passo = string | number;

function passos(caminho: string): Passo[] {
  const fora: Passo[] = [];
  for (const parte of caminho.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (parte === "") continue;
    fora.push(/^\d+$/.test(parte) ? Number(parte) : parte);
  }
  return fora;
}

function lerCaminho(raiz: unknown, caminho: string): unknown {
  let atual: any = raiz;
  for (const p of passos(caminho)) {
    if (atual === null || atual === undefined) return undefined;
    atual = atual[p as any];
  }
  return atual;
}

function escreverCaminho(raiz: any, caminho: string, valor: unknown): void {
  const p = passos(caminho);
  let atual: any = raiz;
  for (let i = 0; i < p.length - 1; i += 1) atual = atual[p[i] as any];
  atual[p[p.length - 1] as any] = valor;
}

function apagarCaminho(raiz: any, caminho: string): void {
  const p = passos(caminho);
  let atual: any = raiz;
  for (let i = 0; i < p.length - 1; i += 1) atual = atual[p[i] as any];
  delete atual[p[p.length - 1] as any];
}

/** Ha `null` em qualquer folha? O contrato proibe-o (D4): uma folha nula e uma ausencia mal escrita. */
function haNulo(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) return v.some(haNulo);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(haNulo);
  return false;
}

/** Soma decimais TEXTUAIS em BigInt (so para a prova negativa: o conferidor soma onde nos NAO podemos somar). */
function somarDecimais(valores: string[]): string {
  const escala = Math.max(...valores.map((v) => (v.split(".")[1] ?? "").length));
  let total = 0n;
  for (const v of valores) {
    const sinal = v.startsWith("-") ? -1n : 1n;
    const [inteira, fracao = ""] = v.replace(/^-/, "").split(".");
    total += sinal * BigInt(inteira + fracao.padEnd(escala, "0"));
  }
  const s = total.toString();
  const negativo = s.startsWith("-");
  const digitos = negativo ? s.slice(1) : s;
  const inteira = escala === 0 ? digitos : digitos.slice(0, -escala) || "0";
  const fracao = escala === 0 ? "" : digitos.slice(-escala);
  const texto = escala === 0 ? inteira : `${inteira}.${fracao}`;
  return negativo ? `-${texto}` : texto;
}

// ---------------------------------------------------------------------------------------------------------
// O caso: as respostas entram, o veredicto sai.
// ---------------------------------------------------------------------------------------------------------

type Checagem = {
  caso: string;
  base?: string;
  nota?: string;
  pedido?: Record<string, unknown>;
  respostas?: Record<string, unknown>;
  remover?: string[];
  mudar?: Record<string, unknown>;
  esperadoOk: boolean;
  motivo_esperado?: string | null;
  porque_contem?: string[];
  conferir?: Record<string, unknown>;
  contagens?: Record<string, number>;
  contem?: Record<string, string>;
  ausentes?: string[];
  nao_soma_o_resultado?: boolean;
  nao_tem_null?: boolean;
  carga?: {
    nao_leva?: string[];
    contrato_veredicto?: string;
    contrato_motivo?: string;
  };
  contrato_recusa_o_pedido?: boolean;
};

const caminho = argumento("--casos") ?? CASOS_POR_OMISSAO;
const ficheiro = JSON.parse(readFileSync(caminho, "utf8")) as {
  conta: string;
  instrumento: string;
  bases: Record<string, Record<string, unknown>>;
  casos: Checagem[];
};

const LADO = "\u00b7"; // o mesmo separador de campo das outras bancadas do recorte

/**
 * CORRE UM CASO e devolve o que divergiu. E uma funcao (e nao um bloco dentro do laco) porque as PROVOCACOES
 * NEGATIVAS do fim deste ficheiro correm os MESMOS casos com a expectativa torcida: se o conferidor nao
 * divergir com a expectativa errada, e ele que nao mede nada — um portao que nunca reprovou nao e um portao.
 */
function correrCaso(caso: Checagem): { erros: string[]; declaracoes: string[] } {
  const erros: string[] = [];
  const declaracoes: string[] = [];
  const base = ficheiro.bases[caso.base ?? "real"];
  if (base === undefined) {
    return { erros: [`a base \`${caso.base}\` nao existe no ficheiro de casos`], declaracoes };
  }
  const bruto = structuredClone(base) as Record<string, unknown>;

  // As respostas do caso: a base, sobreposta pelo que o caso declarar. Uma leitura declarada a falhar vem na
  // forma `{"__erro__": "..."}` — a MESMA convencao do duble do processo: o que nao se declarou nao vira
  // resposta vazia.
  for (const [chave, valor] of Object.entries(caso.respostas ?? {})) bruto[chave] = valor;
  for (const caminhoApagar of caso.remover ?? []) apagarCaminho(bruto, caminhoApagar);
  for (const [caminhoMudar, valor] of Object.entries(caso.mudar ?? {})) escreverCaminho(bruto, caminhoMudar, valor);

  const respostas: RespostasDoHistorico = {};
  for (const chave of ["execucoes", "ordens", "taxas", "funding_da_conta", "funding_publicado"]) {
    const v = bruto[chave];
    if (v === undefined) continue;
    const texto = JSON.stringify(v);
    if (v !== null && typeof v === "object" && !Array.isArray(v) && "__erro__" in (v as Record<string, unknown>)) {
      (respostas as any)[chave] = { ok: false, erro: (v as Record<string, unknown>).__erro__ };
    } else {
      (respostas as any)[chave] = { ok: true, valor: JSON.parse(texto) };
    }
  }

  const pedido: PedidoDeHistorico = {
    conta: ficheiro.conta,
    instrumento: ficheiro.instrumento,
    ...(caso.pedido ?? {}),
  } as PedidoDeHistorico;

  const r = lerHistorico(respostas, pedido);

  // A VISTA: onde as conferencias mordem. Leitura quando leu; o motivo e o porque quando recusou.
  const vista: any = r.ok ? r.leitura : { ok: false, motivo: r.motivo, porque: r.porque };

  if (r.ok !== caso.esperadoOk) {
    erros.push(`veredicto: esperado esperadoOk=${caso.esperadoOk}, veio ${r.ok}${r.ok ? "" : ` (${r.motivo}: ${r.porque})`}`);
  }
  if (caso.motivo_esperado !== undefined && caso.motivo_esperado !== null && !r.ok && r.motivo !== caso.motivo_esperado) {
    erros.push(`motivo: esperado ${caso.motivo_esperado}, veio ${(r as any).motivo}`);
  }
  if (caso.motivo_esperado === null && !r.ok) erros.push(`motivo: esperado nenhum, veio ${(r as any).motivo}`);
  for (const trecho of caso.porque_contem ?? []) {
    const porque = r.ok ? "" : r.porque;
    if (!porque.includes(trecho)) erros.push(`porque nao contem ${JSON.stringify(trecho)}: ${porque.slice(0, 200)}`);
  }
  for (const [campo, esperado] of Object.entries(caso.conferir ?? {})) {
    const veio = lerCaminho(vista, campo);
    if (JSON.stringify(veio) !== JSON.stringify(esperado)) {
      erros.push(`conferir ${campo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`);
    }
  }
  for (const [campo, esperado] of Object.entries(caso.contagens ?? {})) {
    const veio = lerCaminho(vista, campo);
    const n = Array.isArray(veio) ? veio.length : typeof veio === "string" ? veio.length : undefined;
    if (n !== esperado) erros.push(`contagem ${campo}: esperado ${esperado}, veio ${n} (${JSON.stringify(veio)?.slice(0, 80)})`);
  }
  for (const [campo, trecho] of Object.entries(caso.contem ?? {})) {
    const veio = lerCaminho(vista, campo);
    const texto = typeof veio === "string" ? veio : JSON.stringify(veio);
    if (!texto?.includes(trecho)) erros.push(`contem ${campo}: nao contem ${JSON.stringify(trecho)}: ${texto?.slice(0, 200)}`);
  }
  for (const campo of caso.ausentes ?? []) {
    if (lerCaminho(vista, campo) !== undefined) erros.push(`ausente ${campo}: veio ${JSON.stringify(lerCaminho(vista, campo))}`);
  }
  if (caso.nao_tem_null === true && haNulo(vista)) {
    erros.push("a leitura tem uma folha `null`: o contrato proibe-a (D4) — a ausencia escreve-se pela AUSENCIA da chave");
  }

  // A PROVA NEGATIVA (FR-018/FR-019): o conferidor soma os `closedPnl` do venue e exige que a soma NAO apareca.
  if (caso.nao_soma_o_resultado === true) {
    const execucoes = (bruto.execucoes ?? []) as Record<string, unknown>[];
    const resultados = execucoes
      .filter((f) => f?.coin === pedido.instrumento)
      .map((f) => f?.closedPnl)
      .filter((v): v is string => typeof v === "string");
    if (resultados.length < 2) {
      erros.push(`prova negativa fraca: so ${resultados.length} `+ "`closedPnl` para somar (a prova exige 2 ou mais)");
    } else {
      const soma = somarDecimais(resultados);
      const textoDaLeitura = JSON.stringify(vista);
      if (textoDaLeitura.includes(soma)) {
        erros.push(`RECONSTRUCAO: a soma dos ${resultados.length} resultados do venue (${soma}) APARECE na leitura`);
      }
      declaracoes.push(
        `prova negativa de FR-019: ${resultados.length} resultados do venue somam ${soma}, e essa soma NAO aparece na leitura`,
      );
    }
  }

  // A CARGA DO CONTRATO: monta-se e entrega-se AO CONTRATO. O veredicto dele e o veredicto que se confere.
  if (caso.carga !== undefined && r.ok) {
    const carga = cargaDoHistorico(r.leitura);
    for (const chave of caso.carga.nao_leva ?? []) {
      if (chave in carga) erros.push(`a carga leva \`${chave}\`, que o venue nao deu (nem o contrato tem para o historico)`);
      const execucoes = (carga.execucoes ?? []) as Record<string, unknown>[];
      const comChave = execucoes.filter((e) => chave in e).length;
      if (comChave > 0) erros.push(`a carga leva \`${chave}\` em ${comChave} execucao(oes), e o venue nao a deu`);
    }
    const linha = JSON.stringify({ contrato: versaoVigente(), tipo: "historico", id: `${caso.caso}`, carga });
    const decisao = validar(linha);
    if (caso.carga.contrato_veredicto !== undefined && decisao.veredicto !== caso.carga.contrato_veredicto) {
      erros.push(`contrato: esperado ${caso.carga.contrato_veredicto}, veio ${decisao.veredicto}/${decisao.motivo}`);
    }
    if (caso.carga.contrato_motivo !== undefined && decisao.motivo !== caso.carga.contrato_motivo) {
      erros.push(`contrato: esperado motivo ${caso.carga.contrato_motivo}, veio ${decisao.motivo}`);
    }
    declaracoes.push(
      `a carga do contrato deste caso foi julgada pelo CONTRATO: ${decisao.veredicto}/${decisao.motivo ?? "-"} ` +
        `(execucoes: ${(carga.execucoes as unknown[]).length}; chaves que o venue nao deu NAO entram)`,
    );
  }

  if (caso.contrato_recusa_o_pedido === true) {
    // O CONTRATO NAO TEM PEDIDO DE HISTORICO — e o conferidor mede-o em vez de o afirmar: um pedido minimo
    // (`instrumento`, que e o que a mesa teria para dizer) e entregue ao contrato, e o veredicto dele e exigido.
    const linha = JSON.stringify({
      contrato: versaoVigente(),
      tipo: "historico",
      id: `${caso.caso}/pedido`,
      carga: { instrumento: ficheiro.instrumento },
    });
    const decisao = validar(linha);
    if (decisao.veredicto === "aceite") {
      erros.push("o contrato ACEITOU um pedido minimo de historico: entao existe tipo de pedido, e o modo `--historico` nao se justifica");
    } else if (caso.motivo_esperado !== undefined && caso.motivo_esperado !== null && decisao.motivo !== caso.motivo_esperado) {
      erros.push(`pedido recusado por ${decisao.motivo}, e esperava-se ${caso.motivo_esperado}`);
    }
    declaracoes.push(
      `o contrato recusa um PEDIDO de historico minimo (${decisao.veredicto}/${decisao.motivo}): o tipo ` +
        "`historico` e a forma da RESPOSTA — por isso o modo `--historico <coin>` do processo serve a mesma leitura",
    );
  }

  return { erros, declaracoes };
}

// ---------------------------------------------------------------------------------------------------------
// A CORRIDA DOS CASOS, e depois as PROVOCACOES DO PROPRIO CONFERIDOR.
// ---------------------------------------------------------------------------------------------------------

const divergencias: string[] = [];
const declaracoes: string[] = [];
let ok = 0;

for (const caso of ficheiro.casos) {
  const r = correrCaso(caso);
  declaracoes.push(...r.declaracoes);
  if (r.erros.length > 0) divergencias.push(`DIVERGE ${caso.caso}: ${r.erros.join(" | ")}`);
  else ok += 1;
}

/**
 * AS PROVOCACOES (o conferidor SABE reprovar?). Cada uma torce um caso que passou e exige que ele DIVIRJA.
 * Sem isto, «0 divergentes» poderia ser um conferidor que compara nada com nada.
 */
const provocacoes: string[] = [];
const casoBom = ficheiro.casos.find((c) => c.esperadoOk === true);
const casoRuim = ficheiro.casos.find((c) => c.esperadoOk === false);
if (casoBom === undefined || casoRuim === undefined) {
  provocacoes.push("o ficheiro de casos nao tem um caso bom e um caso ruim para provocar o conferidor");
} else {
  const torcer = (nome: string, caso: Checagem, deveDivergir: boolean): void => {
    const r = correrCaso(caso);
    if (deveDivergir === (r.erros.length > 0)) return;
    provocacoes.push(
      `provocacao \`${nome}\`: ${deveDivergir ? "nao divergiu" : "divergiu"} — ` +
        `${r.erros.length > 0 ? r.erros[0] : "o conferidor nao mede o que diz medir"}`,
    );
  };
  // 1. o veredicto invertido
  torcer("veredicto-invertido", { ...casoBom, esperadoOk: false }, true);
  // 2. uma conferencia com o valor errado
  torcer("conferir-errado", { ...casoBom, conferir: { ...(casoBom.conferir ?? {}), instrumento: "NAO-E-BTC" } }, true);
  // 3. um campo que existe declarado como ausente
  torcer("ausente-que-existe", { ...casoBom, ausentes: ["instrumento"] }, true);
  // 4. uma recusa que devia ter sido leitura (o contrario tambem tem de morder)
  torcer("recusa-invertida", { ...casoRuim, esperadoOk: true }, true);
}

for (const d of divergencias) console.log(d);
for (const d of declaracoes) console.log(d);
for (const p of provocacoes) console.log(p);

// A ULTIMA LINHA e o placar, e sai pelo STDERR (a mesma convencao das outras bancadas deste recorte):
// `provas-offline.sh` captura os dois canos juntos e exige `0 divergentes` NA ULTIMA linha.
console.error(
  `historico: ${ficheiro.casos.length} casos ${LADO} ${ok} ok ${LADO} ${divergencias.length} divergentes ${LADO} ` +
    `${declaracoes.length} declaracoes ${LADO} ${provocacoes.length} provocacoes divergentes (esperado: 0)`,
);
process.exit(divergencias.length === 0 && provocacoes.length === 0 ? 0 : 1);
