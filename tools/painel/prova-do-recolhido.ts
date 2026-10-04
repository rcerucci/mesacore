#!/usr/bin/env bun
// A PROVA DO RECOLHIDO — o invariante da §4 da skill `painel-de-operacao`, agora em COMPORTAMENTO.
//
// O QUE ELA PROVA, e porque é que isto não é um `grep` ao CSS. O invariante é: «uma secção recolhida conserva
// SEMPRE o elemento que a abre». Um `grep` à regra conserva-a escrita, e a regra escrita foi exactamente o que
// falhou: a primeira versão conservava `header`/`h4`, e três secções que nascem com `<h3>` recolhiam e
// DESAPARECIAM inteiras — com o botão de abrir dentro —, e o dono perdeu a tela (medido a 03/10/2026).
//
// Aqui mede-se no DOM, num Chrome headless (o mesmo motor que o dono usa), e o critério é DUPLO:
//
//   1. a secção RECOLHEU (ficou com a classe que o CSS lê); e
//   2. o BOTÃO QUE A ABRE continua VISÍVEL (área > 0 e não escondido).
//
// Exigir as duas coisas é o que faz a secção mal formada fazer o teste VERMELHO, em vez de passar por não
// recolher em silêncio: o guarda do produto (`nucleo.js`) recusa recolher o que perderia o botão, e é isso que a
// prova apanha. Ficar aberta é feio; ficar sem forma de reabrir é perder a tela — e é o defeito que se previne.
//
// E a PROVOCAÇÃO: o teste injecta no DOM uma secção NOVA, com o botão FORA da cabeça, e exige que o mesmo
// critério a REPROVE — mostrando ainda que recolher à força escondia mesmo o botão. Sem estas passagens, um teste
// cego (que aprovasse tudo) passaria a verde, e um teste que nunca reprova não é uma prova.
//
// Sem rede, sem venue, sem chave: serve a própria pasta da tela, com um fio de bancada mínimo escrito aqui.
// Uso:  bun run tools/painel/prova-do-recolhido.ts   (exit 0 só quando as duas passagens estão certas)

import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirBancada, type Bancada } from "./bancada-cdp.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const TELA = join(RAIZ, "web", "painel");

// ------------------------------------------------------------------ o fio de bancada (mínimo, mas vivo)
// Não se lê a corrida de ninguém: a bancada escreve o seu próprio `painel.json`, com UMA instalação e UM par,
// só para que todas as secções que recolhem NASCAM (as três do «lado de dentro» só existem com um par em vista).
const agora = Date.now();
const instrumento = {
  instrumento: "BTC", conta: "conta-de-bancada",
  ficha: { caminho: "fichas/sigma/BTC-conta-de-bancada.json", setup: "sigma", versao_do_setup: "0.1.0", linguagem: "typescript", relogio: "1h", run: true, enviar: false, ao_desligar: "fechar" },
  risco: { saldo_pct: "5", alavancagem: "2", bandas: { saldo_pct: { minimo: "0.1", maximo: "50" } }, prazo_de_resposta_ms: "5000" },
  template: {}, valores_resolvidos: {}, parametros: {},
  leitura: { bid: "100.0", ask: "100.2", ultimo: "100.1", idade_do_dado_ms: 120, posicao: null, ordens_abertas: [], equity: "1000.00" },
  serie_do_setup: [], velas: [], janela: {}, o_que_o_setup_disse: {}, proposta: null, ultima_decisao: null,
  decisao_contagem: {}, parado: { travado: false }, decisoes_de_abrir_ms: [], marcas_nossas_conhecidas: [], falhas: null, divergente: null,
};
const fio = {
  retrato: { gerado_em_ms: agora, gerado_em: new Date(agora).toISOString(), instalacoes: [{ instalacao: "bancada-do-recolhido", corrida: "/tmp/bancada" }], descoberta: "bancada (fixture da prova)" },
  registo_de_mesas: [],
  mesas: [{
    instalacao: "bancada-do-recolhido", identidade: "conta-de-bancada", corrida: "/tmp/bancada", plugin: "sigma",
    estado_da_mesa: "em_operacao", estado_desde_ms: agora, estado_porque: null, estado_verbo: null,
    operacao_em_ms: agora, idade_da_operacao_ms: 500, ligacao: "ligada", nota_da_operacao: "bancada da prova do recolhido",
    contas: [{ conta: "conta-de-bancada", equity: "1000.00", instrumentos: [instrumento] }],
    registo: { linhas: 1, ciclos: 1, por_instrumento: { BTC: 1 }, motivos: {}, motivos_por_instrumento: { BTC: {} }, mandato: [] },
    carteiro: { passagens: 0, por_que_nao_saiu: {} },
    saiu_para_o_venue: { desfechos: [], marcas_de_posse: [] },
  }],
  geral: { n_instalacoes: 1, n_pares: 1, posicoes: [], ordens_vivas: [], parados: [] },
  plugins: [{ nome: "sigma", versao: "0.1.0", linguagem: "typescript", pasta: "setups/sigma", publica_serie: false, pares: [] }],
  catalogo: { conectores: [], segredos_escondidos: 0 },
  configuracao: { contas: [], fichas: [], conferidor: { correu: true, codigo: 0, saida: "bancada" }, segredos_escondidos: 0, escreve: false, porta_que_escreve: "—" },
  faltas: [],
};

