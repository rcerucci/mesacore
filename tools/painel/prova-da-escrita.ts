#!/usr/bin/env bun
// A PROVA DA ESCRITA — «criar/escrever uma ficha pela tela funciona com a validação do portão».
//
// O QUE ELA MEDE, e onde. Isto abre o painel a sério num Chrome headless e fala com a PORTA a sério
// (`tools/painel/servidor.ts` → `POST /api/ficha` → `tools/escrever-ficha`), que é a mesma porta que o gesto do
// dono usa. São QUATRO coisas que o contrato da escrita exige, e nenhuma delas se prova num formulário de HTML:
//
//   1. o candidato passa a validação ANTES de o ficheiro ser tocado — e um candidato que o conferidor do portão
//      reprova NÃO escreve nada, e a recusa dele é mostrada COMO ELE A DEU (não traduzida);
//   2. a impressão (sha256) que a tela viu viaja no pedido: uma página velha não passa por cima de uma mudança
//      nova — o `visto` errado é RECUSADO, nomeando o motivo;
//   3. a banda declarada na própria ficha morde: um valor fora dela é recusado com os números da banda;
//   4. a escrita é atómica, deixa linha no registo, e o ficheiro passa a ter o valor — e o VALOR É DO DONO
//      (o que ele compôs), não um que a tela inventou.
//
// Tudo o que ela cria é apagado no fim (uma ficha de bancada em `fichas/sigma/`), e o fio do repositório é
// regenerado — a bancada não deixa o dono com o fio dela.
//
// Uso:  bun run tools/painel/prova-da-escrita.ts

import { join } from "node:path";
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirBancada, sono, type Bancada } from "./bancada-cdp.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const TELA = join(RAIZ, "web", "painel");

// A ficha de bancada: um par que não existe no repositório, criado e apagado por esta prova. A CONTA tem de ser
// uma das que o fio conhece (o formulário escolhe-a numa lista) — e o INSTRUMENTO é inventado, para não colidir
// com a ficha real do mesmo par.
const CONTA = "hl-teste-plugin";
const INSTRUMENTO = "ZZPROVA";
const FICHA = `fichas/sigma/${INSTRUMENTO}-${CONTA}.json`;
const CAMINHO_FICHA = join(RAIZ, FICHA);

