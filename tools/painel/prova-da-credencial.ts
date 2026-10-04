#!/usr/bin/env bun
// A PROVA DA CREDENCIAL — a tela grava o VALOR de uma chave, e o valor nunca sai do ficheiro.
//
// O DEFEITO QUE ISTO MEDE (04/10/2026). O unico escritor de credenciais era cTrader-only (4 campos fixos), e o
// valor da Hyperliquid vivia num ficheiro que NENHUMA ferramenta escrevia — a tela dizia «segredo · por caminho ·
// nao se abre» e nao tinha caminho de escrita. Agora ha' uma porta (`POST /api/credencial`) sobre a MESMA escrita
// (`tools/guardar-credencial.sh gravar-de-stdin`), com as guardas da casa.
//
// O QUE ISTO MEDE, contra o SERVIDOR A SERIO (arrancado aqui, numa pasta de credenciais de BANCADA):
//   * grava o valor num ficheiro FORA do repositorio, modo 600, e o conteudo e' o valor;
//   * a RESPOSTA e o REGISTO levam SO' a FORMA (comprimento + primeiros) e a IMPRESSAO (sha256) — o valor NAO
//     aparece em nenhum dos dois (prova-se por busca literal);
//   * as GUARDAS: origem + cabecalho proprio (403 sem eles), e o ficheiro tem de viver na pasta das credenciais
//     (um caminho de fora e' RECUSADO);
//   * um valor curto e' RECUSADO pelo escritor (a mesma regua), e nada e' criado;
//   * o ficheiro que a bancada cria e' APAGADO no fim.
//
// Uso:  bun run tools/painel/prova-da-credencial.ts

import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const RAIZ = join(import.meta.dir, "..", "..");
const VALOR = "chave-de-bancada-da-prova-4a7f19c2e8";   // valor distinctivo: se aparecer na resposta/registo, a prova falha

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

const credenciais = mkdtempSync(join(tmpdir(), "mesacore-prova-cred-"));
const proc = spawn("bun", ["run", join(RAIZ, "tools", "painel", "servidor.ts"), "--porta", "0", "--endereco", "127.0.0.1", "--intervalo", "0", "--intervalo-vivo", "0"], {
  env: { ...process.env, CREDENCIAIS_DIR: credenciais },
  stdio: ["ignore", "pipe", "pipe"],
});
let saidaServidor = "", erroServidor = "";
proc.stdout.setEncoding("utf8");
proc.stderr.setEncoding("utf8");
proc.stdout.on("data", (p: string) => { saidaServidor += p; });
proc.stderr.on("data", (p: string) => { erroServidor += p; });

/** Espera o URL do servidor e devolve a origem (para o `Origin` dos pedidos). */
async function origem(): Promise<string> {
  const limite = Date.now() + 20000;
  while (Date.now() < limite) {
    const m = /tela em (http:\/\/127\.0\.0\.1:\d+)\/index\.html/.exec(saidaServidor);
    if (m) return m[1]!;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`o servidor nao publicou o URL em 20 s: ${erroServidor || saidaServidor}`);
}