// ------------------------------------------------------------------ o servidor da tela (cópia própria)
const pasta = mkdtempSync(join(tmpdir(), "mesacore-prova-recolhido-"));
mkdirSync(join(pasta, "js"), { recursive: true });
for (const f of ["index.html", "tema.css", "lightweight-charts.standalone.production.js"]) cpSync(join(TELA, f), join(pasta, f));
cpSync(join(TELA, "js"), join(pasta, "js"), { recursive: true });
writeFileSync(join(pasta, "painel.json"), JSON.stringify(fio));

const servidor = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname === "/" ? "/index.html" : decodeURIComponent(new URL(req.url).pathname);
    const caminho = join(pasta, p);
    if (!caminho.startsWith(pasta) || !existsSync(caminho)) return new Response("nao esta aqui", { status: 404 });
    return new Response(Bun.file(caminho), { headers: { "cache-control": "no-store" } });
  },
});
const URL_DA_TELA = `http://127.0.0.1:${servidor.port}/index.html`;

/* ============================== O CRITÉRIO, no DOM ==============================
 * Para UM contentor: pedir o gesto (o mesmo `alternarRecolhido` que os botões chamam) e medir DUAS coisas — a
 * secção recolheu, e o botão que a abre continua com área e visível.
 */
const MEDIR = (chaves: string) => `(() => {
  const nucleo = window.__painel.nucleo;
  const visivel = (el) => { if (el === null) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0; };
  const chaves = ${chaves};
  return JSON.stringify(chaves.map((chave) => {
    const el = document.querySelector("[data-recolhivel='" + chave + "']");
    if (el === null) return { chave, erro: "sem contentor" };
    if (nucleo.estaRecolhido(chave)) nucleo.alternarRecolhido(chave);   // sempre a partir de ABERTO
    nucleo.alternarRecolhido(chave);                                    // o gesto que os botões chamam
    const botao = nucleo.oQueAbre(el);
    const r = { chave, recolheu: el.classList.contains("recolhido"), botaoVisivel: visivel(botao), podiaRecolher: nucleo.podeRecolher(el) };
    // E O DEFEITO ORIGINAL, mostrado: forçar a classe à mão (o que a regra sem guarda fazia) esconde o botão.
    el.classList.add("recolhido");
    r.defeitoRealSemGuarda = !visivel(botao);
    el.classList.remove("recolhido");
    if (nucleo.estaRecolhido(chave)) nucleo.alternarRecolhido(chave);   // devolve o estado de origem
    return r;
  }));
})()`;

