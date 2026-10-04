#!/usr/bin/env bun
// A PROVA DO DASH DE CONFIGURACAO — os quatro numeros que o dono chamava de «impraticavel, confuso e cheio de bugs».
//
// O QUE ISTO MEDE, no DOM (Chrome headless), com um fio de bancada servido da copia da tela:
//   1. ALVOS DE TOQUE: no telefone (390x844), ZERO botoes abaixo de 44 px (a regua da casa). Antes: 13 de 13 a 30 px;
//   2. O GESTO PRINCIPAL A' VISTA: o botao que EDITA a ficha («mudar esta ficha») e os dois interruptores (rodar ·
//      enviar) estao VISIVEIS na vista — nenhum escondido num dialogo. E o DIALOGO LEGADO nao existe mais
//      (`#dialogo` ausente do DOM): havia DUAS portas para a mesma configuracao;
//   3. CAMPOS DUPLICADOS: a mesma chave do documento em mais de um SITIO da vista. Antes: 6 (conta, setup, relogio,
//      ao_desligar na tabela + nas procedencias; run, enviar na tabela + na faixa). Depois: 0;
//   4. o fio VAZIO (sem fichas) nao rebenta: a vista DIZ que nao ha' ficha, em vez de ficar em branco.
//
// A PROVOCACAO: injecta-se uma linha com uma chave que JA' existe noutro sitio e exige-se que a contagem a apanhe —
// sem isto, um criterio que nunca reprovou nao mediu nada.
//
// Uso:  bun run tools/painel/prova-do-dash.ts

import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirBancada, type Bancada } from "./bancada-cdp.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const TELA = join(RAIZ, "web", "painel");
const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

// A MEDIDA, dentro da pagina. Uma chave e' DUPLICADA quando aparece em mais de um SITIO: a tabela do documento, um
// campo (na composicao), a faixa de acoes, ou a tabela de procedencias. O rotulo e o campo da MESMA linha sao UM
// sitio (a linha), nao dois.
const MEDIDA = String.raw`
(() => {
  const sitios = {};
  const add = (k, s) => { if (k) (sitios[k] = sitios[k] || new Set()).add(s); };
  for (const tr of document.querySelectorAll("#corpo-da-ficha table.tab tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 1) continue;
    const rot = (tds[0].textContent || "").trim().split("\n")[0];
    if (/^(cabecalho|constantes|conexao|conta)\.[a-z0-9_.]+$/i.test(rot)) add(rot, "tabela");
  }
  for (const el of document.querySelectorAll("#corpo-da-ficha [data-chave]")) add(el.dataset.chave, "campo");
  for (const el of document.querySelectorAll("#acoes [data-chave]")) add(el.dataset.chave, "acoes");
  const duplicadas = [];
  for (const [k, s] of Object.entries(sitios)) {
    if (s.has("tabela") && s.has("campo")) { s.delete("tabela"); s.delete("campo"); s.add("linha"); }
    if (s.size > 1) duplicadas.push(k + " [" + [...s].join("+") + "]");
  }
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0; };
  const btn = [...document.querySelectorAll("#vista-de-config button, #vista-de-config .botao")].filter(vis);
  const pequenos = btn.filter((b) => b.getBoundingClientRect().height < 44).map((b) => (b.textContent || "").trim().slice(0, 16));
  const porTexto = (re) => btn.find((b) => re.test(b.textContent || ""));
  return {
    dialogoNoDom: document.getElementById("dialogo") !== null,
    nBotoes: btn.length, nPequenos: pequenos.length, pequenos,
    gestoDeEditarVisivel: vis(porTexto(/mudar esta ficha|validar a mudança|escrever a ficha/)),
    interruptoresVisiveis: btn.filter((b) => /rodar|enviar/.test(b.textContent || "")).length,
    chavesDuplicadas: duplicadas.length, duplicadas,
    docW: document.documentElement.scrollWidth, winW: document.documentElement.clientWidth,
    semFicha: /nenhuma ficha no reposit/.test(document.getElementById("corpo-da-ficha") ? document.getElementById("corpo-da-ficha").innerText : ""),
    erros: (window.__erros || []).length,
  };
})()`;