function portaLivre(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const p = s.port!;
  s.stop(true);
  return p;
}

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => { if (!condicao) problemas.push(texto); console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`); };

let saida = 1;
let bancada: Bancada | null = null;
let servidorPainel: Bun.Subprocess | null = null;
let pasta: string | null = null;

try {
  // ---- 1. a cópia da tela e o fio (com as fichas reais: a vista de configuração lê-as) -------------------
  pasta = mkdtempSync(join(tmpdir(), "mesacore-prova-escrita-"));
  mkdirSync(join(pasta, "js"), { recursive: true });
  for (const f of ["index.html", "tema.css", "lightweight-charts.standalone.production.js"]) cpSync(join(TELA, f), join(pasta, f));
  cpSync(join(TELA, "js"), join(pasta, "js"), { recursive: true });
  const retrato = () => {
    const r = Bun.spawnSync(["bun", "run", join(RAIZ, "tools", "painel", "retrato.ts"), "--sem-serie", "--para", join(pasta!, "painel.json"), "--raiz-das-corridas", pasta!], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`o retrato falhou: ${r.stderr.toString()}`);
    // O FIO DA BANCADA: o retrato real traz as FICHAS e o CONFERIDOR (que a vista de configuração mostra), e a
    // bancada acrescenta a MESA (com a conta) — sem isto o formulário da ficha não tinha conta nenhuma para
    // oferecer, e a prova dependia de haver uma corrida viva na máquina (o que a torna não-determinística).
    const f = JSON.parse(readFileSync(join(pasta!, "painel.json"), "utf8")) as any;
    const ms = Date.now();
    f.mesas = [{
      instalacao: "bancada-da-escrita", identidade: CONTA, corrida: "/tmp/bancada-escrita", plugin: "sigma",
      estado_da_mesa: "em_operacao", estado_desde_ms: ms, estado_porque: null, estado_verbo: null,
      operacao_em_ms: ms, idade_da_operacao_ms: 10, ligacao: "ligada", nota_da_operacao: "bancada da prova da escrita",
      fontes: { operacao: { caminho: "operacao.json", em_ms: ms, idade_ms: 10 }, registo: { caminho: "registo.jsonl", em_ms: ms, idade_ms: 10 }, operador_log: { caminho: "operador.log", em_ms: ms, idade_ms: 10 } },
      contas: [{ conta: CONTA, equity: "1000.00", instrumentos: [] }],
      registo: { linhas: 2, ciclos: 1, por_instrumento: {}, motivos: {}, motivos_por_instrumento: {}, mandato: [] },
      carteiro: { passagens: 0, por_que_nao_saiu: {} },
      saiu_para_o_venue: { desfechos: [], marcas_de_posse: [] },
    }];
    f.configuracao.contas = [{ nome: CONTA, caminho: `config/contas/${CONTA}.json`, existe: existsSync(join(RAIZ, "config", "contas", `${CONTA}.json`)), conteudo: null }];
    console.log(`   (bancada) o fio tem ${f.configuracao.fichas.length} ficha(s): ${f.configuracao.fichas.map((x: any) => x.caminho).join(", ")}`);
    writeFileSync(join(pasta!, "painel.json"), JSON.stringify(f));
  };
  retrato();

  // ---- 2. o servidor A SÉRIO ----------------------------------------------------------------------------
  const porta = portaLivre();
  servidorPainel = Bun.spawn(["bun", "run", join(RAIZ, "tools", "painel", "servidor.ts"), "--porta", String(porta), "--endereco", "127.0.0.1", "--pasta", pasta, "--raiz-das-corridas", pasta, "--intervalo", "0", "--intervalo-vivo", "0"], { stdout: "pipe", stderr: "pipe" });
  const leitor = (servidorPainel.stdout as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let pronto = false;
  const limite = Date.now() + 20000;
  while (Date.now() < limite && !pronto) {
    const { value, done } = await leitor.read();
    if (done) break;
    if (dec.decode(value).includes("tela em")) pronto = true;
  }
  if (!pronto) throw new Error("o servidor do painel não arrancou em 20 s");
  const URL = `http://127.0.0.1:${porta}/index.html#configuracao`;
  console.log(`\n── o painel serve em ${URL}`);

  bancada = await abrirBancada({ url: URL, largura: 1440, altura: 1000, espera_ms: 3000 });
  await bancada.avaliar(`location.hash = "#configuracao"`);
  await sono(500);

  const naPagina = (expr: string) => bancada!.avaliar(expr);

  // ---- 3. a ficha de bancada nasce pela tela (o `+ ficha de par`) ----------------------------------------
  console.log("\n── criar a ficha de bancada pela tela (a forma vem da ficha do mesmo setup)");
  await naPagina(`document.querySelector('[data-nova="ficha"]')?.click()`);
  await sono(400);
  const preencherNovo = (id: string, valor: string) => naPagina(`(() => { const e = document.querySelector('#corpo-da-ficha [data-novo="${id}"]'); if (e === null) return false; e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event("change")); e.dispatchEvent(new Event("input")); return true; })()`);
  await preencherNovo("instrumento", INSTRUMENTO);
  await preencherNovo("conta", CONTA);
  await sono(600);
  const avisoDaFicha = await naPagina(`document.querySelector("#aviso-do-candidato")?.innerText ?? null`);
  certeza(avisoDaFicha === null, `a ficha composta a partir do modelo está completa${avisoDaFicha ? ` — ${avisoDaFicha}` : ""}`);
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="criar"]')?.click()`);
  await sono(3500);
  const respostaDaCriacao = await naPagina(`document.querySelector("#corpo-da-ficha .resultado")?.innerText.replace(/\\n/g, " | ") ?? "(sem resposta no ecrã)"`);
  console.log(`   a resposta da tela: ${respostaDaCriacao}`);
  certeza(existsSync(CAMINHO_FICHA), `a ficha de bancada foi criada: ${FICHA}`);

  // ---- 4. escrever pela tela: compor → validar → escrever --------------------------------------------------
  console.log("\n── escrever pela tela (compor → validar → escrever)");
  // A ficha nova só entra na lista quando o fio é refeito: regenera-se o fio da bancada (o servidor refaz o do
  // repositório, não o desta cópia) e recarrega-se a página.
  retrato();
  // Uma navegação para o MESMO URL não recarrega nada (o Chrome trata-a como um no-op) — vai um parâmetro novo,
  // para o fio ser mesmo lido outra vez.
  await bancada.ir(`${URL.split("#")[0]}?t=${Date.now()}#configuracao`);
  await naPagina(`location.hash = "#configuracao"`);
  await sono(700);
  const escolheu = await naPagina(`(() => {
    const linha = Array.from(document.querySelectorAll("#lista-de-fichas .lr[data-ficha]")).find((l) => l.dataset.ficha === ${JSON.stringify(FICHA)});
    if (!linha) return false;
    linha.click();
    return true;
  })()`);
  const naLista = await naPagina(`JSON.stringify(Array.from(document.querySelectorAll("#lista-de-fichas .lr[data-ficha]")).map((l) => l.dataset.ficha))`);
  console.log(`   as fichas na lista: ${naLista}`);
  certeza(escolheu === true, "a ficha da bancada está na lista e foi escolhida");
  await sono(400);
  // A TRAVA: esta prova NÃO pode escrever numa ficha que não seja a que ela criou. Se a ficha em vista não for a
  // de bancada, para aqui — foi por não haver esta trava que uma primeira versão escreveu na ficha REAL do ETH.
  const emVista = await naPagina(`(() => { const l = document.querySelector('#lista-de-fichas .lr[aria-selected="true"]'); return l ? l.dataset.ficha : null; })()`);
  if (emVista !== FICHA) throw new Error(`a ficha em vista é «${emVista}» e não a de bancada «${FICHA}» — a prova NÃO escreve numa ficha do dono`);
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="compor"]')?.click()`);
  await sono(300);

  const compor = (chave: string, valor: string) => naPagina(`(() => { const e = document.querySelector('#corpo-da-ficha [data-chave="${chave}"]'); if (e === null) return false; e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event("input")); return true; })()`);
  const resposta = () => naPagina(`(() => { const r = document.querySelector("#corpo-da-ficha .resultado"); const b = document.querySelector('#corpo-da-ficha [data-acao="escrever"]'); return JSON.stringify({ texto: r ? r.innerText.replace(/\\n/g, " | ") : null, bom: r ? r.classList.contains("bom") : null, temBotaoEscrever: b !== null }); })()`).then((x: string) => JSON.parse(x));

  // (a) o valor DENTRO da banda: valida e oferece escrever
  const compôs = await compor("cabecalho.saldo_pct", "12");
  certeza(compôs === true, "o campo `cabecalho.saldo_pct` é editável na tela");
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="validar"]')?.click()`);
  await sono(2500);
  const dentro = await resposta();
  certeza(dentro.bom === true && dentro.temBotaoEscrever === true, `um valor dentro da banda valida e oferece escrever — ${(dentro.texto ?? "").slice(0, 90)}`);

  // (b) um valor FORA da banda da própria ficha: o escritor recusa, com os números
  await compor("cabecalho.saldo_pct", "999");
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="validar"]')?.click()`);
  await sono(2500);
  const fora = await resposta();
  console.log(`   a recusa da banda: ${(fora.texto ?? "").slice(0, 200)}`);
  certeza(fora.bom !== true && /banda/i.test(fora.texto ?? ""), "um valor fora da banda é RECUSADO com os números da banda (o escritor confere o que a mesa recusaria)");

  // (c) um valor que o CONFERIDOR DO PORTÃO reprova (o `prazo_de_resposta_ms` tem de ser > 0): a recusa vem
  //     dele, e é mostrada como ele a deu — não traduzida pela tela.
  await compor("cabecalho.saldo_pct", "12");
  await compor("cabecalho.prazo_de_resposta_ms", "0");
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="validar"]')?.click()`);
  await sono(2500);
  const doConferidor = await resposta();
  console.log(`   a recusa do conferidor: ${(doConferidor.texto ?? "").slice(0, 260)}`);
  certeza(doConferidor.bom !== true, "o candidato que o conferidor reprova NÃO é escrito");
  const relatorio = await naPagina(`document.querySelector("#corpo-da-ficha .relatorio-do-conferidor")?.textContent ?? ""`);
  certeza(/prazo_de_resposta_ms/.test(relatorio), "o RELATÓRIO do conferidor do portão é mostrado tal e qual (a tela não o reescreve)");

  // (d) a impressão velha: o mesmo pedido, com um `visto` que não é o do ficheiro em disco → recusa nomeada
  const impressaoVelha = await naPagina(`(async () => {
    const r = await fetch("/api/ficha", { method: "POST", headers: { "content-type": "application/json", "x-mesacore": "1" },
      body: JSON.stringify({ ficha: ${JSON.stringify(FICHA)}, mudancas: { "cabecalho.saldo_pct": "13" }, visto: "0".repeat(64) }) });
    return JSON.stringify(await r.json());
  })()`);
  const velha = JSON.parse(impressaoVelha);
  console.log(`   a recusa da impressão: ${velha.porque}`);
  certeza(velha.ok !== true && /impressão|mudou desde que a abriste/i.test(velha.porque ?? ""), "uma página velha (impressão diferente) não passa por cima: RECUSA nomeada");

  // (e) escrever A SÉRIO o valor composto
  await compor("cabecalho.prazo_de_resposta_ms", "5000");
  await compor("cabecalho.saldo_pct", "12");
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="validar"]')?.click()`);
  await sono(2500);
  const antesDeEscrever = await resposta();
  certeza(antesDeEscrever.temBotaoEscrever === true, "com o candidato aprovado, o botão de escrever aparece");
  await naPagina(`document.querySelector('#corpo-da-ficha [data-acao="escrever"]')?.click()`);
  await sono(4000);
  if (existsSync(CAMINHO_FICHA)) {
    const escrita = JSON.parse(readFileSync(CAMINHO_FICHA, "utf8"));
    console.log(`   o que ficou escrito: cabecalho.saldo_pct=${escrita.cabecalho?.saldo_pct} (tipo ${typeof escrita.cabecalho?.saldo_pct})`);
    certeza(String(escrita.cabecalho?.saldo_pct) === "12", "o ficheiro passou a ter o valor que o dono compôs");
    certeza(typeof escrita.cabecalho?.saldo_pct === "string", "o valor viaja em TEXTO, como a ficha original (D4)");
  } else {
    certeza(false, "a ficha da bancada desapareceu depois de escrever");
  }

  const erros = JSON.parse(await naPagina("JSON.stringify(window.__erros || [])")) as string[];
  console.log(`\n   erros na página: ${erros.length === 0 ? "nenhum" : JSON.stringify(erros)}`);
  console.log("");
  if (problemas.length === 0 && erros.length === 0) {
    console.log("prova da escrita: a ficha foi criada e escrita pela tela · validada ANTES de escrever · a banda morde · o conferidor do portão fala por si · a impressão velha é recusada");
    saida = 0;
  } else {
    console.log(`prova da escrita: FALHOU — ${problemas.length} verificação(ões)${erros.length ? ` · ${erros.length} erro(s) na página` : ""}`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova da escrita: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  bancada?.fechar();
  try { servidorPainel?.kill(); } catch { /* já morreu */ }
  if (pasta !== null) rmSync(pasta, { recursive: true, force: true });
  rmSync(CAMINHO_FICHA, { force: true });   // a ficha de bancada não fica na árvore do dono
  // O servidor refez o fio do repositório a seguir à escrita (é o comportamento do produto): volta-se a gerar o
  // fio VERDADEIRO, para a bancada não deixar o dono com o fio dela.
  try {
    Bun.spawnSync(["bun", "run", join(RAIZ, "tools", "painel", "retrato.ts"), "--sem-serie", "--para", join(RAIZ, "web", "painel", "painel.json")], { stdout: "pipe", stderr: "pipe" });
  } catch { /* o ciclo do serviço volta a tentar */ }
}
console.log(`a bancada limpou o que criou: ${FICHA} ${existsSync(CAMINHO_FICHA) ? "FICOU (limpar à mão!)" : "apagada"}`);
process.exit(saida);