function julgar(rotulo: string, medidas: any[]): number {
  let falhas = 0;
  console.log(`\n── ${rotulo}: ${medidas.length} secção(ões) recolhível(is)`);
  for (const m of medidas) {
    const certo = m.recolheu === true && m.botaoVisivel === true;
    if (!certo) falhas++;
    console.log(
      `   ${certo ? "ok  " : "FALHA"} ${String(m.chave).padEnd(26)} recolheu=${m.recolheu} · botão da secção visível=${m.botaoVisivel}` +
        `${m.podiaRecolher === false ? " · (o guarda recusou: recolheria sem forma de reabrir)" : ""}${m.erro ? ` · ${m.erro}` : ""}`,
    );
  }
  return falhas;
}

let saida = 1;
let bancada: Bancada | null = null;
try {
  bancada = await abrirBancada({ url: URL_DA_TELA, largura: 1440, altura: 900 });
  await bancada.avaliar(`new Promise((r)=>{ if(document.readyState!=="loading") r(true); else addEventListener("DOMContentLoaded",()=>r(true)); })`);

  // ---- PASSAGEM 1: o DOM real. TODAS as secções recolhem e conservam o botão.
  const chaves = JSON.parse(await bancada.avaliar(`JSON.stringify(Array.from(document.querySelectorAll("[data-recolhivel]")).map((e) => e.dataset.recolhivel))`)) as string[];
  console.log(`a tela da bancada: ${chaves.length} secção(ões) recolhível(is) no DOM — ${chaves.join(", ")}`);
  const todas = JSON.parse(await bancada.avaliar(MEDIR(JSON.stringify(chaves))));
  const falhas1 = julgar("as secções da tela (o DOM real)", todas);

  // ---- PASSAGEM 2: A PROVOCAÇÃO. Uma secção NOVA, com o botão FORA da cabeça, tem de ser REPROVADA.
  await bancada.avaliar(`(() => {
    const s = document.createElement("div");
    s.setAttribute("data-recolhivel", "prova:mal-formada");
    s.innerHTML = '<div class="cabeca"><span>cabeca declarada</span></div><div class="corpo">o botao vive AQUI, fora da cabeca</div>';
    document.body.appendChild(s);
    const b = document.createElement("button");
    b.setAttribute("data-alternar", "prova:mal-formada");
    b.textContent = "abrir/fechar";
    s.querySelector(".corpo").appendChild(b);
    return true;
  })()`);
  const provocacao = JSON.parse(await bancada.avaliar(MEDIR(JSON.stringify(["prova:mal-formada"]))));
  const falhas2 = julgar("a provocação (cabeça sem .cabeca, botão fora dela)", provocacao);
  const cega = falhas2 === 0;                                        // reprovada = o teste NÃO é cego
  const defeitoReal = provocacao[0]?.defeitoRealSemGuarda === true;  // recolher à força perdia mesmo o botão

  const erros = JSON.parse(await bancada.avaliar("JSON.stringify(window.__erros || [])")) as string[];
  const avisou = erros.some((e) => e.includes("prova:mal-formada"));
  console.log(`   provocação reprovada pelo teste? ${cega ? "NÃO — o teste é cego" : "sim (é o que se exige)"}`);
  console.log(`   recolher à força (sem o guarda) perdia mesmo o botão? ${defeitoReal ? "sim — o defeito era real" : "NÃO — a provocação não prova nada"}`);
  console.log(`   o guarda DIZ o defeito? ${avisou ? "sim" : "NÃO"} (window.__erros tem ${erros.length} linha(s))`);

  console.log("");
  if (falhas1 === 0 && !cega && defeitoReal && avisou) {
    console.log(`prova do recolhido: ${todas.length} de ${todas.length} secções recolheram e CONSERVARAM o botão que as abre · a provocação foi reprovada · o defeito original era real · o defeito é dito`);
    saida = 0;
  } else {
    console.log(`prova do recolhido: FALHOU — ${falhas1} secção(ões) da tela não cumpriram o invariante${cega ? " · a provocação NÃO foi reprovada (teste cego)" : ""}${defeitoReal ? "" : " · a provocação não demonstrou o defeito"}${avisou ? "" : " · o defeito da provocação não foi dito"}`);
  }
} catch (e) {
  console.log(`prova do recolhido: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  bancada?.fechar();
  try { servidor.stop(true); } catch { /* já parado */ }
  rmSync(pasta, { recursive: true, force: true });
}
process.exit(saida);
