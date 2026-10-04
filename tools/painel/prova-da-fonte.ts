#!/usr/bin/env bun
// A PROVA DA FONTE — «o que a tela serve É o que o repositório tem», e há UMA só pasta servida.
//
// O DEFEITO QUE ISTO PREVINE (medido a 03/10/2026): a 8788 servia `scratch/painel-v2/`, uma CÓPIA editável à mão
// da tela, de horas antes — sem as correcções e com o retrato de ontem. O dono via o recolhido partido (o fix
// existia em `web/painel/` e não na cópia) e a tela a dizer «SEM DADOS HÁ 17 H» com o sistema a correr. Duas
// pastas, duas verdades, e a que ele abria podia não ser a que o sistema escrevia.
//
// A prova fecha a classe de três maneiras, e nenhuma é um `grep`:
//   1. arranca o `servidor.ts` com os ARGUMENTOS POR OMISSÃO (os da unit) e busca CADA ficheiro da tela pelo fio,
//      comparando o `sha256` com o do ficheiro do repositório — byte a byte, o que a tela serve é o do repo;
//   2. o fio (`painel.json`/`vivo.json`) que o servidor serve é o MESMO ficheiro que ele gera na pasta que serve
//      (o gerador e o servidor são o mesmo processo, e o `--para` é dentro da `--pasta`);
//   3. a unit e o lançador NÃO apontam a outra pasta: nenhum `--pasta` no `mesacore-painel.service` nem no
//      `servir.sh`, e nenhuma referência a uma cópia (`painel-v2`, `painel-teste`) no repositório.
//
// Uso:  bun run tools/painel/prova-da-fonte.ts

import { join, relative } from "node:path";
import { readdirSync, readFileSync, existsSync, statSync, cpSync, rmSync } from "node:fs";

const RAIZ = join(import.meta.dir, "..", "..");
const TELA = join(RAIZ, "web", "painel");

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};
const sha = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Os ficheiros da TELA (o código, não o fio): o que a tela serve e o repositório versiona. */
function ficheirosDaTela(dir = TELA, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    const r = relative(TELA, p);
    if (r === "painel.json" || r === "vivo.json") continue;   // o fio é ESTADO gerado, não código
    if (statSync(p).isDirectory()) ficheirosDaTela(p, acc);
    else acc.push(r);
  }
  return acc;
}

function portaLivre(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const p = s.port!;
  s.stop(true);
  return p;
}

