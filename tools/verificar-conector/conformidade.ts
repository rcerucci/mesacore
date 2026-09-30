#!/usr/bin/env bun
// A BATERIA DE CONFORMIDADE DO CONECTOR (offline, com duble de mesa).
//
// O que ela prova, e com que leitura cada prova decide:
//
//   1. FORMA. Toda mensagem que o conector produz valida contra o ENVELOPE + o esquema do SEU tipo
//      (additionalProperties:false, decimal textual sem expoente, `null` proibido). Duas leituras
//      independentes do mesmo caso: o motor do contrato em TypeScript (contracts/esqueleto/framing.ts)
//      e o DUBLE DE MESA em Python (contracts/mocks/mesa). Divergencia entre as duas e FALHA.
//   2. AS SETE PORTAS do arranque, uma de cada vez, pela ordem declarada, com o motivo da PRIMEIRA que
//      falha e com a lista do que se chegou a olhar.
//   3. AS DUAS VERSOES: `carga.versao` e a versao do CONTRATO, `carga.conector.versao` e a do PLUGIN.
//      Trocadas, a mesa fica com duas verdades sobre o mesmo numero.
//   4. O VOCABULARIO FECHADO: os veredictos sao quatro, os motivos vem de contracts/vocabulario.json
//      (a FONTE - nunca um literal escrito aqui).
//   5. O MANIFESTO E FUNCAO PURA DA SONDA: capacidade nao declarada e RECUSA (`capacidade_nao_declarada`),
//      nunca `true` por omissao (fail-closed).
//   6. A MESA NAO SAI QUANDO A COSTURA FECHA (FR-006): com o cano fechado e em operacao, ela continua a
//      ciclar e a escrever no ledger. Mede-se pela CONTAGEM de linhas antes e depois, nao pelo tempo.
//   7. A VOLTA QUE ESPERA NAO E ACONTECIMENTO, e a RECUSA DE COMANDO transita X->X: par de controlo, os
//      dois lados escritos.
//   8. NENHUM VALOR DE CREDENCIAL no repositorio (RN-E14), com os dois controlos do varrimento.
//   9. INSTRUMENTO QUE NAO EXISTE NO MANIFESTO: recusa NOMEADA, dos dois lados (o conector e a mesa).
//
// O QUE ESTA BATERIA NAO PROVA, e di-lo em voz alta (FR-026 - prova que nao corre deixa o resultado
// INCOMPLETO, nunca "passou"): nada do venue. As provas no ambiente de TESTE da corretora (SC-004) sao a
// `tools/testar-venue/bateria.ts`, que corre com rede e com a chave POR REFERENCIA (o valor entra no processo
// do conector, nunca no desta bateria). Aqui nao ha rede, nao ha chave, e o unico "venue" e a sonda em dado.
//
// A BATERIA DE TESTE existe desde 29/09/2026, e o registro dela fica em
// `specs/004-conector-hyperliquid/relatorios/registos-do-venue/<versao>-teste.txt` (a saida crua do venue, por
// versao do contrato). Das provas dela, 11 de 14 passaram: as tres que reprovaram estao declaradas em
// `specs/002-maquina-de-estados/relatorios/DEFEITOS.md` (D-009 a idempotencia, D-010 a alavancagem que nunca e'
// pedida, D-011 o stop que nao sai), e ha uma incapacidade medida (D-012, o tipo `limite` inalcancavel).
//
// A PROVA NEGATIVA corre SEMPRE, em memoria: um envelope com campo a mais, um `null`, um decimal com
// expoente, um motivo fora do vocabulario, um veredicto fora do conjunto, uma versao trocada. Cada um TEM
// de reprovar - um portao que nunca reprovou nao e um portao.
//
// Uso:  bun tools/verificar-conector/conformidade.ts [--silencioso]

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { motivoConhecido, motivosDaMesa, vocabularioDoContrato } from "../../core/livro-de-motivos.ts";
import { construirManifesto, type Sonda } from "../../brokers/hyperliquid/manifesto.ts";
import { estaNoRepositorio } from "../../brokers/hyperliquid/credencial.ts";
import { arrancar, PORTAS } from "../../core/ciclo/arranque.ts";
import { Mesa } from "../../core/mesa.ts";
import { fundir } from "../verificar-maquina/fundir.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const CONTRATOS = join(RAIZ, "contracts");

/**
 * UMA BATERIA DE CADA VEZ - a mesma trava de pid de `tools/verificar-maquina/provar.sh`.
 *
 * Duas baterias ao mesmo tempo pisam-se (a prova negativa reescreve o manifesto, a mesa escreve estado
 * de runtime, os temporarios cruzam-se) e a segunda mede a sujeira da primeira. Quem chega depois RECUSA.
 *
 * A trava admite UMA excepcao: se o pid dela for um ANTEPASSADO meu, a corrida e a MESMA - quem me chamou
 * ja segura a porta (`provas-offline.sh` sob o `provar.sh`), e recusar-me aqui seria um impasse.
 */