let saida = 1;
try {
  const base = await origem();
  const pedir = (corpo: Record<string, unknown>, cabecalhos: Record<string, string> = {}, caminho = "/api/credencial") =>
    fetch(base + caminho, { method: "POST", headers: { "content-type": "application/json", "x-mesacore": "1", origin: base, ...cabecalhos }, body: JSON.stringify(corpo) });

  console.log("── a tela grava o valor; a resposta e o registo so' levam a FORMA");
  const alvo = join(credenciais, "zz-bancada.key");
  const r1 = await (await pedir({ conta: "zz-bancada", ficheiro: alvo, valor: VALOR })).json() as any;
  certeza(r1.ok === true, `o valor foi GRAVADO (ok=${r1.ok}${r1.porque ? " · " + r1.porque : ""})`);
  certeza(existsSync(alvo), "o ficheiro da credencial existe");
  certeza(statSync(alvo).mode % 0o1000 === 0o600, `com modo 600 (medido ${(statSync(alvo).mode & 0o777).toString(8)})`);
  certeza(readFileSync(alvo, "utf8") === VALOR, "e o conteudo e' EXACTAMENTE o valor colado (sem \\n nem \\r)");
  certeza(r1.forma?.comprimento === VALOR.length && r1.forma?.primeiros === VALOR.slice(0, 4), `a resposta leva a FORMA (${JSON.stringify(r1.forma)})`);
  certeza(typeof r1.impressao === "string" && /^[0-9a-f]{64}$/.test(r1.impressao), "e a IMPRESSAO (sha256)");
  certeza(!JSON.stringify(r1).includes(VALOR), "o VALOR nao aparece em sitio nenhum da resposta");

  const historico = join(credenciais, "..", "historico-de-credenciais.jsonl");
  const linha = readFileSync(historico, "utf8").trim().split("\n").pop() ?? "";
  const registo = JSON.parse(linha);
  certeza(!linha.includes(VALOR), "o VALOR nao esta' no registo");
  certeza(typeof registo.instante === "string" && registo.ficheiro === alvo && registo.origem === "vista de configuração" && registo.impressao_sha256 === r1.impressao, `o registo leva instante, ficheiro, ORIGEM de onde veio e impressao — ${JSON.stringify({ instante: registo.instante, ficheiro: registo.ficheiro, origem: registo.origem })}`);

  console.log("\n── as guardas: sem origem/cabecalho nao se grava; fora da pasta nao se grava");
  const semCabecalho = await pedir({ conta: "zz-bancada", ficheiro: join(credenciais, "x.key"), valor: VALOR }, { "x-mesacore": "" });
  certeza(semCabecalho.status === 403, `sem o cabecalho proprio: 403 (medido ${semCabecalho.status})`);
  const origemErrada = await pedir({ conta: "zz-bancada", ficheiro: join(credenciais, "x.key"), valor: VALOR }, { origin: "http://outra-pagina.example" });
  certeza(origemErrada.status === 403, `com origem diferente: 403 (medido ${origemErrada.status})`);
  const fora = await pedir({ conta: "zz-bancada", ficheiro: "/tmp/fora-da-pasta.key", valor: VALOR });
  certeza(fora.status === 400, `ficheiro fora da pasta das credenciais: 400 (medido ${fora.status})`);
  certeza(!existsSync("/tmp/fora-da-pasta.key"), "e nada foi escrito fora da pasta");
  // A CONTA DO DONO aponta para um caminho REAL (a pasta do dono), que NAO e' esta pasta de bancada: derivar o
  // caminho dela tem de RECUSAR, senao a bancada escrevia nas credenciais do dono.
  const daContaDoDono = await pedir({ conta: "hl-teste-plugin" });
  certeza(daContaDoDono.status === 400, `derivar o caminho da conta do dono (fora desta pasta) e' RECUSADO: 400 (medido ${daContaDoDono.status})`);

  console.log("\n── a mesma regua do escritor: valor curto RECUSA, e nada e' criado");
  const curto = await pedir({ conta: "zz-bancada", ficheiro: join(credenciais, "curto.key"), valor: "curto" });
  const corpoCurto = await curto.json() as any;
  certeza(curto.status === 409 && corpoCurto.ok === false, `valor curto: RECUSADO (medido ${curto.status})`);
  certeza(/curto de mais|caracteres/.test(String(corpoCurto.porque ?? "")), `e a recusa diz por que': «${String(corpoCurto.porque).slice(0, 80)}»`);
  certeza(!existsSync(join(credenciais, "curto.key")), "e nenhum ficheiro foi criado");

  // O CAMINHO DERIVADO (sem `ficheiro`): a porta usa `<pasta>/<conta>.key`.
  const r2 = await (await pedir({ conta: "zz-bancada", valor: VALOR })).json() as any;
  certeza(r2.ok === true && r2.ficheiro === alvo, `sem indicar ficheiro, deriva <pasta>/<conta>.key (${r2.ficheiro})`);

  console.log("");
  if (problemas.length === 0) {
    console.log("prova da credencial: o valor fica num ficheiro 0600 fora do repo · a resposta e o registo só levam a FORMA · as guardas recusam");
    saida = 0;
  } else {
    console.log(`prova da credencial: FALHOU — ${problemas.length} verificacao(oes)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova da credencial: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  proc.kill("SIGKILL");
  rmSync(credenciais, { recursive: true, force: true });
  try { rmSync(join(credenciais, "..", "historico-de-credenciais.jsonl"), { force: true }); } catch { /* nada */ }
}
process.exit(saida);
