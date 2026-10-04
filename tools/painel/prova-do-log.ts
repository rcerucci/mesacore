#!/usr/bin/env bun
// A PROVA DO LOG — o log do operador é MISTO, e o que não é JSON tem de ser tratado como prosa, não como defeito.
//
// O QUE ISTO MEDE, e porquê. O `retrato` lia o `operador.log` com o MESMO leitor estrito do `registo.jsonl`: toda
// a linha que não fosse JSON virava a FALTA «linha ilegível em operador.log: nao e' JSON: linha truncada». Mas o
// `operador.log` é um log MISTO por desenho: as linhas do operador são JSON, e o CONECTOR fala em PROSA pelo
// `stderr` — que o operador reemite INTACTA para não ficar cego (D-019) —, mais a linha `[<data>] fim` do
// lançador. Medido a 03/10/2026: a tela dizia «linha ilegível … truncada» sem haver truncamento nenhum.
//
// DUAS METADES, e as duas são precisas:
//   1. a COSTURA do buffer (`vigia/linhas.ts` → `linhasInteiras`): um `data` entrega pedaços, e a fronteira pode
//      cair a meio de uma linha. Sem guardar o resíduo, uma linha JSON partida vira DUAS linhas ilegíveis — e é
//      o ECO do operador a partir as linhas, que é o que a pergunta original procurava;
//   2. o LEITOR do log (o `retrato` a sério, contra uma CÓPIA de uma corrida real): a prosa NÃO é falta, e uma
//      linha com cara de JSON partido É falta — com o par de controlo: o mesmo log sem truncamento dá 0 faltas.
//
// Uso:  bun run tools/painel/prova-do-log.ts

import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { linhasInteiras } from "../../vigia/linhas.ts";

const RAIZ = join(import.meta.dir, "..", "..");

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

const faltasDoRetrato = (dirCorrida: string): { faltas: any[]; fio: any } => {
  const para = join(dirCorrida, "__fio-de-prova.json");
  const r = Bun.spawnSync(["bun", "run", join(RAIZ, "tools", "painel", "retrato.ts"), "--corrida", dirCorrida, "--para", para, "--sem-serie"], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`o retrato falhou: ${r.stderr.toString()}`);
  return { faltas: JSON.parse(readFileSync(para, "utf8")).faltas ?? [], fio: JSON.parse(readFileSync(para, "utf8")) };
};