function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return (erro as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

function paiDe(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const campos = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number(campos[1]);
    return Number.isInteger(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

function ehAntepassadoMeu(pid: number): boolean {
  let atual = process.pid;
  for (let i = 0; i < 8; i += 1) {
    const pai = paiDe(atual);
    if (pai === null || pai <= 1) return false;
    if (pai === pid) return true;
    atual = pai;
  }
  return false;
}

function tomarATrava(): () => void {
  const caminho = join(RAIZ, ".provar.lock");
  let dona = Number.NaN;
  try {
    dona = Number(readFileSync(caminho, "utf8").trim());
  } catch {
    dona = Number.NaN;
  }
  if (Number.isInteger(dona) && pidVivo(dona)) {
    if (!ehAntepassadoMeu(dona)) {
      console.error(
        `conformidade: RECUSADO — outra bateria esta a correr (pid ${dona}); uma bateria mede-se sozinha`,
      );
      process.exit(1);
    }
    return () => {};
  }
  writeFileSync(caminho, String(process.pid));
  return () => {
    try {
      rmSync(caminho, { force: true });
    } catch {
      /* a trava ja nao esta la */
    }
  };
}

const soltarATrava = tomarATrava();

// ------------------------------------------------------------------ os instrumentos de medida

let verificacoes = 0;
const divergentes: string[] = [];

/** Uma verificacao. Nao lanca: acumula, para a bateria dizer TUDO o que falhou numa corrida so. */
function exigir(condicao: boolean, texto: string): boolean {
  verificacoes += 1;
  if (!condicao) {
    divergentes.push(texto);
    console.log(`     FALHA  ${texto}`);
  }
  return condicao;
}

interface Prova {
  nome: string;
  o_que_mediu: string;
  veredicto: "passou" | "reprovou" | "incompleto";
}

const provas: Prova[] = [];

function fecharProva(nome: string, o_que_mediu: string, antes: number, incompleto = false): void {
  const novas = divergentes.slice(antes);
  const veredicto = divergentes.length > antes ? "reprovou" : incompleto ? "incompleto" : "passou";
  provas.push({ nome, o_que_mediu, veredicto });
  const marca = veredicto === "passou" ? "OK  " : veredicto === "incompleto" ? "INCOMPLETO" : "REPROVOU";
  console.log(`${marca} — ${o_que_mediu}`);
  if (novas.length > 0) console.log(`     ${novas.length} verificacao(oes) divergente(s) nesta prova`);
}

const casos = JSON.parse(readFileSync(join(import.meta.dir, "casos-duble.json"), "utf8"));

// ------------------------------------------------------------------ os tokens de versao dos casos
//
// A VERSAO DO CONTRATO NAO SE ESCREVE NUM FICHEIRO DE CASOS. Os casos escrevem o TOKEN (`$CONTRATO`, e
// `$CONTRATO_A_FRENTE` / `$CONTRATO_ATRAS` onde o caso e ADVERSARIO), e e aqui — no momento de os ler — que
// o token e trocado pela versao LIDA de `contracts/versao.json`. A vigente vive num so sitio; copiada para
// 26 mensagens, envelhece em silencio e passa a ser recusada por `versao_do_contrato_divergente`, e a
// bateria mede o contrario do que diz medir (foi o que aconteceu na emenda 1.4.0).
//
// O MESMO resolver vive do lado Python (contracts/mocks/mesa/main.py), que le os MESMOS casos: se os dois
// resolverem de forma diferente, o duble e o motor divergem e a bateria fica vermelha.
//
// Um token DESCONHECIDO (ou um que ficasse por resolver) NAO passa como texto: e uma RECUSA nomeada.

/** Uma versao DIFERENTE da vigente — sempre: sobe (ou desce) o numero do meio (1.4.0 -> 1.5.0 / 1.3.0). */
function versaoDeslocada(delta: 1 | -1): string {
  const [maior, menor] = versaoVigente().split(".").map(Number);
  const candidata = delta === 1 ? `${maior}.${menor! + 1}.0` : `${maior}.${Math.max(0, menor! - 1)}.0`;
  return candidata !== versaoVigente() ? candidata : `${maior}.${menor}.1`;
}

function resolverTokensDeVersao(valor: any): any {
  if (typeof valor === "string") {
    if (valor === "$CONTRATO") return versaoVigente();
    if (valor === "$CONTRATO_A_FRENTE") return versaoDeslocada(1);
    if (valor === "$CONTRATO_ATRAS") return versaoDeslocada(-1);
    if (valor.startsWith("$CONTRATO")) {
      throw new Error(`token de versao desconhecido nos casos: ${JSON.stringify(valor)}`);
    }
    return valor;
  }
  if (Array.isArray(valor)) return valor.map(resolverTokensDeVersao);
  if (valor !== null && typeof valor === "object") {
    for (const chave of Object.keys(valor)) valor[chave] = resolverTokensDeVersao(valor[chave]);
    return valor;
  }
  return valor;
}

try {
  resolverTokensDeVersao(casos);
} catch (erro) {
  console.error(`conformidade: RECUSADO — ${(erro as Error).message}`);
  process.exit(2);
}

function lerJson(caminho: string): any {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

function clonar<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function contarLinhas(caminho: string): number {
  try {
    return readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    return 0;
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A mensagem do conector, em envelope, como ela atravessa a fronteira: uma linha de JSON. */
function emEnvelope(tipo: string, carga: unknown, id = "conformidade/1"): string {
  return JSON.stringify({ contrato: versaoVigente(), tipo, id, carga });
}

/** O manifesto do conector: a funcao PURA do conector aplicada a sonda. */
function manifestoDoConector(sonda: any = casos.sonda_base): any {
  const r = construirManifesto(clonar(sonda) as Sonda);
  if (!r.ok) throw new Error(`a sonda de referencia foi RECUSADA (${r.motivo}: ${r.porque})`);
  return r.manifesto;
}

/** O percurso "carga.instrumentos.0.passo" -> o valor. Sem interpretacao. */
function porCaminho(obj: any, caminho: string): unknown {
  if (caminho === "") return obj;
  return caminho.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

// ------------------------------------------------------------------ prova 1: a forma das mensagens

const LEITURAS: { nome: string; veredicto: string; motivo: string | null; detalhe?: string }[] = [];

function prova1_forma(): void {
  console.log("\nPROVA 1 — a forma: toda mensagem do conector contra o envelope e o esquema do seu tipo");
  const antes = divergentes.length;

  const manifesto = manifestoDoConector();
  const linhaDoManifesto = emEnvelope("manifesto", manifesto, "conformidade/manifesto");
  const dManifesto = validar(linhaDoManifesto);
  exigir(dManifesto.veredicto === "aceite", `o manifesto do conector nao passou o envelope: ${dManifesto.veredicto}/${dManifesto.motivo}`);

  let conferidas = 0;
  for (const caso of casos.casos) {
    if (caso.modo_adversario || caso.resposta_do_plugin === undefined) continue; // silencio nao e mensagem
    conferidas += 1;
    const decisao = validar(JSON.stringify(caso.resposta_do_plugin));
    if (caso.veredicto_esperado === "aceite") {
      exigir(decisao.veredicto === "aceite", `${caso.nome}: o motor do contrato recusou uma mensagem declarada valida (${decisao.motivo})`);
    } else if (caso.veredicto_esperado === "recusado") {
      exigir(
        decisao.veredicto === "recusado" && decisao.motivo === caso.motivo_esperado,
        `${caso.nome}: esperado recusado/${caso.motivo_esperado}, veio ${decisao.veredicto}/${decisao.motivo}`,
      );
    }
  }
  exigir(conferidas >= 10, `mensagens do conector conferidas: ${conferidas} (esperado >= 10)`);

  // As duas leituras: o mesmo caso, no motor do contrato (TS) e no duble de mesa (Python).
  const duble = spawnSync(
    "uv",
    ["run", "python", "mocks/mesa/main.py", "--papel", "conector", "--casos", join(import.meta.dir, "casos-duble.json")],
    { cwd: CONTRATOS, encoding: "utf8" },
  );
  let leituraDoDuble = "nao correu";
  let leituraDaFidelidade = "nao correu";
  let incompleto = false;
  if (duble.error) {
    incompleto = true;
    leituraDoDuble = `o duble de mesa nao correu (${String((duble.error as Error).message).slice(0, 80)})`;
    console.log(`     o duble de mesa nao correu: ${String((duble.error as Error).message).slice(0, 120)}`);
  } else {
    const saida = `${duble.stdout ?? ""}${duble.stderr ?? ""}`;
    leituraDoDuble = saida.split("\n").filter((l) => l.startsWith("duble de mesa")).join(" ").trim();
    exigir(
      duble.status === 0 && /duble de mesa \(conector\): 0 falhas/.test(saida),
      `o duble de mesa divergiu dos casos declarados: ${leituraDoDuble || `exit ${duble.status}`}`,
    );

    // E os MESMOS casos pelo MOTOR DO CONTRATO nas DUAS linguagens (Python e TypeScript), que ja existe e
    // se USA em vez de se escrever aqui uma terceira comparacao a mao: a fidelidade do duble de mesa
    // (SC-004). Divergencia entre as duas linguagens do motor e entre o motor e o duble = falha.
    const fidelidade = spawnSync(
      "uv",
      ["run", "python", "mocks/mesa/main.py", "--papel", "conector", "--fidelidade", "--casos", join(import.meta.dir, "casos-duble.json")],
      { cwd: CONTRATOS, encoding: "utf8" },
    );
    const saidaDaFidelidade = `${fidelidade.stdout ?? ""}${fidelidade.stderr ?? ""}`;
    leituraDaFidelidade = saidaDaFidelidade
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("fidelidade:"))
      .join(" ")
      .trim();
    const motores = saidaDaFidelidade.split("\n").filter((l) => l.trim().startsWith("motor ")).map((l) => l.trim());
    exigir(
      fidelidade.status === 0 && /fidelidade: 0 falhas/.test(saidaDaFidelidade),
      `o duble e o motor do contrato divergiram: ${leituraDaFidelidade || `exit ${fidelidade.status}`}`,
    );
    exigir(motores.length === 2, `a fidelidade nao correu as DUAS linguagens do motor (correu ${motores.length})`);
    for (const linha of motores) {
      const n = Number((linha.match(/(\d+) casos/) ?? [])[1]);
      exigir(n === conferidas, `${linha.split(":")[0]}: ${n} casos conferidos, esperado ${conferidas}`);
    }
    leituraDaFidelidade = `${leituraDaFidelidade} (${motores.join(" · ")})`;
    // O duble e o motor do contrato tem de dizer o MESMO em cada caso: aqui os dois numeros comparam-se.
    const porCaso = new Map<string, { veredicto: string; motivo: string | null }>();
    for (const linha of (duble.stdout ?? "").split("\n")) {
      if (!linha.trim().startsWith("{")) continue;
      try {
        const item = JSON.parse(linha);
        if (item.caso) porCaso.set(item.caso, { veredicto: item.veredicto, motivo: item.motivo ?? null });
      } catch {
        /* linha que nao e JSON nao conta */
      }
    }
    for (const caso of casos.casos) {
      const doDuble = porCaso.get(caso.nome);
      if (!exigir(doDuble !== undefined, `${caso.nome}: o duble de mesa nao devolveu o caso`)) continue;
      // O veredicto do duble entra TODO na conta, incluindo os casos de SILENCIO: e o duble que os emite, e
      // `espera` e `desconhecido` so existem neles - sem eles, dois dos quatro veredictos nunca seriam
      // exercitados por caso nenhum, e um conjunto fechado que nao se exercita e uma promessa.
      LEITURAS.push({ nome: caso.nome, veredicto: doDuble!.veredicto, motivo: doDuble!.motivo });
      if (caso.modo_adversario || caso.resposta_do_plugin === undefined) continue;
      exigir(
        doDuble!.veredicto === caso.veredicto_esperado && doDuble!.motivo === (caso.motivo_esperado ?? null),
        `${caso.nome}: duble ${doDuble!.veredicto}/${doDuble!.motivo} contra declarado ${caso.veredicto_esperado}/${caso.motivo_esperado}`,
      );
    }
  }

  fecharProva(
    "forma",
    `${conferidas + 1} mensagens do conector conferidas pelo motor do contrato (TS) e pelo duble de mesa (Python) · ${leituraDoDuble} · ${leituraDaFidelidade}`,
    antes,
    incompleto,
  );
}

// ------------------------------------------------------------------ prova 4 (antes das outras: o vocabulario)

function prova4_vocabulario(): void {
  console.log("\nPROVA 4 — o vocabulario fechado: quatro veredictos, e motivos lidos da FONTE");
  const antes = divergentes.length;
  const voc = vocabularioDoContrato();
  const doContrato = voc.motivos as Record<string, unknown>;
  const daMesa = motivosDaMesa() as Record<string, unknown>;
  const daFronteira = (voc.conjuntos_do_vigia?.motivos_de_comando ?? []) as string[];
  const doDuble = new Set<string>(casos.motivos_do_duble ?? []);
  const classificacoes = voc.classificacoes_de_desfecho as string[];
  const fechados: string[] = casos.veredictos_do_duble;

  exigir(fechados.length === 4, `veredictos declarados: ${fechados.length} (esperado 4)`);
  for (const v of fechados) exigir(v !== "aceita", `'${v}': o vocabulario do contrato e 'aceite', nunca 'aceita'`);
  exigir(doDuble.size > 0, "os motivos proprios do duble nao estao declarados em casos-duble.json");

  // OS MOTIVOS: cada um conferido contra O LIVRO DE ONDE VEM, nunca contra um literal escrito aqui.
  //
  //   motivos do CONTRATO   os dos casos de forma e o `motivo_do_contrato` das portas
  //   motivos da MESA       os das sete portas (a resposta a um comando, que e interface interna)
  //   motivos do DUBLE      os proprios do duble de mesa, que NAO podem existir em livro nenhum
  let doContratoConferidos = 0;
  let daMesaConferidos = 0;
  let doDubleConferidos = 0;
  for (const caso of casos.casos) {
    if (!caso.motivo_esperado) continue;
    if (doDuble.has(caso.motivo_esperado)) {
      doDubleConferidos += 1;
      exigir(
        doContrato[caso.motivo_esperado] === undefined && !motivoConhecido(caso.motivo_esperado),
        `'${caso.motivo_esperado}' e do duble e existe num dos livros: dois nomes iguais para coisas diferentes`,
      );
      continue;
    }
    doContratoConferidos += 1;
    exigir(doContrato[caso.motivo_esperado] !== undefined, `${caso.nome}: o motivo '${caso.motivo_esperado}' nao existe no vocabulario do CONTRATO`);
  }
  for (const caso of casos.manifesto) {
    if (!caso.motivo_esperado) continue;
    doContratoConferidos += 1;
    exigir(doContrato[caso.motivo_esperado] !== undefined, `${caso.caso}: o motivo '${caso.motivo_esperado}' nao existe no vocabulario do CONTRATO`);
  }
  for (const caso of casos.arranque.casos) {
    if (caso.motivo_do_contrato_esperado) {
      doContratoConferidos += 1;
      exigir(
        doContrato[caso.motivo_do_contrato_esperado] !== undefined,
        `${caso.nome}: o motivo do CONTRATO '${caso.motivo_do_contrato_esperado}' nao existe no vocabulario do contrato`,
      );
    }
    if (!caso.motivo_esperado) continue;
    daMesaConferidos += 1;
    exigir(motivoConhecido(caso.motivo_esperado), `${caso.nome}: o motivo '${caso.motivo_esperado}' nao existe no livro de motivos da MESA`);
  }

  // As classificacoes das mensagens: o conjunto fechado do contrato. Um caso que DECLARA levar uma
  // classificacao fora do conjunto e o adversario, e ai a conferencia exige o CONTRARIO - e a prova
  // negativa de que a conferencia sabe reprovar.
  let classificacoesConferidas = 0;
  let classificacoesForaConferidas = 0;
  for (const caso of casos.casos) {
    const carga = caso.resposta_do_plugin?.carga;
    if (!carga?.classificacao) continue;
    if (caso.classificacao_fora_do_conjunto === true) {
      classificacoesForaConferidas += 1;
      exigir(
        !classificacoes.includes(carga.classificacao),
        `${caso.nome}: a classificacao '${carga.classificacao}' devia estar FORA do conjunto e esta dentro`,
      );
      continue;
    }
    classificacoesConferidas += 1;
    exigir(
      classificacoes.includes(carga.classificacao),
      `${caso.nome}: classificacao '${carga.classificacao}' fora de ${JSON.stringify(classificacoes)}`,
    );
  }

  // Os veredictos que o duble REALMENTE emitiu tem de estar no conjunto fechado, e o conjunto declarado
  // tem de ser exercido por inteiro - um conjunto que nao se exercita e uma promessa.
  const emitidos = new Set(LEITURAS.map((l) => l.veredicto));
  for (const v of emitidos) exigir(fechados.includes(v), `o duble emitiu '${v}', que nao esta no conjunto fechado declarado`);
  const naoExercidos = fechados.filter((v) => !emitidos.has(v));
  const exercidos = emitidos.size > 0;
  exigir(
    !exercidos || naoExercidos.length === 0,
    `veredicto(s) do conjunto fechado que nenhum caso exercita: ${naoExercidos.join(", ")}`,
  );

  // AS PROVOCACOES: um motivo que nao existe e um veredicto que nao existe tem de REPROVAR a conferencia.
  let provocacoes = 0;
  for (const p of casos.provocacoes) {
    if (p.tipo === "vocabulario") {
      provocacoes += 1;
      exigir(
        doContrato[p.motivo] === undefined && !motivoConhecido(p.motivo),
        `a provocacao '${p.nome}': o motivo '${p.motivo}' EXISTE num dos livros - a prova nao mede nada`,
      );
    }
    if (p.tipo === "veredicto") {
      provocacoes += 1;
      exigir(!fechados.includes(p.veredicto), `a provocacao '${p.nome}': o veredicto '${p.veredicto}' esta no conjunto fechado - a prova nao mede nada`);
    }
  }

  fecharProva(
    "vocabulario",
    `${doContratoConferidos} motivos do CONTRATO (de ${Object.keys(doContrato).length}) e ${daMesaConferidos} da MESA (de ${Object.keys(daMesa).length}, ${daFronteira.length} deles na fronteira do comando) e ${doDubleConferidos} proprios do duble · ${classificacoesConferidas} classificacoes dentro do conjunto e ${classificacoesForaConferidas} declaradamente fora · 4 veredictos fechados, ${emitidos.size} exercitados · ${provocacoes} provocacoes fora do vocabulario`,
    antes,
  );
}

// ------------------------------------------------------------------ prova 2: as sete portas

function prova2_portas(): void {
  console.log("\nPROVA 2 — as SETE portas do arranque: a ordem, a primeira que falha, e o motivo dela");
  const antes = divergentes.length;
  const arranque = casos.arranque;

  // A ordem declarada nos casos nao manda: ela CONFERE-SE contra a ordem do core. Uma contagem escrita a
  // mao num ficheiro de dados envelhece em silencio; esta e comparada com a fonte.
  const declarada: string[] = arranque.ordem_das_portas;
  exigir(
    declarada.join(",") === [...PORTAS].join(","),
    `a ordem declarada (${declarada.join(" -> ")}) difere da ordem do core (${[...PORTAS].join(" -> ")})`,
  );

  const manifestoDoConectorBase = manifestoDoConector();
  let recusas = 0;
  let comMotivoDaPorta = 0;

  for (const caso of arranque.casos) {
    const config = fundir(arranque.padrao.config, caso.config_mudanca);
    const marcas = fundir(arranque.padrao.marcas, caso.marcas_mudanca);
    const manifesto = fundir(clonar(manifestoDoConectorBase), caso.manifesto_mudanca);
    const inventario = caso.inventario ?? arranque.padrao.inventario;

    const configAntes = JSON.stringify(config);
    const marcasAntes = JSON.stringify(marcas);
    const manifestoAntes = JSON.stringify(manifesto);

    let r: any;
    try {
      r = arrancar({
        manifesto,
        config,
        marcas,
        registo_retomavel: caso.registo_retomavel ?? arranque.padrao.registo_retomavel,
        conectores_de_pe: caso.conectores_de_pe ?? arranque.padrao.conectores_de_pe,
        portaDoInventario: () => ({ ok: inventario.ok === true, problemas: inventario.problemas ?? [] }),
      });
    } catch (erro) {
      exigir(false, `${caso.nome}: o arranque lancou em vez de recusar (${(erro as Error).message.slice(0, 120)})`);
      continue;
    }

    exigir(r.arrancou === caso.arrancou_esperado, `${caso.nome}: arrancou=${r.arrancou}, esperado=${caso.arrancou_esperado}`);
    exigir(
      r.estado === (caso.arrancou_esperado ? "em_operacao" : "parada"),
      `${caso.nome}: estado=${r.estado} (uma porta falhada NAO muda o estado)`,
    );
    exigir((r.porta ?? null) === (caso.porta_esperada ?? null), `${caso.nome}: porta=${r.porta}, esperada=${caso.porta_esperada}`);
    exigir((r.motivo ?? null) === (caso.motivo_esperado ?? null), `${caso.nome}: motivo=${r.motivo}, esperado=${caso.motivo_esperado}`);
    exigir(
      (r.detalhe ?? null) === (caso.detalhe_esperado ?? null),
      `${caso.nome}: detalhe=${r.detalhe}, esperado=${caso.detalhe_esperado ?? ""}`,
    );
    exigir(
      (r.motivo_do_contrato ?? null) === (caso.motivo_do_contrato_esperado ?? null),
      `${caso.nome}: motivo_do_contrato=${r.motivo_do_contrato}, esperado=${caso.motivo_do_contrato_esperado ?? ""}`,
    );

    // A ORDEM, medida: as portas conferidas sao o PREFIRO da ordem declarada ate aquela que falhou - e
    // nada mais. Um caso que falha cinco portas reporta a primeira, e a lista diz ate onde se chegou.
    const esperadoConferidas = caso.porta_esperada === null
      ? declarada
      : declarada.slice(0, declarada.indexOf(caso.porta_esperada) + 1);
    exigir(
      r.portas_conferidas.join(",") === esperadoConferidas.join(","),
      `${caso.nome}: portas_conferidas=[${r.portas_conferidas.join(", ")}], esperado=[${esperadoConferidas.join(", ")}]`,
    );

    // FR-032 pelo lado caro: a mesa NAO corrige nada para conseguir entrar.
    exigir(
      JSON.stringify(config) === configAntes && JSON.stringify(marcas) === marcasAntes && JSON.stringify(manifesto) === manifestoAntes,
      `${caso.nome}: a configuracao, as marcas ou o manifesto sairam diferentes do que entraram`,
    );

    if (caso.arrancou_esperado === false) {
      recusas += 1;
      if (r.porta === caso.porta_esperada && r.motivo !== null) comMotivoDaPorta += 1;
    }
  }

  exigir(recusas > 0 && comMotivoDaPorta === recusas, `${comMotivoDaPorta} de ${recusas} recusas com o motivo da porta`);
  fecharProva(
    "sete portas",
    `${arranque.casos.length} casos (uma porta por caso, a ordem, e o caminho feliz) · ${recusas} recusas com o motivo da porta · a ordem declarada confere com a do core`,
    antes,
  );
}

// ------------------------------------------------------------------ prova 3: as duas versoes

/** O conferidor das duas versoes: `versao` e a do CONTRATO, `conector.versao` e a do PLUGIN. */
function versoesCertas(manifesto: any): boolean {
  return (
    manifesto?.versao === versaoVigente() &&
    typeof manifesto?.conector?.versao === "string" &&
    manifesto.conector.versao !== versaoVigente()
  );
}

function prova3_versoes(): void {
  console.log("\nPROVA 3 — as duas versoes: `versao` e o CONTRATO, `conector.versao` e o PLUGIN");
  const antes = divergentes.length;
  const sentinela = "9.9.9";
  const manifesto = manifestoDoConector({ ...casos.sonda_base, versao_do_conector: sentinela });

  exigir(manifesto.versao === versaoVigente(), `carga.versao=${manifesto.versao}, esperado ${versaoVigente()} (contrato)`);
  exigir(manifesto.conector.versao === sentinela, `carga.conector.versao=${manifesto.conector.versao}, esperado ${sentinela} (plugin)`);
  exigir(manifesto.conector.versao !== manifesto.versao, "as duas versoes ficaram com o mesmo valor: nao se distingue o contrato do plugin");

  // A PROVA NEGATIVA: trocados, o conferidor TEM de reprovar.
  const trocado = { ...clonar(manifesto), versao: manifesto.conector.versao, conector: { ...manifesto.conector, versao: manifesto.versao } };
  exigir(!versoesCertas(trocado), "o conferidor das versoes ACEITOU um manifesto com as duas versoes trocadas");

  fecharProva(
    "duas versoes",
    `contrato ${manifesto.versao} e plugin ${manifesto.conector.versao} (sentinela ${sentinela}) · trocadas, o conferidor reprova`,
    antes,
  );
}

// ------------------------------------------------------------------ prova 5: o manifesto e funcao pura da sonda

function prova5_manifesto_puro(): void {
  console.log("\nPROVA 5 — o manifesto e FUNCAO PURA da sonda: capacidade nao declarada RECUSA, nunca `true`");
  const antes = divergentes.length;

  const sonda = clonar(casos.sonda_base);
  const sondaAntes = JSON.stringify(sonda);
  const primeira = manifestoDoConector(sonda);
  const segunda = manifestoDoConector(sonda);
  exigir(JSON.stringify(primeira) === JSON.stringify(segunda), "duas chamadas com a mesma sonda deram manifestos diferentes (nao e pura)");
  exigir(JSON.stringify(sonda) === sondaAntes, "a sonda foi MUTADA: o manifesto deixou de ser funcao pura dela");

  let capacidades = 0;
  for (const capacidade of casos.capacidades_da_sonda) {
    capacidades += 1;
    const r = construirManifesto({ ...clonar(casos.sonda_base), [capacidade]: null } as Sonda);
    if (r.ok) {
      exigir(false, `${capacidade}=null deu manifesto em vez de recusa (fail-open: virou '${JSON.stringify((r.manifesto as any)[capacidade])}')`);
      continue;
    }
    exigir(r.motivo === "capacidade_nao_declarada", `${capacidade}=null recusou com '${r.motivo}', esperado capacidade_nao_declarada`);
    exigir(r.porque.includes(capacidade), `${capacidade}=null: a recusa nao nomeia a capacidade que faltou ('${r.porque}')`);
  }
  // Nenhuma booleana do manifesto pode ser `true` sem a sonda a declarar `true`.
  let booleanas = 0;
  for (const [campo, valor] of Object.entries(primeira)) {
    if (typeof valor !== "boolean") continue;
    booleanas += 1;
    exigir(valor === (casos.sonda_base as any)[nomeDaSonda(campo)], `${campo}: o manifesto diz ${valor} e a sonda declarou outra coisa`);
  }

  fecharProva(
    "manifesto puro",
    `2 chamadas identicas · sonda intacta · ${capacidades} casos de capacidade ausente recusados com \`capacidade_nao_declarada\` · ${booleanas} booleanas conferidas contra a sonda`,
    antes,
  );
}

/** O nome do campo do manifesto -> o nome dele na sonda (o manifesto RENOMEIA tres deles). */
function nomeDaSonda(campo: string): string {
  const mapa: Record<string, string> = {
    sabe_ajustar_alavancagem: "ajusta_alavancagem",
    teto_de_valor_por_ordem: "minimo_de_valor_por_ordem",
    funding: "funding_publicado",
  };
  return mapa[campo] ?? campo;
}

// ------------------------------------------------------------------ prova 9: instrumento desconhecido

function prova9_instrumento(): void {
  console.log("\nPROVA 9 — instrumento que nao existe no manifesto: recusa NOMEADA, dos dois lados");
  const antes = divergentes.length;

  // (a) O CONECTOR: a sonda pediu um instrumento que o venue nao tem.
  const r = construirManifesto({ ...clonar(casos.sonda_base), instrumentos_pedidos: ["BTC", "SOL"] } as Sonda);
  exigir(!r.ok, "o conector construiu manifesto com um instrumento que nao existe na sonda");
  if (!r.ok) {
    exigir(r.motivo === "valor_fora_do_conjunto", `conector: motivo '${r.motivo}', esperado valor_fora_do_conjunto`);
    exigir(r.porque.includes("SOL"), `conector: a recusa nao nomeia o instrumento que faltou ('${r.porque}')`);
  }

  // (b) A MESA: a configuracao usa um instrumento que o manifesto NAO declara.
  const declara = construirManifesto({ ...clonar(casos.sonda_base), meta: { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] } } as Sonda);
  exigir(declara.ok, "a sonda so com BTC foi recusada - a prova (b) nao pode correr");
  if (declara.ok) {
    const config = fundir(casos.arranque.padrao.config, {
      fichas: { BTC: { saldo_pct: "1", alavancagem: "5" }, SOL: { saldo_pct: "1", alavancagem: "5" } },
    });
    const resultado = arrancar({
      manifesto: declara.manifesto,
      config,
      marcas: clonar(casos.arranque.padrao.marcas),
      registo_retomavel: true,
      conectores_de_pe: casos.arranque.padrao.conectores_de_pe,
      portaDoInventario: () => ({ ok: true, problemas: [] }),
    });
    exigir(resultado.arrancou === false, "a mesa arrancou com um instrumento que o manifesto nao declara");
    exigir(resultado.porta === "manifesto", `mesa: porta='${resultado.porta}', esperada manifesto`);
    exigir(
      resultado.porque.includes("SOL"),
      `mesa: a recusa nao nomeia o instrumento que falta em unidade declarada ('${resultado.porque}')`,
    );
  }

  fecharProva(
    "instrumento desconhecido",
    "o conector recusa nomeando SOL na sonda · a mesa recusa na porta `manifesto` nomeando SOL na configuracao",
    antes,
  );
}

// ------------------------------------------------------------------ prova 6: a costura fecha, a mesa fica

async function prova6_mesa_sem_vigia(): Promise<void> {
  console.log("\nPROVA 6 — a mesa NAO SAI quando a costura fecha (FR-006): conta-se o ledger, nao o tempo");
  const antes = divergentes.length;
  const ms = casos.mesa_sem_vigia;
  const declarado = lerJson(join(RAIZ, ms.caso_do_ciclo));
  const casoDoCiclo = declarado.casos.find((c: any) => c.nome.startsWith(ms.prefixo_do_caso));
  if (!casoDoCiclo) {
    exigir(false, `o caso '${ms.prefixo_do_caso}' nao existe em ${ms.caso_do_ciclo}: a prova nao pode correr`);
    fecharProva("mesa sem vigia", "o fixture do ciclo mudou de nome", antes, true);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "conformidade-fr6-"));
  const caminhos = {
    config: join(dir, "config.json"),
    marcas: join(dir, "marcas.json"),
    portas: join(dir, "portas.json"),
    operacao: join(dir, "operacao.json"),
    registo: join(dir, "ledger.jsonl"),
  };
  const instrumento = casoDoCiclo.leitura.instrumento;
  writeFileSync(caminhos.config, JSON.stringify(ms.config, null, 2));
  writeFileSync(caminhos.marcas, JSON.stringify({ sessao: null, inibicao_cb: null, desconhecido: [], pedidos: [] }, null, 2));
  writeFileSync(caminhos.portas, JSON.stringify({ passam: true, portas_conferidas: ["conectores"] }, null, 2));
  writeFileSync(
    caminhos.operacao,
    JSON.stringify(
      {
        nota: "duble de operacao da conformidade (o vigia morreu; a operacao fica)",
        ligacao: "ligada",
        instrumentos: {
          [instrumento]: {
            leitura: casoDoCiclo.leitura,
            proposta: { setup: declarado.padrao.proposta_setup, ...casoDoCiclo.proposta },
            ficha: casoDoCiclo.ficha,
            template: declarado.padrao.template,
            marcas_nossas_conhecidas: [],
            // A LEITURA DECLARA O QUE NAO TROUXE E SE DIVERGIU (a mesa ja' nao aceita a omissao em silencio).
            falhas: { leitura: false, setup_respondeu: true },
            divergente: false,
            relogio: "1h",
          },
        },
      },
      null,
      2,
    ),
  );

  const proc = spawn(
    "bun",
    [
      "run", join(RAIZ, "core", "servidor.ts"),
      "--tick", String(ms.tick_ms),
      "--marcas", caminhos.marcas,
      "--registo", caminhos.registo,
      "--portas", caminhos.portas,
      "--posicao-viva", "false",
      "--operacao", caminhos.operacao,
      "--config", caminhos.config,
    ],
    { stdio: ["pipe", "pipe", "inherit"], cwd: RAIZ },
  );

  let resposta = "";
  let saida = "";
  proc.stdout?.on("data", (d) => { saida += String(d); });
  proc.stdout?.on("error", () => { /* a costura pode fechar: nao e erro desta prova */ });

  const start = emEnvelope("comando", { verbo: "start", autor: "conformidade", pedido_id: "p-1" }, "c-1");
  proc.stdin?.write(start + "\n");

  const limite = Date.now() + 8000;
  while (Date.now() < limite) {
    const linhas = saida.split("\n").filter((l) => l.trim() !== "");
    if (linhas.length > 0) { resposta = linhas[0]!; break; }
    if (proc.exitCode !== null) break;
    await dormir(25);
  }

  let respondeu = false;
  try {
    const d = JSON.parse(resposta);
    respondeu = d?.tipo === "resposta_de_comando" && d?.carga?.transicao?.para === "em_operacao";
    exigir(respondeu, `a mesa nao aceitou o start: ${resposta.slice(0, 160) || "(sem resposta)"}`);
  } catch {
    exigir(false, `a mesa nao respondeu ao start: ${resposta.slice(0, 160) || "(sem resposta)"}`);
  }

  const antesDasVoltas = contarLinhas(caminhos.registo);
  // A COSTURA FECHA. A partir daqui a mesa esta so com o relogio dela - que e a FR-006 inteira.
  proc.stdin?.end();
  await dormir(ms.espera_ms);
  const depoisDasVoltas = contarLinhas(caminhos.registo);
  const voltas = depoisDasVoltas - antesDasVoltas;
  const vivo = proc.exitCode === null;

  exigir(respondeu, "sem start aceite nao ha operacao para defender");
  exigir(voltas >= ms.minimo_de_voltas, `com a costura fechada, a mesa escreveu ${voltas} linha(s) de ledger (esperado >= ${ms.minimo_de_voltas})`);
  exigir(vivo, "a mesa SAIU quando a costura fechou - FR-006 violada");

  if (vivo) proc.kill("SIGKILL");
  await dormir(50);
  proc.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });

  fecharProva(
    "mesa sem vigia",
    `start aceite (em_operacao) · costura fechada · ${voltas} volta(s) novas do relogio com o cano fechado (${antesDasVoltas} -> ${depoisDasVoltas} linhas) · processo vivo: ${vivo}`,
    antes,
  );
}

// ------------------------------------------------------------------ prova 7: a espera e a recusa no registo

function prova7_registo(): void {
  console.log("\nPROVA 7 — a volta que ESPERA nao e acontecimento, e a RECUSA DE COMANDO transita X->X");
  const antes = divergentes.length;
  const dir = mkdtempSync(join(tmpdir(), "conformidade-t7-"));
  const registo = join(dir, "registo.jsonl");
  const marcas = join(dir, "marcas.json");
  writeFileSync(marcas, JSON.stringify({ sessao: null, inibicao_cb: null, desconhecido: [], pedidos: [] }, null, 2));
  // A transicao que DATA a pergunta do encerramento (e dela que o prazo se conta).
  writeFileSync(
    registo,
    JSON.stringify({
      instante_ms: 1000, tipo: "transicao", de: "em_operacao", para: "encerrando",
      verbo: "stop", autor: "dono", motivo: "resumo_do_encerramento_apresentado",
      nota: "a pergunta do encerramento foi apresentada",
    }) + "\n",
  );

  const mesa = new Mesa({ caminhoDasMarcas: marcas, caminhoDoRegisto: registo });
  mesa.estado = "encerrando";
  const n0 = contarLinhas(registo);

  // DENTRO do prazo: nada mudou -> nada se escreve (escrever reiniciaria o prazo para sempre).
  const dentro = mesa.esperarPeloEncerramento({
    instante_ms: 1200, posicao_viva: false, prazo_de_resposta_ms: 1000, configuracao: casos.mesa_sem_vigia.config as any,
  });
  const n1 = contarLinhas(registo);
  exigir(n1 === n0, `a volta que espera escreveu no registo (${n0} -> ${n1} linhas): o prazo reiniciaria para sempre`);
  exigir(dentro.estado_novo === "encerrando", `a volta que espera mudou de estado: ${dentro.estado_anterior} -> ${dentro.estado_novo}`);

  // O PAR DE CONTROLO: FORA do prazo a mesa volta a operar e A VOLTA E acontecimento - escreve-se.
  const fora = mesa.esperarPeloEncerramento({
    instante_ms: 1000 + 1001, posicao_viva: false, prazo_de_resposta_ms: 1000, configuracao: casos.mesa_sem_vigia.config as any,
  });
  const n2 = contarLinhas(registo);
  exigir(fora.estado_novo === "em_operacao", `fora do prazo o estado devia ser em_operacao e veio ${fora.estado_novo}`);
  exigir(n2 === n1 + 1, `fora do prazo a volta devia escrever 1 linha (${n1} -> ${n2})`);

  // A RECUSA DE COMANDO: responder a um pedido e um acto, e transita X->X.
  const mesaParada = new Mesa({ caminhoDasMarcas: marcas, caminhoDoRegisto: registo });
  const n3 = contarLinhas(registo);
  const recusa = mesaParada.receber({ verbo: "pause", autor: "dono", pedido_id: "p-2" }, { instante_ms: 5000 } as any);
  const n4 = contarLinhas(registo);
  exigir(recusa.resultado === "recusado", `pause numa mesa parada devia recusar e veio ${recusa.resultado}`);
  exigir(
    recusa.estado_anterior === recusa.estado_novo,
    `a recusa de comando nao transitou X->X: ${recusa.estado_anterior} -> ${recusa.estado_novo}`,
  );
  exigir(n4 === n3 + 1, `a recusa de comando nao ficou registada (${n3} -> ${n4} linhas)`);
  const ultima = readFileSync(registo, "utf8").split("\n").filter((l) => l.trim() !== "").at(-1)!;
  const linha = JSON.parse(ultima);
  exigir(linha.tipo === "recusa" && linha.motivo !== null && linha.motivo !== undefined, `a linha da recusa nao traz motivo: ${ultima}`);

  rmSync(dir, { recursive: true, force: true });
  fecharProva(
    "espera e recusa no registo",
    `dentro do prazo: ${n0} -> ${n1} linhas (nada escrito) · fora do prazo: ${n1} -> ${n2} (1 linha) · recusa de comando: ${n3} -> ${n4} com motivo`,
    antes,
  );
}

// ------------------------------------------------------------------ prova 8: credenciais

const PADROES_DE_SEGREDO: { nome: string; re: RegExp }[] = [
  { nome: "chave privada 0x+64 hex", re: /0x[0-9a-fA-F]{64}/ },
  { nome: "campo de segredo preenchido", re: /["']?(api[_-]?key|secret|private[_-]?key|credencial_valor)["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i },
];

function prova8_credenciais(): void {
  console.log("\nPROVA 8 — nenhum valor de credencial no repositorio (RN-E14), com os dois controlos");
  const antes = divergentes.length;

  // O varrimento: brokers/, docs/ e config/ - os sitios do conector.
  const raizes = ["brokers", "docs", "config"];
  let ficheiros = 0;
  const achados: string[] = [];
  for (const raiz of raizes) {
    for (const caminho of listarFicheiros(join(RAIZ, raiz))) {
      if (/\.(png|jpg|jpeg|gif|ico|pdf|lock|pyc)$/i.test(caminho)) continue;
      let texto = "";
      try {
        if (statSync(caminho).size > 2_000_000) continue;
        texto = readFileSync(caminho, "utf8");
      } catch {
        continue;
      }
      ficheiros += 1;
      for (const p of PADROES_DE_SEGREDO) {
        if (p.re.test(texto)) achados.push(`${relative(RAIZ, caminho)} (${p.nome})`);
      }
    }
  }
  exigir(
    achados.length === 0,
    `valores com forma de credencial em brokers/, docs/ ou config/: ${achados.join(", ")}`,
  );

  // O CONTROLOS do proprio varrimento: ele TEM de saber encontrar o que existe, senao o zero nao mede nada.
  const controle = PADROES_DE_SEGREDO.some((p) => p.re.test('private_key = "0x' + "ab".repeat(32) + '"'));
  exigir(controle, "o detector de segredos nao reconheceu um segredo sintetico: o zero dele nao mede nada");

  // O carregador do conector: um token que EXISTE num ficheiro versionado tem de ser encontrado...
  const existe = estaNoRepositorio("hyperliquid", RAIZ);
  exigir(existe !== null, "o varrimento do conector nao encontrou um token que esta num ficheiro versionado (prova negativa do varrimento)");
  // ...e um segredo que nao existe em lado nenhum tem de devolver NADA.
  const sentinela = "0x" + "3f9c1d".repeat(4) + "conformidade";
  exigir(estaNoRepositorio(sentinela, RAIZ) === null, "o varrimento do conector acusou um token que nao existe em ficheiro nenhum (falso positivo)");

  // A referencia viaja; o VALOR nao. O exemplo do conector so tem a referencia.
  const exemplo = lerJson(join(RAIZ, "brokers", "hyperliquid", "conector.exemplo.json"));
  const valorEm = String(exemplo?.credencial?.valor_em ?? "");
  exigir(/^(env|ficheiro):.+/.test(valorEm), `o exemplo do conector nao declara a credencial por referencia: ${valorEm}`);
  exigir(
    JSON.stringify(exemplo).includes("hl_teste") && !PADROES_DE_SEGREDO.some((p) => p.re.test(JSON.stringify(exemplo))),
    "o exemplo do conector traz um valor com forma de credencial",
  );

  // E o conector nunca passa o valor a uma escrita (log/ledger/mensagem).
  let escritas = 0;
  let codigo = 0;
  for (const caminho of listarFicheiros(join(RAIZ, "brokers", "hyperliquid"))) {
    if (!caminho.endsWith(".ts")) continue;
    codigo += 1;
    const semComentarios = readFileSync(caminho, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    const re = /(console\.(log|error|warn)|writeFileSync|appendFileSync|process\.stdout\.write|process\.stderr\.write)[^\n]*\.valor\b/g;
    const encontrados = semComentarios.match(re) ?? [];
    for (const e of encontrados) {
      escritas += 1;
      exigir(false, `${relative(RAIZ, caminho)}: o valor da credencial entra numa escrita -> ${e.trim().slice(0, 80)}`);
    }
  }
  // O controlo do detector: o mesmo padrao TEM de acusar um texto que faz exactamente isso.
  const padraoEscrita = /(console\.(log|error|warn)|writeFileSync|appendFileSync)[^\n]*\.valor\b/;
  exigir(padraoEscrita.test("console.log(r.valor)"), "o detector de escritas do valor nao reconhece uma escrita sintetica");

  fecharProva(
    "credenciais",
    `${ficheiros} ficheiros varridos em brokers/, docs/ e config/ · 0 valores com forma de credencial · 2 controlos do varrimento · ${codigo} ficheiros do conector conferidos, ${escritas} escrita(s) com o valor`,
    antes,
  );
}

function listarFicheiros(raiz: string): string[] {
  const saida: string[] = [];
  const pilha = [raiz];
  while (pilha.length > 0) {
    const atual = pilha.pop()!;
    let entradas: string[] = [];
    try {
      entradas = readdirSync(atual);
    } catch {
      continue;
    }
    for (const nome of entradas) {
      if (nome === "node_modules" || nome === ".venv" || nome === ".git" || nome === "__pycache__") continue;
      const caminho = join(atual, nome);
      let eDiretorio = false;
      try {
        eDiretorio = statSync(caminho).isDirectory();
      } catch {
        continue;
      }
      if (eDiretorio) pilha.push(caminho);
      else saida.push(caminho);
    }
  }
  return saida;
}

// ------------------------------------------------------------------ a corrida

console.log("=== bateria de conformidade do conector (offline, com duble de mesa) ===");
console.log(`contrato vigente: ${versaoVigente()} (lido de contracts/versao.json - nao ha versao escrita aqui)`);
console.log(`casos: ${join("tools", "verificar-conector", "casos-duble.json")}`);

/**
 * Corre uma prova com rede de seguranca: uma prova que LANCA nao pode levar a bateria atras - um erro
 * nosso apareceria como "a bateria crashou", e nao como a prova que nao decidiu. O que lanca conta como
 * REPROVACAO, com o nome da prova e a razao.
 */
async function correrProva(nome: string, prova: () => void | Promise<void>): Promise<void> {
  const antes = divergentes.length;
  try {
    await prova();
  } catch (erro) {
    const porque = (erro as Error)?.message?.slice(0, 160) ?? String(erro);
    exigir(false, `${nome}: a prova lancou em vez de decidir (${porque})`);
    if (provas.at(-1)?.nome !== nome) {
      provas.push({ nome, o_que_mediu: `lancou: ${porque}`, veredicto: "reprovou" });
      console.log(`REPROVOU — ${nome}: lancou em vez de decidir`);
    }
  }
  if (divergentes.length > antes && provas.at(-1)?.veredicto === "passou") {
    provas.at(-1)!.veredicto = "reprovou";
  }
}

await correrProva("forma", prova1_forma);
await correrProva("sete portas", prova2_portas);
await correrProva("duas versoes", prova3_versoes);
await correrProva("vocabulario", prova4_vocabulario);
await correrProva("manifesto puro", prova5_manifesto_puro);
await correrProva("mesa sem vigia", prova6_mesa_sem_vigia);
await correrProva("espera e recusa no registo", prova7_registo);
await correrProva("credenciais", prova8_credenciais);
await correrProva("instrumento desconhecido", prova9_instrumento);

// ------------------------------------------------------------------ o veredicto

const passaram = provas.filter((p) => p.veredicto === "passou").length;
const reprovaram = provas.filter((p) => p.veredicto === "reprovou").length;
const incompletas = provas.filter((p) => p.veredicto === "incompleto").length;

console.log("\n=== o que cada prova mediu ===");
for (const p of provas) {
  const marca = p.veredicto === "passou" ? "passou    " : p.veredicto === "incompleto" ? "INCOMPLETO" : "REPROVOU  ";
  console.log(`${marca} ${p.nome}: ${p.o_que_mediu}`);
}

// FR-026: o que nao corre fica INCOMPLETO, nunca "passou". A bateria do venue e o caso declarado.
console.log(
  "\nvenue (as provas de SC-004, no ambiente de TESTE): INCOMPLETO AQUI — a `tools/testar-venue/bateria.ts` — nao corre offline; " +
    "esta bateria nao tem rede nem chave, e esse aceite e outra bateria (RN-C6, FR-025).",
);

const sufixo = reprovaram > 0
  ? ` · ${reprovaram} reprovada(s)`
  : incompletas > 0
    ? ` · ${incompletas} incompleta(s)`
    : "";
console.log(
  `\nconformidade: ${passaram} de ${provas.length} passaram${sufixo} · ${verificacoes} verificacoes · ${divergentes.length} divergentes`,
);

soltarATrava();
process.exit(reprovaram === 0 && incompletas === 0 ? 0 : 1);