const agora = Date.now();
const cabecalho = {
  _o_que_e_isto: "ficha de bancada", conta: "conta-de-bancada", instrumento: "BTC", setup: "sigma", relogio: "30m",
  run: true, ao_desligar: "fechar", saldo_pct: "10", alavancagem: "1",
  bandas: { saldo_pct: { minimo: "0.5", maximo: "20" }, alavancagem: { minimo: "1", maximo: "3" } },
  prazo_de_resposta_ms: 5000, enviar: false,
};
const ficha = { caminho: "fichas/sigma/BTC-conta-de-bancada.json", hash: "abc", versao_do_setup: "0.1.0", linguagem: "typescript", cabecalho, constantes: { ma_len: 24, ma_tipo: "EMA", usar_zz: true } };
const instrumento = {
  instrumento: "BTC", conta: "conta-de-bancada",
  ficha: { caminho: ficha.caminho, setup: "sigma", versao_do_setup: "0.1.0", linguagem: "typescript", relogio: "30m", run: true, enviar: false, ao_desligar: "fechar" },
  risco: {}, template: {}, valores_resolvidos: {}, parametros: {}, leitura: {}, velas: [], serie_do_setup: [], buracos: [],
  janela: null, em_curso: null, sobreposicao_indisponivel: null, faltas_do_cruzamento: null, o_que_o_setup_disse: {},
  proposta: null, ultima_decisao: null, decisao_contagem: {}, parado: { travado: false }, decisoes_de_abrir_ms: [],
  marcas_nossas_conhecidas: [], fontes: {}, falhas: null, divergente: null,
};
const fio = (comFicha: boolean) => ({
  retrato: { gerado_em_ms: agora, gerado_em: new Date(agora).toISOString(), instalacoes: [{ instalacao: "bancada-do-dash", corrida: "/tmp/bancada" }], descoberta: "bancada" },
  registo_de_mesas: [],
  mesas: [{
    instalacao: "bancada-do-dash", identidade: "conta-de-bancada", corrida: "/tmp/bancada", plugin: "sigma", ambiente: null,
    estado_da_mesa: "em_operacao", estado_desde_ms: agora, estado_porque: null, estado_verbo: null, operacao_em_ms: agora,
    idade_da_operacao_ms: 100, ligacao: "ligada", nota_da_operacao: "bancada", fontes: {},
    contas: [{ conta: "conta-de-bancada", equity: "991.63", instrumentos: comFicha ? [instrumento] : [] }],
    registo: { linhas: 0, ciclos: 0, por_instrumento: {}, motivos: {}, motivos_por_instrumento: {}, mandato: [] },
    carteiro: { passagens: 0, por_que_nao_saiu: {} }, saiu_para_o_venue: { desfechos: [], marcas_de_posse: [] },
  }],
  geral: { n_instalacoes: 1, n_pares: 0, posicoes: [], ordens_vivas: [], parados: [] },
  plugins: [{ nome: "sigma", versao: "0.1.0", linguagem: "typescript", pasta: "setups/sigma", publica_serie: true, pares: [] }],
  catalogo: { conectores: [], segredos_escondidos: 0 },
  configuracao: {
    contas: [{ nome: "conta-de-bancada", caminho: "config/contas/conta-de-bancada.json", existe: true, conteudo: { conexao: { credencial: { valor_em: "ficheiro:/tmp/credenciais/conta-de-bancada.key" } } } }],
    fichas: comFicha ? [ficha] : [],
    conferidor: { correu: true, codigo: 0, saida: "bancada: 1 ficha conferida · 0 falhas" }, segredos_escondidos: 0, escreve: true, porta_que_escreve: "bash tools/ligar-par.sh",
  },
  faltas: [],
});

const pasta = mkdtempSync(join(tmpdir(), "mesacore-prova-dash-"));
mkdirSync(join(pasta, "js"), { recursive: true });
for (const f of ["index.html", "tema.css", "lightweight-charts.standalone.production.js"]) cpSync(join(TELA, f), join(pasta, f));
cpSync(join(TELA, "js"), join(pasta, "js"), { recursive: true });

const servidor = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname === "/" ? "/index.html" : decodeURIComponent(new URL(req.url).pathname);
    const caminho = join(pasta, p);
    if (!caminho.startsWith(pasta) || !existsSync(caminho)) return new Response("nao esta aqui", { status: 404 });
    return new Response(Bun.file(caminho), { headers: { "cache-control": "no-store" } });
  },
});
const URL_DA_TELA = `http://127.0.0.1:${servidor.port}/index.html#configuracao`;