let saida = 1;
const copia = mkdtempSync(join(tmpdir(), "mesacore-prova-log-"));
try {
  // ------------------------------------------------------------------------------------------------
  console.log("── 1. a costura do buffer: um pedaço que corta uma linha a meio não a parte em duas");
  const linha = JSON.stringify({ contrato: "1.12.0", tipo: "desfecho", id: "mesa-1", carga: { aceite: true } });
  // O `data` do stream chega em pedaços: aqui a fronteira cai a meio da MESMA linha JSON.
  const p1 = linha.slice(0, 30);
  const p2 = linha.slice(30) + "\n";
  const passo1 = linhasInteiras("", p1);
  const passo2 = linhasInteiras(passo1.residuo, p2);
  certeza(passo1.linhas.length === 0, "o primeiro pedaço (linha a meio) não produz linha nenhuma — fica no resíduo");
  certeza(passo2.linhas.length === 1 && passo2.linhas[0] === linha, "o resíduo junta-se ao pedaço seguinte e a linha sai INTEIRA");
  certeza(JSON.parse(passo2.linhas[0]).id === "mesa-1", "e a linha inteira volta a ser JSON válido (o contrato do outro lado não foi violado)");

  // A PROVOCAÇÃO: o comportamento antigo (partir por `\n` sem buffer) partia a linha em DOIS pedaços não-JSON.
  const semBuffer = p1.split("\n").filter((l) => l.trim() !== "").concat(p2.split("\n").filter((l) => l.trim() !== ""));
  const naoJson = semBuffer.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } });
  certeza(naoJson.length === 2, `sem o buffer, a MESMA linha viraria DUAS linhas ilegíveis (o defeito medido: medido agora ${naoJson.length})`);

  // ------------------------------------------------------------------------------------------------
  console.log("\n── 2. o leitor do log: prosa NÃO é falta; uma linha com cara de JSON partido É falta");
  const real = join(copia, "corrida");
  // A CORRIDA DA PROVA É CONSTRUÍDA AQUI, e não copiada de uma corrida do dono. Uma prova que copia
  // `scratch/<corrida>` fica VERMELHA no dia em que o scratch estiver vazio — e foi o que o arranque de
  // primeira vez mediu (04/10/2026: `ENOENT …/scratch/teste-de-auditoria`, com a máquina limpa e o sistema
  // parado). O `retrato` só precisa de uma `operacao.json` bem-formada e do `operador.log`: em `--sem-serie`
  // nem as velas nem a série se pedem, e sem instrumentos nenhuns nada mais se lê.
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, "operacao.json"), JSON.stringify({
    contrato: JSON.parse(readFileSync(join(RAIZ, "contracts", "versao.json"), "utf8")).versao ?? "0.0.0",
    tipo: "operacao",
    id: "prova-do-log",
    conta: "prova-do-log",
    instrumentos: {},
  }));
  const agora = Date.now();
  const linhaDoOperador = (volta: number, etapa: string) => JSON.stringify({ instante_ms: agora, etapa, volta, instrumento: "BTC" });
  const PROSA = "a ligar ao venue… (diagnóstico do conector, em prosa — não é JSON)";
  const MARCADOR = `[${new Date(agora).toISOString()}] fim`;
  const TRUNCADA = '{"etapa":"operador","volta":99,"instrumento":"BTC"';   // começa por `{` e não fecha: truncamento a sério

  // (a) só JSON + prosa + o marcador do lançador: NÃO pode haver falta nenhuma.
  writeFileSync(join(real, "operador.log"), [
    linhaDoOperador(1, "carteiro"),
    PROSA,
    linhaDoOperador(2, "operador"),
    MARCADOR,
    linhaDoOperador(3, "carteiro"),
    "",
  ].join("\n"));
  const a = faltasDoRetrato(real);
  const faltasDoLog = (f: any[]) => f.filter((x) => /operador\.log/.test(String(x.o_que)));
  certeza(faltasDoLog(a.faltas).length === 0, `a prosa do conector e o marcador do lançador NÃO são faltas (faltas: ${a.faltas.length})`);
  const passagens = a.fio.mesas?.[0]?.carteiro?.passagens ?? -1;
  certeza(passagens === 2, `as linhas JSON à volta da prosa continuam a ser lidas (carteiro: 2 passagens, medido ${passagens})`);

  // (b) o mesmo log COM uma linha truncada: exatamente UMA falta, e ela nomeia a truncagem.
  writeFileSync(join(real, "operador.log"), [
    linhaDoOperador(1, "carteiro"),
    PROSA,
    TRUNCADA,
    linhaDoOperador(2, "operador"),
    MARCADOR,
    "",
  ].join("\n"));
  const b = faltasDoRetrato(real);
  const fb = faltasDoLog(b.faltas);
  certeza(fb.length === 1, `uma linha com cara de JSON partido dá UMA falta (medido ${fb.length})`);
  certeza(fb.length === 1 && /truncada|escrita a meio/.test(String(fb[0]?.porque)), `a falta nomeia a truncagem: «${fb[0]?.porque ?? "—"}»`);

  // A PROVOCAÇÃO (o leitor estrito antigo): tratar TODAS as linhas como obrigatoriamente JSON daria 3 faltas —
  // as 2 de prosa e a truncada. É a diferença entre «o log tem defeito» e «o log é misto por desenho».
  const linhas = readFileSync(join(real, "operador.log"), "utf8").split("\n").filter((l) => l.trim() !== "");
  const estrito = linhas.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } });
  certeza(estrito.length === 3, `o leitor estrito (o defeito) contaria ${estrito.length} linhas ilegíveis; o leitor do log conta ${fb.length}`);

  console.log("");
  if (problemas.length === 0) {
    console.log("prova do log: o buffer não parte linhas · a prosa do conector não é falta · uma truncagem a sério é dita e nomeada");
    saida = 0;
  } else {
    console.log(`prova do log: FALHOU — ${problemas.length} verificação(ões)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova do log: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(copia, { recursive: true, force: true });
}
process.exit(saida);
