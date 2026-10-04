#!/usr/bin/env bun
// A PROVA DO ARRANQUE DE PRIMEIRA VEZ — o que FALTA tem de ser DITO, e o arranque recusa por nome.
//
// O QUE ISTO MEDE, e porquê. O arranque de primeira vez (04/10/2026) tinha um lancador que prometia o que nao
// cumpria («nenhuma ficha do repositorio diz enviar:true») e nao dizia o que faltava: quem corria o sistema
// numa conta sem credencial, ou sem ficha ligada, ficava a olhar para uma pasta vazia. Agora o lancador corre
// `tools/checar-o-arranque.sh` ANTES de levantar processo nenhum, e a bancada exige que CADA falta seja dita
// pelo NOME — contra repositorios de bancada, sem tocar no venue e sem arrancar o operador.
//
// A CONTA E' UMA SO: a bancada corre o MESMO comando que o `operar-em-observacao.sh` corre (nao ha' aqui uma
// segunda copia da contingencia). Aponta-se o repositorio por `MESA_RAIZ`, que e' como se olha para um
// repositorio de bancada de propósito.
//
// A PROVOCACAO (a regra da casa: uma bancada que nunca reprovou nao mediu nada): o mesmo comando, com tudo no
// sitio, PASSA (exit 0); com cada peca em falta, REPROVA e NOMEIA a peca. Se o comando aprovasse sempre, o
// primeiro caso nao daria FALTA.
//
// Uso:  bun run tools/painel/prova-do-arranque.ts

import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const RAIZ = join(import.meta.dir, "..", "..");
const CHECAR = join(RAIZ, "tools", "checar-o-arranque.sh");

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

/** Um repositorio de bancada com uma conta e (se pedido) uma credencial e fichas. */
function repo(pecas: { conta?: boolean; credencial?: string | null; modo?: string; fichas?: { par: string; run: boolean; enviar: boolean }[] }) {
  const dir = mkdtempSync(join(tmpdir(), "mesacore-prova-arranque-"));
  mkdirSync(join(dir, "config", "contas"), { recursive: true });
  mkdirSync(join(dir, "fichas", "sigma"), { recursive: true });
  if (pecas.conta !== false) {
    // `credencial: undefined` -> aponta para `<repo>/credenciais/banca.key` E cria-a;
    // `credencial: null`      -> aponta para o mesmo caminho mas NAO a cria (o caso «o ficheiro nao existe»);
    // `credencial: "<caminho>"` -> aponta para esse caminho e cria-o la'.
    const caminho = pecas.credencial ?? join(dir, "credenciais", "banca.key");
    const criar = pecas.credencial !== null;
    if (criar) {
      mkdirSync(join(dir, "credenciais"), { recursive: true });
      writeFileSync(caminho, "chave-de-bancada");
    }
    writeFileSync(join(dir, "config", "contas", "banca.json"), JSON.stringify({
      conta: { conectores: ["hyperliquid"], credencial: "banca" },
      conexao: { credencial: { valor_em: `ficheiro:${caminho}` } },
    }));
  }
  for (const f of pecas.fichas ?? []) {
    writeFileSync(join(dir, "fichas", "sigma", `${f.par}-banca.json`), JSON.stringify({ cabecalho: { conta: "banca", instrumento: f.par, setup: "sigma", run: f.run, enviar: f.enviar } }));
  }
  return dir;
}

/** Corre o MESMO comando do lancador, contra o repositorio de bancada. */
function checar(dir: string, conta = "banca", par = "") {
  const r = Bun.spawnSync(["bash", CHECAR, conta, par], { env: { ...process.env, MESA_RAIZ: dir }, stdout: "pipe", stderr: "pipe" });
  return { codigo: r.exitCode, saida: r.stdout.toString() + r.stderr.toString() };
}

