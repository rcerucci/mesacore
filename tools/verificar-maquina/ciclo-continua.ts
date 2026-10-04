#!/usr/bin/env bun
// O CICLO CONTINUA DE ONDE FICOU — a referencia do cliente nao se repete entre arranques.
//
// O DEFEITO QUE ISTO MEDE (04/10/2026, dinheiro). A referencia `mesa-<ficha>-<ciclo>` alimenta o `cloid` do
// venue. Com o contador `ciclo` a comecar em 0 em CADA arranque da mesa, a corrida nova RE-USA as referencias da
// anterior; o conector, ao reconciliar ANTES de enviar, encontra o `cloid` antigo no venue e RECUSA nomeado
// (`referencia_ja_enviada_ao_venue`) — e o pedido que o motor QUERIA enviar perde-se. Medido nos desfechos: as
// referencias 47 e 48 de uma corrida apontavam para ordens ANTIGAS (oids 6168…/6167…); so' a 49 saiu.
//
// O QUE ESTA BANCADA CORRE: a MESA A SERIO (`core/servidor.ts`), uma vez com um registo que JA' chegou ao ciclo
// 47 (o reinicio) e outra com o registo vazio (o CONTROLE). A mesa escreve a primeira volta nova, e exige-se:
//   * com o registo a 47  -> a primeira linha nova diz `ciclo 48,` (continuou);
//   * com o registo vazio -> a primeira linha nova diz `ciclo 1,`  (o caminho normal).
// Se a correccao for revertida (`ciclo = 0`), o primeiro caso escreve `ciclo 1,` e a bancada fica VERMELHA.
//
// Uso:  bun run tools/verificar-maquina/ciclo-continua.ts

import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";
import { versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { ultimoCicloDoRegisto } from "../../core/estado/registo.ts";

const problemas: string[] = [];
function certeza(condicao: boolean, texto: string) {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
}

const arranque = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core/ciclo/arranque.casos.json"), "utf8"));
const config = JSON.parse(JSON.stringify(arranque.padrao.config));
const marcas = JSON.parse(JSON.stringify(arranque.padrao.marcas));

/** A operacao: SO' o EURUSD, e SEM leitura — a volta cai no caminho `sem_leitura`, que escreve a linha de ciclo
 *  (que e' o que se mede aqui) sem precisar de proposta nem de barra. */
function operacao() {
  return { nota: "duble da bancada do ciclo", ligacao: "ligada", correnta: undefined, instrumentos: { EURUSD: {} } };
}

/** Uma linha de ciclo ja' escrita, com o ciclo 47 na referencia E na nota (as duas formas que a mesa le'). */
function linhaNoCiclo47() {
  return JSON.stringify({
    instante_ms: 1, tipo: "ciclo", instrumento: "EURUSD", acao: "nada", motivo: "proposta_ausente_tratada_como_hold",
    nota: "ciclo 47, condicao proposta_ausente",
    boleta: { referencia_do_cliente: "mesa-EURUSD_v1-000047" },
  }) + "\n";
}

const VERSAO = versaoVigente();
const temporarios: string[] = [];

async function correr(registoInicial: string) {
  const dir = mkdtempSync(join(tmpdir(), "ciclo-continua-"));
  temporarios.push(dir);
  const c = {
    operacao: join(dir, "operacao.json"),
    config: join(dir, "config.json"),
    marcas: join(dir, "marcas.json"),
    portas: join(dir, "portas.json"),
    registo: join(dir, "registo.jsonl"),
  };
  writeFileSync(c.operacao, JSON.stringify(operacao()));
  writeFileSync(c.config, JSON.stringify(config));
  writeFileSync(c.marcas, JSON.stringify(marcas));
  writeFileSync(c.portas, JSON.stringify({ passam: true, portas_conferidas: ["conectores"] }));
  writeFileSync(c.registo, registoInicial);

  const proc = spawn("bun", [
    "run", join(RAIZ_DO_REPO, "core/servidor.ts"),
    "--tick", "250", "--operacao", c.operacao, "--config", c.config,
    "--portas", c.portas, "--registo", c.registo, "--marcas", c.marcas,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let erros = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (p: string) => { erros += p; });
  proc.stdin!.write(JSON.stringify({ contrato: VERSAO, tipo: "comando", id: "ciclo-continua", carga: { verbo: "start", autor: "bancada", pedido_id: "ciclo-continua" } }) + "\n");
  await new Promise((r) => setTimeout(r, 2500));
  proc.kill("SIGKILL");
  const linhas = readFileSync(c.registo, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  const ciclos = linhas.filter((l) => l.tipo === "ciclo");
  return { ciclos, erros };
}

console.log("── o ciclo continua de onde ficou (a referencia do cliente nao repete)");

// Unidade: o leitor do ultimo ciclo, pelas DUAS formas que o registo oferece.
const dirRegisto = mkdtempSync(join(tmpdir(), "ciclo-continua-unidade-"));
temporarios.push(dirRegisto);
writeFileSync(join(dirRegisto, "a.jsonl"), linhaNoCiclo47());
certeza(ultimoCicloDoRegisto(join(dirRegisto, "a.jsonl")) === 47, "le' o ciclo 47 pela REFERENCIA da boleta");
writeFileSync(join(dirRegisto, "b.jsonl"), JSON.stringify({ tipo: "ciclo", instrumento: "EURUSD", acao: "nada", nota: "ciclo 12, condicao x" }) + "\n");
certeza(ultimoCicloDoRegisto(join(dirRegisto, "b.jsonl")) === 12, "le' o ciclo 12 pela NOTA (linha sem boleta)");
certeza(ultimoCicloDoRegisto(join(dirRegisto, "nao-existe.jsonl")) === 0, "registo ausente = 0 (nada a continuar)");

// Integracao: a mesa A SERIO.
const comHistorico = await correr(linhaNoCiclo47());
const primeiroNovo = comHistorico.ciclos[1];   // [0] = a linha pre-existente
const nota = String(primeiroNovo?.nota ?? "");
certeza(/^ciclo 48,/.test(nota), `com o registo a 47, a primeira volta NOVA continua em 48 (nota: «${nota.slice(0, 24)}»)`);
if (comHistorico.ciclos.length < 2) console.log(`      (a mesa nao ciclou: stderr: ${comHistorico.erros.trim().split("\n").slice(-2).join(" | ")})`);

const doZero = await correr("");
const primeiroDoZero = doZero.ciclos[0];
const notaZero = String(primeiroDoZero?.nota ?? "");
certeza(/^ciclo 1,/.test(notaZero), `o CONTROLE (registo vazio) comeca em 1 (nota: «${notaZero.slice(0, 20)}»)`);

console.log("");
if (problemas.length === 0) {
  console.log("ciclo continua: a referencia do cliente nao se repete entre arranques · o registo vazio continua a comecar em 1");
} else {
  console.log(`ciclo continua: FALHOU — ${problemas.length} verificacao(oes)`);
  for (const p of problemas) console.log(`   · ${p}`);
}
for (const d of temporarios) rmSync(d, { recursive: true, force: true });
process.exit(problemas.length === 0 ? 0 : 1);