let saida = 1;
let bancada: Bancada | null = null;
try {
  writeFileSync(join(pasta, "painel.json"), JSON.stringify(fio(true)));
  writeFileSync(join(pasta, "vivo.json"), JSON.stringify(fio(true)));

  for (const [nome, largura, altura] of [["desktop", 1440, 900], ["telefone", 390, 844]] as const) {
    bancada?.fechar();
    bancada = await abrirBancada({ url: URL_DA_TELA, largura, altura, espera_ms: 4000 });
    await bancada.avaliar("window.__erros=[]; window.onerror=(m)=>window.__erros.push(String(m)); 1");
    await new Promise((r) => setTimeout(r, 1500));
    const m = await bancada.avaliar(MEDIDA);
    console.log(`\n===== ${nome} (${largura}x${altura}) · vista #configuracao =====`);
    console.log(JSON.stringify(m));
    if (nome === "telefone") {
      certeza(m.nPequenos === 0, `no telefone, ZERO botoes abaixo de 44 px (medido ${m.nPequenos}${m.nPequenos ? ": " + m.pequenos.join(", ") : ""})`);
    }
    certeza(m.chavesDuplicadas === 0, `ZERO chaves do documento em mais de um sitio (medido ${m.chavesDuplicadas}${m.chavesDuplicadas ? ": " + m.duplicadas.join(" | ") : ""})`);
    certeza(m.dialogoNoDom === false, "o DIALOGO LEGADO nao existe no DOM (uma configuracao, uma porta: a vista)");
    certeza(m.gestoDeEditarVisivel === true, "o gesto principal de editar a ficha esta' A' VISTA (nao num dialogo)");
    certeza(m.interruptoresVisiveis >= 2, `os dois interruptores (rodar · enviar) estao visiveis na vista (medido ${m.interruptoresVisiveis})`);
    certeza(m.docW <= m.winW, `sem transbordo lateral (doc ${m.docW} <= janela ${m.winW})`);
    certeza(m.erros === 0, `0 erros na pagina (medido ${m.erros})`);
  }

  // A PROVOCACAO: a MESMA chave injectada noutro SITIO (a faixa de acoes), e a contagem TEM de a apanhar.
  const provocado = await bancada!.avaliar(`(() => {
    const a = document.getElementById("acoes");
    if (!a) return null;
    const b = document.createElement("button"); b.className = "botao"; b.dataset.chave = "cabecalho.saldo_pct"; b.textContent = "provocação";
    a.appendChild(b);
    return true;
  })()`);
  const mProv = await bancada!.avaliar(MEDIDA);
  certeza(provocado === true && mProv.chavesDuplicadas >= 1, `a PROVOCACAO e' apanhada: a mesma chave noutro sitio faz a contagem subir (medido ${mProv.chavesDuplicadas})`);

  // O FIO VAZIO: sem fichas, a vista NAO fica em branco — DIZ que nao ha' ficha. O `#configuracao` tem de ficar
  // DEPOIS do `?`, senao o hash deixa de ser `#configuracao` e a vista nem aparece (erro que a bancada cometeu).
  writeFileSync(join(pasta, "painel.json"), JSON.stringify(fio(false)));
  writeFileSync(join(pasta, "vivo.json"), JSON.stringify(fio(false)));
  await bancada!.mandar("Page.navigate", { url: URL_DA_TELA.split("#")[0] + "?t=" + Date.now() + "#configuracao" });
  await new Promise((r) => setTimeout(r, 2000));
  const vazio = await bancada!.avaliar(MEDIDA);
  certeza(vazio.semFicha === true, "com o fio VAZIO (sem fichas), a vista DIZ que nao ha' ficha — nao fica em branco");
  certeza(vazio.erros === 0, `e o fio vazio nao rebenta (0 erros, medido ${vazio.erros})`);

  // A CREDENCIAL NA TELA: o campo (type=password) e o botao de gravar existem na vista — a porta de escrita que
  // grava o VALOR no padrao da casa. (O POST a serio, contra o servidor, prova-se em `prova-da-credencial.ts`.)
  const cred = await bancada!.avaliar(`(() => {
    const campo = document.querySelector("#vista-de-config input[data-credencial]");
    const botao = document.querySelector("#vista-de-config [data-acao='gravar-credencial']");
    document.querySelectorAll("#vista-de-config [data-acao='gravar-credencial']").forEach((b) => { b.dataset.provado = "1"; });
    return { temCampo: campo !== null && campo.type === "password", temBotao: botao !== null, ligado: botao ? typeof botao.onclick === "function" : false };
  })()`);
  certeza(cred.temCampo === true && cred.temBotao === true, "a vista tem o CAMPO da credencial (type=password) e o botao de gravar");
  certeza(cred.ligado === true, "e o botao TEM gesto (a porta de escrita esta' ligada, nao e' um botao morto)");

  console.log("");
  if (problemas.length === 0) {
    console.log("prova do dash: alvos de toque >=44 no telefone · gesto de editar à vista · zero chaves duplicadas · o fio vazio é dito");
    saida = 0;
  } else {
    console.log(`prova do dash: FALHOU — ${problemas.length} verificacao(oes)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova do dash: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  bancada?.fechar();
  try { servidor.stop(true); } catch { /* ja parado */ }
  rmSync(pasta, { recursive: true, force: true });
}
process.exit(saida);