const temporarios: string[] = [];
try {
  console.log("── o arranque recusa por NOME, e passa quando nao falta nada");

  // (a) a conta nao existe.
  const semConta = repo({ conta: false });
  temporarios.push(semConta);
  const a = checar(semConta);
  certeza(a.codigo !== 0, "conta inexistente: o arranque NAO passa (exit != 0)");
  certeza(/FALTA: a conta 'banca' nao existe/.test(a.saida), `e diz que a conta falta: «${a.saida.split("\n")[0]}»`);

  // (b) a credencial nao existe (a conta aponta para ela, mas o ficheiro nao esta' la').
  const semCred = repo({ credencial: null });
  temporarios.push(semCred);
  const b = checar(semCred);
  certeza(b.codigo !== 0, "credencial ausente: o arranque NAO passa");
  const linhaDaCred = b.saida.split("\n").find((l) => /credencial/.test(l)) ?? "";
  certeza(/FALTA: a credencial nao existe/.test(b.saida), `e nomeia a credencial em falta: «${linhaDaCred}»`);

  // (b2) a credencial existe mas com modo errado -> AVISO (nao bloqueia, mas diz-se).
  const modoErrado = repo({ modo: "644", fichas: [{ par: "BTC", run: true, enviar: false }] });
  temporarios.push(modoErrado);
  Bun.spawnSync(["chmod", "644", join(modoErrado, "credenciais", "banca.key")]);
  const b2 = checar(modoErrado);
  certeza(/AVISO: a credencial .* modo 644/.test(b2.saida), "credencial com modo 644: o arranque AVISA (a casa exige 600)");
  certeza(b2.codigo === 0, "e o AVISO nao bloqueia o arranque (nao e' uma FALTA)");

  // (c) existe conta e credencial, mas nenhuma ficha ligada.
  const semFichas = repo({ fichas: [{ par: "BTC", run: false, enviar: true }] });
  temporarios.push(semFichas);
  const c = checar(semFichas);
  certeza(c.codigo !== 0, "nenhuma ficha ligada: o arranque NAO passa");
  certeza(/FALTA: nenhuma ficha ligada/.test(c.saida), `e diz que nao ha' ficha ligada: «${c.saida.split("\n").find((l) => /ficha ligada/.test(l)) ?? ""}»`);

  // (d) ficha ligada mas ARMADA ao venue -> ATENCAO (e o arranque passa; a ficha e' que decide, e diz-se).
  const armada = repo({ fichas: [{ par: "ETH", run: true, enviar: true }] });
  temporarios.push(armada);
  const d = checar(armada);
  certeza(d.codigo === 0, "com conta, credencial e ficha ligada, o arranque PASSA (exit 0)");
  certeza(/ATENCAO: fichas ARMADAS ao venue \(enviar: true\): ETH/.test(d.saida), `e DIZ qual ficha esta' armada ao venue: «${d.saida.split("\n").find((l) => /ARMADAS/.test(l)) ?? ""}»`);
  certeza(/pares ligados: ETH/.test(d.saida), "e resume os pares ligados");

  // (e) o CONTROLE que faz a prova nao ser cega: ficha ligada e NAO armada -> passa sem o AVISO das armadas.
  const desarmada = repo({ fichas: [{ par: "SOL", run: true, enviar: false }] });
  temporarios.push(desarmada);
  const e = checar(desarmada);
  certeza(e.codigo === 0, "ficha ligada e NAO armada: passa (exit 0)");
  certeza(!/ARMADAS/.test(e.saida), "e NAO avisa de fichas armadas (nao ha' nenhuma) — o aviso nao sai sempre");

  // (f) o lancador CORRE o comando de checagem (uma conta, um dono): o `operar-em-observacao.sh` chama-o.
  const lancador = Bun.file(join(RAIZ, "tools", "operar-em-observacao.sh"));
  const texto = await lancador.text();
  certeza(/checar-o-arranque\.sh/.test(texto), "o lancador `operar-em-observacao.sh` corre o MESMO comando de checagem (uma conta, um dono)");

  console.log("");
  if (problemas.length === 0) {
    console.log("prova do arranque: o que falta e' DITO pelo nome · o arranque recusa por falta · as fichas armadas sao contadas");
  } else {
    console.log(`prova do arranque: FALHOU — ${problemas.length} verificacao(oes)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova do arranque: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  for (const d of temporarios) rmSync(d, { recursive: true, force: true });
}
process.exit(problemas.length === 0 ? 0 : 1);