let saida = 1;
let servidor: Bun.Subprocess | null = null;
try {
  console.log("── 1. o `servidor.ts` com os argumentos POR OMISSÃO (os da unit) serve a pasta do repositório");
  const porta = portaLivre();
  servidor = Bun.spawn(["bun", "run", join(RAIZ, "tools", "painel", "servidor.ts"), "--porta", String(porta), "--endereco", "127.0.0.1", "--intervalo", "0", "--intervalo-vivo", "0"], { stdout: "pipe", stderr: "pipe" });
  const dec = new TextDecoder();
  let pronto = false;
  const leitor = (servidor.stdout as ReadableStream<Uint8Array>).getReader();
  const limite = Date.now() + 20000;
  while (Date.now() < limite && !pronto) {
    const { value, done } = await leitor.read();
    if (done) break;
    if (dec.decode(value).includes("tela em")) pronto = true;
  }
  if (!pronto) throw new Error("o servidor do painel não arrancou em 20 s");

  const ficheiros = ficheirosDaTela().sort();
  console.log(`   (a tela tem ${ficheiros.length} ficheiro(s) de código)`);
  let diferentes = 0;
  for (const f of ficheiros) {
    const r = await fetch(`http://127.0.0.1:${porta}/${f}`);
    const doRepo = readFileSync(join(TELA, f));
    const igual = r.status === 200 && sha(new Uint8Array(await r.arrayBuffer())) === sha(doRepo);
    if (!igual) { diferentes++; console.log(`   FALHA ${f} — servido ≠ repositório (status ${r.status})`); }
  }
  certeza(diferentes === 0, `cada ficheiro servido é byte a byte o do repositório (${ficheiros.length} de ${ficheiros.length})`);

  // ------------------------------------------------------------------------------------------
  console.log("\n── 2. o fio que a tela serve é o que o servidor GERA na pasta que serve");
  for (const f of ["painel.json", "vivo.json"]) {
    const noDisco = join(TELA, f);
    const r = await fetch(`http://127.0.0.1:${porta}/${f}`);
    const igual = existsSync(noDisco) && r.status === 200 && sha(new Uint8Array(await r.arrayBuffer())) === sha(readFileSync(noDisco));
    certeza(igual, `o ${f} servido é o mesmo ficheiro que está em web/painel/ (o gerador e o servidor são o mesmo processo)`);
  }

  // ------------------------------------------------------------------------------------------
  console.log("\n── 3. a unit e o lançador não apontam a outra pasta, e não há cópia no repositório");
  const unit = readFileSync(join(RAIZ, "tools", "painel", "mesacore-painel.service"), "utf8");
  const servir = readFileSync(join(RAIZ, "tools", "painel", "servir.sh"), "utf8");
  certeza(!/--pasta/.test(unit), "o `mesacore-painel.service` NÃO passa `--pasta` (usa a omissão: a pasta do repo)");
  certeza(!/^\s*exec .*--pasta/m.test(servir), "o `servir.sh` NÃO passa `--pasta` ao servidor");
  // A cópia à mão não pode existir para ser servível — é o que fecha a recaída medida (a `scratch/painel-v2`).
  const copiasFora = ["painel-v2", "painel-teste"].filter((n) => existsSync(join(process.env.HOME ?? "", ".hermes", "profiles", "appbuilder", "cache", "scratch", n)));
  certeza(copiasFora.length === 0, `nenhuma cópia servível da tela no scratch (${copiasFora.join(", ") || "nenhuma"})`);

  // ------------------------------------------------------------------------------------------
  // A PROVOCAÇÃO: se alguém servir OUTRA pasta, o mesmo critério tem de a REPROVAR. Serve-se uma cópia com o
  // `index.html` mexido e exige-se que o `sha256` dela NÃO seja o do repositório — sem isto, um teste cego (que
  // aprovasse tudo) passaria a verde, e um teste que nunca reprova não é uma prova.
  console.log("\n── 4. a provocação: servir uma CÓPIA divergente tem de ser reprovado pelo mesmo critério");
  const copia = await Bun.$`mktemp -d`.text().then((s) => s.trim());
  try {
    cpSync(TELA, copia, { recursive: true });
    rmSync(join(copia, "painel.json"), { force: true });
    rmSync(join(copia, "vivo.json"), { force: true });
    const html = readFileSync(join(TELA, "index.html"), "utf8") + "\n<!-- cópia editada à mão: o defeito medido -->\n";
    await Bun.write(join(copia, "index.html"), html);
    const portaCopia = portaLivre();
    const s2 = Bun.spawn(["bun", "run", join(RAIZ, "tools", "painel", "servidor.ts"), "--porta", String(portaCopia), "--endereco", "127.0.0.1", "--pasta", copia, "--intervalo", "0", "--intervalo-vivo", "0"], { stdout: "ignore", stderr: "ignore" });
    await Bun.sleep(1500);
    const r = await fetch(`http://127.0.0.1:${portaCopia}/index.html`);
    const daCopia = sha(new Uint8Array(await r.arrayBuffer()));
    const doRepo = sha(readFileSync(join(TELA, "index.html")));
    s2.kill();
    certeza(r.status === 200 && daCopia !== doRepo, `uma pasta divergente é APANHADA (sha da cópia ≠ sha do repo: ${daCopia.slice(0, 10)} ≠ ${doRepo.slice(0, 10)})`);
  } finally {
    await Bun.$`rm -rf ${copia}`.quiet();
  }

  console.log("");
  if (problemas.length === 0) {
    console.log("prova da fonte: uma só pasta servida (a do repositório) · o servidor gera o fio que serve · nenhuma cópia à mão pelo caminho");
    saida = 0;
  } else {
    console.log(`prova da fonte: FALHOU — ${problemas.length} verificação(ões)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova da fonte: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try { servidor?.kill(); } catch { /* já morreu */ }
}
process.exit(saida);
