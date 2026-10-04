#!/usr/bin/env bun
// A PROVA DOS BURACOS — o vao do historico e' MARCADO e NOMEADO (de/ate + quantas faltam), nunca silencioso.
//
// O DEFEITO QUE ISTO MEDE (04/10/2026). O dono viu um gap no grafico e nao sabia se era leitura falhada,
// duplicado ou paragem. Mediu-se: 0 duplicados nos tres pares, e um vao REAL — a paragem da maquina — que o FEED
// ja' NOMEAVA (`buraco_no_historico`, com `faltam`) mas que NUNCA chegava ao ecra. O vao passa a viajar no fio e a
// tela desenha-o MARCADO (um marcador na barra seguinte) e NOMEADO (de/ate + faltam). A barra que faltou NAO se
// inventa, e o vao NAO se atravessa em silencio.
//
// O FIO E' CONSTRUIDO COM A FUNCAO DO PRODUTOR (`buracosDeHistorico`, importada do `retrato`): a bancada nao tem
// uma segunda conta das faltas. Cobrem-se os dois vaos que a medicao real encontrou — o de 1 barra (a barra em
// falta com a corrida viva) e o de 17,5 h (a paragem da maquina, 34 barras de 30m).
//
// Uso:  bun run tools/painel/prova-dos-buracos.ts

import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirBancada, type Bancada } from "./bancada-cdp.ts";
import { buracosDeHistorico } from "./buracos.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const TELA = join(RAIZ, "web", "painel");
const PASSO = 1_800_000; // 30m — o relogio dos vaos medidos

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

// ---------------------------------------------------------------- o fio de bancada (com os DOIS vaos)
const agora = Date.now();
const t0 = Math.floor(agora / PASSO) * PASSO - 60 * PASSO;
const barra = (t: number, c: number) => ({ t, o: c - 40, h: c + 60, l: c - 80, c, v: "1.2", n: 10 });
const velas: any[] = [];
let c = 85000;
for (let i = 0; i < 10; i++) velas.push(barra(t0 + i * PASSO, (c += 7)));                    // t0 .. t0+9
velas.push(barra(t0 + 11 * PASSO, (c += 7)));                                                // VAO de 1 barra (saltou t0+10)
for (let i = 12; i < 22; i++) velas.push(barra(t0 + i * PASSO, (c += 7)));                   // t0+12 .. t0+21
velas.push(barra(t0 + (21 + 35) * PASSO, (c += 7)));                                          // VAO de 34 barras (17,5 h)

const buracos = buracosDeHistorico(velas);
certeza(buracos.length === 2, `a funcao do produtor conta 2 vaos (medido ${buracos.length})`);
certeza(buracos.some((b) => b.faltam === 1), `e um deles e' o vao de 1 barra: ${JSON.stringify(buracos.find((b) => b.faltam === 1) ?? null)}`);
certeza(buracos.some((b) => b.faltam === 34), `e o outro e' o vao de 17,5 h / 34 barras: ${JSON.stringify(buracos.find((b) => b.faltam === 34) ?? null)}`);
const doZero = buracosDeHistorico([]);
certeza(doZero.length === 0, "sem velas (ou sem passo legivel) NAO se inventa vao nenhum (devolve 0)");

const instrumento = {
  instrumento: "BTC", conta: "conta-de-bancada",
  ficha: { caminho: "fichas/sigma/BTC-conta-de-bancada.json", setup: "sigma", versao_do_setup: "0.1.0", linguagem: "typescript", relogio: "30m", run: true, enviar: false, ao_desligar: "fechar" },
  risco: { saldo_pct: "10", alavancagem: "1", bandas: {}, prazo_de_resposta_ms: "5000" },
  template: {}, valores_resolvidos: {}, parametros: {},
  leitura: { bid: "85359.0", ask: "85360.0", ultimo: "85359.0", idade_do_dado_ms: 120, equity: "991.63", posicao: null, ordens_abertas: [] },
  velas, serie_do_setup: [], janela: { de: velas[0]!.t, ate: velas[velas.length - 1]!.t }, buracos,
  em_curso: null, sobreposicao_indisponivel: null, faltas_do_cruzamento: null,
  o_que_o_setup_disse: {}, proposta: null, ultima_decisao: null, decisao_contagem: {}, parado: { travado: false },
  decisoes_de_abrir_ms: [], marcas_nossas_conhecidas: [], fontes: {}, falhas: null, divergente: null,
};
const fio = {
  retrato: { gerado_em_ms: agora, gerado_em: new Date(agora).toISOString(), instalacoes: [{ instalacao: "bancada-dos-buracos", corrida: "/tmp/bancada" }], descoberta: "bancada (fixture da prova)" },
  registo_de_mesas: [],
  mesas: [{
    instalacao: "bancada-dos-buracos", identidade: "conta-de-bancada", corrida: "/tmp/bancada", plugin: "sigma", ambiente: null,
    estado_da_mesa: "em_operacao", estado_desde_ms: agora, estado_porque: null, estado_verbo: null,
    operacao_em_ms: agora, idade_da_operacao_ms: 500, ligacao: "ligada", nota_da_operacao: "bancada",
    fontes: { operacao: { caminho: "operacao.json", em_ms: agora, idade_ms: 500 } },
    contas: [{ conta: "conta-de-bancada", equity: "991.63", instrumentos: [instrumento] }],
    registo: { linhas: 0, ciclos: 0, por_instrumento: {}, motivos: {}, motivos_por_instrumento: {}, mandato: [] },
    carteiro: { passagens: 0, por_que_nao_saiu: {} }, saiu_para_o_venue: { desfechos: [], marcas_de_posse: [] },
  }],
  geral: { n_instalacoes: 1, n_pares: 1, posicoes: [], ordens_vivas: [], parados: [] },
  plugins: [], catalogo: { conectores: [], segredos_escondidos: 0 },
  configuracao: { contas: [], fichas: [], conferidor: { correu: true, codigo: 0, saida: "" }, segredos_escondidos: 0, escreve: false, porta_que_escreve: "—" },
  faltas: [],
};

