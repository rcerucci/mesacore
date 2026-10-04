#!/usr/bin/env bun
// A PROVA DO VIVO — o painel diz, em cinco segundos, o que ESTÁ VIVO e o que está PARADO e PORQUÊ, com HORAS.
//
// O QUE ISTO MEDE, no DOM (Chrome headless, o mesmo motor do dono), sobre um fio de bancada: as três perguntas
// que o dono faz ao abrir o painel — «o que está vivo? o que está parado, e porquê? de quando é cada número?».
//
//   1. as POSIÇÕES vivas e as ORDENS em aberto aparecem (não uma frase: as linhas), com a decisão da mesa;
//   2. o que está PARADO aparece com o MOTIVO e há QUANTO TEMPO (a matriz: `trava` + `ciclos` + `há X`);
//   3. a ÚLTIMA BARRA traz a sua HORA (o cabeçalho do gráfico), e o CICLO MAIS RECENTE traz a hora a que foi dito;
//   4. as TRÊS secções do «lado de dentro» dizem a FONTE e a IDADE do que mostram, e SOBREVIVEM ao recolhido
//      (recolhem e a cabeça — com o título e a fonte — fica visível e reabrível).
//
// Sem rede, sem venue, sem chave: serve a própria pasta da tela, com um fio escrito aqui.
// Uso:  bun run tools/painel/prova-do-vivo.ts

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

// ---------------------------------------------------------------- o fio de bancada (um par vivo, um parado)
const agora = Date.now();
const haUmaHora = agora - 3_600_000;
const haDoisMin = agora - 120_000;
const fonte = (caminho: string, em_ms = agora) => ({ caminho, em_ms, idade_ms: Date.now() - em_ms });

const ORDEM_DO_BTC = { encontrada: true, marca: 28, referencia: "mesa-sigma_v0-000028", quando: "2026-10-04T11:30:00.000Z", oid: 61809804678, cloid: "0xabc", preco_medio: "2675.3", classificacao: "aceite", recusado: false, preenchido: "0.004" };

const instrumento = (nome: string, parado: boolean) => ({
  instrumento: nome, conta: "conta-de-bancada",
  ficha: { caminho: `fichas/sigma/${nome}-conta-de-bancada.json`, setup: "sigma", versao_do_setup: "0.1.0", linguagem: "typescript", relogio: "30m", run: true, enviar: false, ao_desligar: "fechar" },
  risco: { saldo_pct: "10", alavancagem: "1", bandas: { saldo_pct: { minimo: "0.5", maximo: "20" } }, prazo_de_resposta_ms: "5000" },
  template: {}, valores_resolvidos: {}, parametros: {},
  leitura: {
    bid: "85181.0", ask: "85182.0", ultimo: "85181.0", idade_do_dado_ms: 120, equity: "991.66",
    posicao: nome === "BTC" ? { lado: "buy", unidades: "0.004", preco_medio: "2675.3", marca_de_posse: 28 } : null,
    ordens_abertas: nome === "BTC" ? [{ lado: "buy", unidades: "0.001", preco: "2600.0", ordem: "oid-9", marca_de_posse: 31 }] : [],
  },
  // A LIGAÇÃO À ORDEM QUE ABRIU A POSIÇÃO (ver `desfechos.ts`): o `oid` do venue é o que se compara com o UI dele.
  ordem_da_posicao: nome === "BTC" ? ORDEM_DO_BTC : null,
  velas: [
    { t: haUmaHora - 1_800_000, o: 85000, h: 85100, l: 84900, c: 85050, v: "1.2", n: 10 },
    { t: haUmaHora, o: 85050, h: 85200, l: 85000, c: 85181, v: "1.5", n: 12 },
  ],
  serie_do_setup: [
    { t: haUmaHora - 1_800_000, mid: 84975, ma: 84800.5, atr: 120.5, banda: 30.1, sig: 1, extremo: 85200, virada: 0 },
    { t: haUmaHora, mid: 85100, ma: 85042.5, atr: 136.4, banda: 34.1, sig: 1, extremo: 85309, virada: 0 },
  ],
  janela: { de: haUmaHora - 1_800_000, ate: haUmaHora },
  em_curso: null, sobreposicao_indisponivel: null, faltas_do_cruzamento: null,
  o_que_o_setup_disse: {}, proposta: null,
  ultima_decisao: { instante_ms: haDoisMin, tipo: "ciclo", instrumento: nome, acao: "nada", motivo: "proposta_ausente_tratada_como_hold", nota: "ciclo 12" },
  decisao_contagem: { "nada:proposta_ausente_tratada_como_hold": 12 },
  // A NATUREZA DO QUE NÃO AGIU (ver `travado.ts`): o BTC está em ATENÇÃO (a mesa não conseguiu ler — é do dono) e o
  // ETH em ESPERA (o setup não tem nada a dizer — o estado normal de um sistema em observação). As duas são DITAS,
  // mas só a primeira usa a palavra «travado».
  parado: parado
    ? (nome === "BTC"
      ? { travado: true, classe: "atencao", porque: "leitura_ausente_no_ciclo", desde_ms: agora - 6_000_000, ciclos: 33 }
      : { travado: false, classe: "espera", porque: "proposta_ausente_tratada_como_hold", desde_ms: agora - 3_600_000, ciclos: 20 })
    : { travado: false, classe: "atencao", porque: null, desde_ms: null, ciclos: 0 },
  decisoes_de_abrir_ms: [], marcas_nossas_conhecidas: [],
  fontes: { ficha: fonte(`fichas/sigma/${nome}-conta-de-bancada.json`, haUmaHora), velas: fonte(`velas-${nome}-30m.jsonl`, haDoisMin) },
  falhas: null, divergente: null,
});
const instrumentos = [instrumento("BTC", true), instrumento("ETH", true)];
const fio = {
  retrato: { gerado_em_ms: agora, gerado_em: new Date(agora).toISOString(), instalacoes: [{ instalacao: "bancada-do-vivo", corrida: "/tmp/bancada" }], descoberta: "bancada (fixture da prova)" },
  registo_de_mesas: [],
  mesas: [{
    instalacao: "bancada-do-vivo", identidade: "conta-de-bancada", corrida: "/tmp/bancada", plugin: "sigma", ambiente: null,
    estado_da_mesa: "em_operacao", estado_desde_ms: agora, estado_porque: null, estado_verbo: null,
    operacao_em_ms: agora, idade_da_operacao_ms: 500, ligacao: "ligada", nota_da_operacao: "bancada da prova do vivo",
    fontes: { operacao: fonte("operacao.json"), registo: fonte("registo.jsonl", haDoisMin), operador_log: fonte("operador.log", haDoisMin) },
    contas: [{ conta: "conta-de-bancada", equity: "991.66", instrumentos }],
    registo: { linhas: 40, ciclos: 33, por_instrumento: { BTC: 20, ETH: 13 }, motivos: {}, motivos_por_instrumento: { BTC: { "nada:proposta_ausente_tratada_como_hold": 20 }, ETH: {} }, mandato: [] },
    carteiro: { passagens: 0, por_que_nao_saiu: {} },
    saiu_para_o_venue: { desfechos: [], marcas_de_posse: [] },
  }],
  geral: {
    n_instalacoes: 1, n_pares: 2,
    posicoes: [{ instalacao: "bancada-do-vivo", conta: "conta-de-bancada", instrumento: "BTC", setup: "sigma", lado: "buy", unidades: "0.004", preco_medio: "2675.3", marca_de_posse: 28, ordem_que_a_abriu: ORDEM_DO_BTC }],
    ordens_vivas: [{ instalacao: "bancada-do-vivo", conta: "conta-de-bancada", instrumento: "BTC", setup: "sigma", lado: "buy", unidades: "0.001", preco: "2600.0", ordem: "oid-9" }],
    parados: [
      { instalacao: "bancada-do-vivo", conta: "conta-de-bancada", instrumento: "BTC", setup: "sigma", classe: "atencao", travado: true, porque: "leitura_ausente_no_ciclo", desde_ms: agora - 6_000_000, ciclos: 33, estado_da_mesa: "em_operacao" },
      { instalacao: "bancada-do-vivo", conta: "conta-de-bancada", instrumento: "ETH", setup: "sigma", classe: "espera", travado: false, porque: "proposta_ausente_tratada_como_hold", desde_ms: agora - 3_600_000, ciclos: 20, estado_da_mesa: "em_operacao" },
    ],
  },
  plugins: [{ nome: "sigma", versao: "0.1.0", linguagem: "typescript", pasta: "setups/sigma", publica_serie: false, pares: [] }],
  catalogo: { conectores: [], segredos_escondidos: 0 },
  configuracao: { contas: [], fichas: [], conferidor: { correu: true, codigo: 0, saida: "bancada" }, segredos_escondidos: 0, escreve: false, porta_que_escreve: "—" },
  faltas: [],
};