const pasta = mkdtempSync(join(tmpdir(), "mesacore-prova-buracos-"));
mkdirSync(join(pasta, "js"), { recursive: true });
for (const f of ["index.html", "tema.css", "lightweight-charts.standalone.production.js"]) cpSync(join(TELA, f), join(pasta, f));
cpSync(join(TELA, "js"), join(pasta, "js"), { recursive: true });
writeFileSync(join(pasta, "painel.json"), JSON.stringify(fio));
writeFileSync(join(pasta, "vivo.json"), JSON.stringify({ ...fio, agora: { gerado_em_ms: agora } }));

const servidor = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname === "/" ? "/index.html" : decodeURIComponent(new URL(req.url).pathname);
    const caminho = join(pasta, p);
    if (!caminho.startsWith(pasta) || !existsSync(caminho)) return new Response("nao esta aqui", { status: 404 });
    return new Response(Bun.file(caminho), { headers: { "cache-control": "no-store" } });
  },
});
const URL_DA_TELA = `http://127.0.0.1:${servidor.port}/index.html`;

let saida = 1;
let bancada: Bancada | null = null;
try {
  bancada = await abrirBancada({ url: URL_DA_TELA, largura: 1440, altura: 900 });
  await bancada.avaliar(`new Promise((r)=>{ if(document.readyState!=="loading") r(true); else addEventListener("DOMContentLoaded",()=>r(true)); })`);
  await new Promise((r) => setTimeout(r, 2500));
  const texto = (id: string) => bancada!.avaliar(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return e ? e.innerText.replace(/\\s+/g," ").trim() : null; })()`);

  console.log("\n── o vao aparece MARCADO e NOMEADO no cabecalho do grafico");
  const cab = await texto("cabecalho-do-grafico");
  certeza(typeof cab === "string" && /faltam 1\b/.test(cab), `nomeia o vao de 1 barra (de/ate + quantas faltam) — «${String(cab).slice(0, 150)}»`);
  certeza(typeof cab === "string" && /faltam 34\b/.test(cab), "nomeia o vao de 34 barras (a paragem de 17,5 h)");
  certeza(typeof cab === "string" && /vão/.test(cab), "e chama-lhe «vão» (a palavra do dono, nao um silencio)");
  certeza(typeof cab === "string" && /\d{2}\/\d{2}, \d{2}:\d{2}→\d{2}\/\d{2}, \d{2}:\d{2}/.test(cab), "com o DE e o ATE em dia/hora");

  const diag = JSON.parse(await bancada.avaliar("JSON.stringify(window.__diag || {})"));
  certeza(diag.buracos === 2, `o gráfico conta os 2 vaos (window.__diag.buracos = ${diag.buracos})`);

  // O CONTROLE: sem vao no fio, a tela NAO inventa um aviso. Prova que a marca e' do DADO, e nao um aviso que sai sempre.
  const semVao = { ...fio, mesas: [{ ...fio.mesas[0]!, contas: [{ conta: "conta-de-bancada", equity: "991.63", instrumentos: [{ ...instrumento, buracos: [] }] }] }] };
  writeFileSync(join(pasta, "painel.json"), JSON.stringify(semVao));
  await bancada.mandar("Page.navigate", { url: URL_DA_TELA + "?t=" + Date.now() });
  await new Promise((r) => setTimeout(r, 2500));
  const cabSemVao = await texto("cabecalho-do-grafico");
  certeza(typeof cabSemVao === "string" && !/faltam/.test(cabSemVao), "CONTROLE: com o fio sem vao, NENHUM aviso de vao aparece (nao sai sempre)");

  const erros = JSON.parse(await bancada.avaliar("JSON.stringify(window.__erros || [])")) as string[];
  certeza(erros.length === 0, `0 erros na pagina (medido ${erros.length}${erros.length ? `: ${erros.join(" | ")}` : ""})`);

  console.log("");
  if (problemas.length === 0) {
    console.log("prova dos buracos: o vao do historico e' marcado e nomeado (de/ate + faltam) · a barra que faltou nao se inventa");
    saida = 0;
  } else {
    console.log(`prova dos buracos: FALHOU — ${problemas.length} verificacao(oes)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova dos buracos: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  bancada?.fechar();
  try { servidor.stop(true); } catch { /* ja parado */ }
  rmSync(pasta, { recursive: true, force: true });
}
process.exit(saida);