const pasta = mkdtempSync(join(tmpdir(), "mesacore-prova-vivo-"));
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
  const tem = async (id: string, re: RegExp, o_que: string) => { const t = await texto(id); certeza(typeof t === "string" && re.test(t), `${o_que} — «${String(t).slice(0, 120)}»`); };

  console.log("\n── 1. o que está VIVO: posições e ordens, com a decisão da mesa");
  await tem("vivas-corpo", /BTC[\s\S]*buy[\s\S]*0\.004/i, "a POSIÇÃO viva aparece (BTC · buy · 0.004)");
  await tem("vivas-corpo", /oid-9/, "a ORDEM em aberto aparece (oid-9)");
  await tem("contagem-das-vivas", /1 pos · 1 ord/, "a cabeça conta o que está vivo (1 pos · 1 ord)");
  await tem("fita", /travado\(s\)/i, "a fita diz a ATENÇÃO em 5 s (travados)");
  // AS DUAS NATUREZAS DITAS EM SEPARADO (ver `travado.ts`): o que precisa do dono usa a palavra «travado»; o que é
  // uma abstenção é dito como ESPERA. Sem isto, o painel chamava «travado» ao par que estava a operar.
  await tem("fita", /1 travado\(s\)/i, "e só o par em ATENÇÃO conta como travado (1, não 2)");
  await tem("fita", /à espera de sinal/i, "e o par que só abstém é dito À ESPERA DE SINAL, não como travado");
  // A LIGAÇÃO À ORDEM QUE ABRIU A POSIÇÃO: sem ela, quem abre o painel vê a posição e não sabe de que ordem veio —
  // e não consegue comparar com o UI do venue linha a linha (a ligação já era requisito).
  await tem("vivas-corpo", /ordem que a abriu[\s\S]*oid 61809804678/, "a POSIÇÃO liga-se à ORDEM que a abriu, com o `oid` do venue");
  await tem("vivas-corpo", /mesa-sigma_v0-000028/, "e com a NOSSA referência daquela ordem");
  const detalhe = await bancada.avaliar(`(() => { const tr = document.querySelector("#vivas-corpo tr.detalhe"); return tr ? tr.querySelector("td").getAttribute("colspan") : null; })()`);
  certeza(detalhe === "5", `a linha da ordem atravessa as 5 colunas (medido colspan=${detalhe})`);

  console.log("\n── 2. o que está PARADO e porquê, com o tempo");
  await tem("matriz", /sem proposta/, "a coluna TRAVA diz o motivo (em código curto, com o cru no title)");
  await tem("matriz", /há [0-9]/, "a matriz diz HÁ QUANTO TEMPO está travado");

  console.log("\n── 3. a última barra e o ciclo mais recente, com a sua HORA");
  await tem("cabecalho-do-grafico", /barra \d{2}\/\d{2}, \d{2}:\d{2}/, "a ÚLTIMA BARRA traz o dia e a hora");
  await tem("cabecalho-do-grafico", /leitura há/, "e a idade da leitura viaja com o preço");
  await tem("dentro", /última[\s\S]*\d{2}:\d{2}/, "o CICLO MAIS RECENTE traz a hora a que foi dito");

  console.log("\n── 4. as três secções do «lado de dentro»: fonte+idade, e sobrevivem ao recolhido");
  const fontesNasCabecas = await bancada.avaliar(`document.querySelectorAll("#dentro .secao .cabeca .fonte").length`);
  certeza(fontesNasCabecas === 3, `cada uma das 3 secções diz a FONTE e a IDADE do que mostra (medido ${fontesNasCabecas})`);
  const recolhido = JSON.parse(await bancada.avaliar(`(() => {
    const nucleo = window.__painel.nucleo;
    const visivel = (el) => { if (el === null) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0; };
    const out = [];
    for (const chave of ["dentro:mercado", "dentro:risco", "dentro:decisoes"]) {
      const el = document.querySelector("[data-recolhivel='" + chave + "']");
      if (nucleo.estaRecolhido(chave)) nucleo.alternarRecolhido(chave);   // sempre a partir de ABERTO
      nucleo.alternarRecolhido(chave);
      const cabeca = el.querySelector(".cabeca");
      out.push({ chave, recolheu: el.classList.contains("recolhido"), cabecaVisivel: visivel(cabeca), botaoVisivel: visivel(nucleo.oQueAbre(el)),
                 tituloNaCabeca: cabeca ? cabeca.innerText.replace(/\\s+/g, " ").trim().slice(0, 60) : null, fonteNaCabeca: cabeca ? cabeca.querySelectorAll(".fonte").length : 0 });
    }
    return JSON.stringify(out);
  })()`));
  for (const r of recolhido) {
    certeza(r.recolheu === true && r.cabecaVisivel === true && r.botaoVisivel === true && r.fonteNaCabeca >= 1,
      `«${r.chave}» SOBREVIVE ao recolhido (recolheu, a cabeça e a fonte ficam visíveis e reabrível) — «${r.tituloNaCabeca}»`);
  }

  const erros = JSON.parse(await bancada.avaliar("JSON.stringify(window.__erros || [])")) as string[];
  certeza(erros.length === 0, `0 erros na página (medido ${erros.length}${erros.length ? `: ${erros.join(" | ")}` : ""})`);

  console.log("");
  if (problemas.length === 0) {
    console.log("prova do vivo: o painel diz o que está vivo, o que está parado e porquê, e cada número traz a sua hora e a sua fonte");
    saida = 0;
  } else {
    console.log(`prova do vivo: FALHOU — ${problemas.length} verificação(ões)`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova do vivo: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  bancada?.fechar();
  try { servidor.stop(true); } catch { /* já parado */ }
  rmSync(pasta, { recursive: true, force: true });
}
process.exit(saida);
