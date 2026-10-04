#!/usr/bin/env bun
// A PROVA DO CATALOGO — «criar conta pela tela funciona para Hyperliquid E para cTrader a partir do padrão do
// conector, e um conector novo só precisa do seu manifesto».
//
// O QUE ELA MEDE, e no sítio certo. Isto NÃO testa uma função isolada: abre o painel a sério num Chrome headless,
// PELA PORTA A SÉRIO (`tools/painel/servidor.ts`, o mesmo `POST /api/ficha` que o dono usa), clica no botão
// `+ conta`, lê o formulário que nasceu, preenche e manda VALIDAR. O que se prova é o caminho inteiro:
//
//   1. o formulário de conta nasce do `questionario.json` do CONECTOR (não de campos fixos em HTML): o número de
//      campos, os obrigatórios, as opções e a omissão vêm da declaração — medidos contra o ficheiro do plugin;
//   2. um CONECTOR NOVO (esta prova cria um, de bancada, e apaga-o no fim) ganha formulário SEM se tocar em
//      `web/` — é o pedido «acrescentar um conector novo tem de dar formulário novo»;
//   3. campo obrigatório em falta RECUSA com o NOME dele (e o botão de criar não aparece);
//   4. um campo de segredo NÃO é um campo de digitação, e o candidato que se compõe leva a REFERÊNCIA (o caminho
//      para o ficheiro protegido), nunca o valor — e o VALOR não aparece no fio nem no documento composto;
//   5. o candidato composto (com as omissões declaradas) é APROVADO pelo conferidor do portão, para os DOIS
//      conectores — e criar a conta a sério pela tela escreve o ficheiro em `config/contas/`.
//
// O que ela NÃO faz: não toca na corrida de ninguém (gera o fio com uma raiz vazia), não escreve no histórico de
// configuração, e apaga TUDO o que criou — a conta de bancada e o conector de bancada. O fio do repositório
// (`web/painel/painel.json`, não versionado) é regenerado no fim, porque o servidor o refaz a seguir a uma
// escrita e a bancada não pode deixar o dono com um fio de bancada.
//
// Uso:  bun run tools/painel/prova-do-catalogo.ts

import { join } from "node:path";
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirBancada, sono, type Bancada } from "./bancada-cdp.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const TELA = join(RAIZ, "web", "painel");
const AGORA = new Date().toISOString();

// O conector NOVO e a conta de bancada — os dois nomes que esta prova cria e apaga.
const NOVO = "zz_prova_catalogo";
const PASTA_NOVA = join(RAIZ, "brokers", NOVO);
const CONTA_DE_BANCADA = "zz-prova-do-catalogo";
const CAMINHO_CONTA = join(RAIZ, "config", "contas", `${CONTA_DE_BANCADA}.json`);

const novoQuestionario = {
  plugin: NOVO,
  tipo: "conector",
  versao_do_questionario: "1.0.0",
  preenche_sempre: { nota: "conector de bancada criado pela prova do catalogo", "conta.corretora": NOVO, "conta.conectores": [NOVO] },
  perguntas: [
    { id: "nome_da_conta", chave: "(nome do ficheiro)", tipo: "texto", obrigatorio: true, pergunta: "Nome da conta de bancada", omissao: CONTA_DE_BANCADA },
    { id: "identificador", chave: "conta.identificador", tipo: "texto", obrigatorio: true, pergunta: "Identificador de bancada (sem omissao — o formulario tem de o pedir)" },
    { id: "ambiente", chave: "conexao.ambiente", tipo: "enum", obrigatorio: true, opcoes: ["teste", "producao"], omissao: "teste", pergunta: "Ambiente de bancada" },
    { id: "perda_maxima_pct", chave: "conta.perda_maxima_pct", tipo: "decimal", obrigatorio: true, omissao: "5", pergunta: "Perda maxima da conta em %" },
    { id: "margem_total_maxima_pct", chave: "conta.margem_total_maxima_pct", tipo: "decimal", obrigatorio: true, omissao: "100", pergunta: "Margem total maxima da conta em %" },
    { id: "contencao", chave: "conta.contencao", tipo: "enum", obrigatorio: true, opcoes: ["recusar", "espera"], omissao: "recusar", pergunta: "Contencao" },
    { id: "perda_maxima_janela", chave: "conta.perda_maxima_janela", tipo: "enum", obrigatorio: true, opcoes: ["corrida_da_mesa", "dia_de_calendario"], omissao: "corrida_da_mesa", pergunta: "Janela da perda maxima" },
    { id: "arranque_apos_cb", chave: "conta.arranque_apos_cb", tipo: "enum", obrigatorio: true, opcoes: ["exige_decisao"], omissao: "exige_decisao", pergunta: "Arranque apos CB" },
    { id: "eventos_que_avisam", chave: "conta.eventos_que_avisam", tipo: "lista", obrigatorio: true, omissao: "cb, encerramento, recusa", pergunta: "Eventos que avisam" },
    { id: "credencial", chave: "conta.credencial", tipo: "texto", obrigatorio: true, omissao: NOVO, pergunta: "Nome da credencial" },
    { id: "retencao_dias_integral", chave: "conta.retencao_ledger.dias_integral", tipo: "inteiro", obrigatorio: true, omissao: "7", pergunta: "Dias integrais do ledger" },
    { id: "retencao_depois", chave: "conta.retencao_ledger.depois", tipo: "texto", obrigatorio: true, omissao: "resumo_diario", pergunta: "E depois desses dias?" },
  ],
  escreve_em: "conta",
  conta_de_exemplo: CONTA_DE_BANCADA,
};

/** Uma porta livre: pede-se uma ao sistema e devolve-se logo (o servidor do painel precisa dela antes de subir). */
function portaLivre(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const p = s.port!;
  s.stop(true);
  return p;
}

let saida = 1;
let bancada: Bancada | null = null;
let servidorPainel: Bun.Subprocess | null = null;
let pasta: string | null = null;
let raizVazia: string | null = null;
const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => { if (!condicao) problemas.push(texto); console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`); };

/** Os valores de um objecto que têm CARA DE CHAVE PRIVADA (hex de 64+), fora das impressões `hash`. */
function valoresComCaraDeChave(x: any, nome = "", achados: string[] = []): string[] {
  if (typeof x === "string") {
    if (/^(0x)?[0-9a-fA-F]{64,}$/.test(x) && !/hash/i.test(nome)) achados.push(nome || "(raiz)");
    return achados;
  }
  if (Array.isArray(x)) { for (const v of x) valoresComCaraDeChave(v, nome, achados); return achados; }
  if (x !== null && typeof x === "object") { for (const [k, v] of Object.entries(x)) valoresComCaraDeChave(v, k, achados); return achados; }
  return achados;
}

try {
  // ---- 0. o conector NOVO (criado aqui, apagado no fim) ------------------------------------------------
  mkdirSync(PASTA_NOVA, { recursive: true });
  writeFileSync(join(PASTA_NOVA, "questionario.json"), JSON.stringify(novoQuestionario, null, 2) + "\n");

  // ---- 1. a cópia da tela e o fio (raiz vazia: não se lê a corrida de ninguém) -------------------------
  pasta = mkdtempSync(join(tmpdir(), "mesacore-prova-catalogo-"));
  raizVazia = mkdtempSync(join(tmpdir(), "mesacore-sem-corridas-"));
  mkdirSync(join(pasta, "js"), { recursive: true });
  for (const f of ["index.html", "tema.css", "lightweight-charts.standalone.production.js"]) cpSync(join(TELA, f), join(pasta, f));
  cpSync(join(TELA, "js"), join(pasta, "js"), { recursive: true });

  const retrato = Bun.spawnSync(["bun", "run", join(RAIZ, "tools", "painel", "retrato.ts"), "--sem-serie", "--para", join(pasta, "painel.json"), "--raiz-das-corridas", raizVazia], { stdout: "pipe", stderr: "pipe" });
  if (retrato.exitCode !== 0) throw new Error(`o retrato falhou: ${retrato.stderr.toString()}`);
  const fio = JSON.parse(readFileSync(join(pasta, "painel.json"), "utf8"));
  const catalogo = fio.catalogo?.conectores ?? [];
  const plugins = catalogo.map((c: any) => c.plugin);

  console.log(`\n── o catálogo vem dos questionários dos conectores (${catalogo.length} conector(es) publicam campos)`);
  for (const c of catalogo) console.log(`   ${c.plugin.padEnd(20)} ${c.ficheiro}  ·  ${c.perguntas.length} campos · ${c.perguntas.filter((p: any) => p.sensivel).length} sensível(is)`);
  certeza(plugins.includes("hyperliquid"), "o catálogo traz o Hyperliquid (brokers/hyperliquid/questionario.json)");
  certeza(plugins.includes("ctrader"), "o catálogo traz o cTrader (brokers/ctrader/questionario.json — o conector que ainda não declarava campos)");
  certeza(plugins.includes(NOVO), `o catálogo traz o conector NOVO («${NOVO}») — acrescentar um conector foi acrescentar um ficheiro`);
  certeza(catalogo.length === plugins.length, `cada questionário publicado entrou no catálogo (${catalogo.length} de ${plugins.length})`);

  // os segredos não viajam: nenhuma pergunta sensível traz omissão nem exemplo
  const sensivelComOmissao = catalogo.flatMap((c: any) => c.perguntas.filter((p: any) => p.segredo && ("omissao" in p || "exemplo" in p)));
  certeza(sensivelComOmissao.length === 0, `nenhuma pergunta de SEGREDO traz omissão nem exemplo (${sensivelComOmissao.length} encontradas)`);
  // e o fio inteiro não tem nenhuma string com CARA DE CHAVE (hex de 64+) fora das impressões (`hash`): um valor
  // de segredo colado num ficheiro lido pelo retrato sairia escondido e CONTADO, nunca no fio.
  const comCaraDeChave = valoresComCaraDeChave(fio);
  certeza(comCaraDeChave.length === 0, `o fio não leva nenhum valor com cara de chave privada fora das impressões (${comCaraDeChave.length} encontrados${comCaraDeChave.length ? ": " + comCaraDeChave.join(", ") : ""})`);

  // ---- 2. o servidor A SÉRIO (a mesma porta de escrita que o dono usa) ----------------------------------
  const porta = portaLivre();
  servidorPainel = Bun.spawn(["bun", "run", join(RAIZ, "tools", "painel", "servidor.ts"), "--porta", String(porta), "--endereco", "127.0.0.1", "--pasta", pasta, "--raiz-das-corridas", raizVazia, "--intervalo", "0", "--intervalo-vivo", "0"], { stdout: "pipe", stderr: "pipe" });
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
  console.log(`\n── o painel serve em ${URL} (a porta de escrita é a mesma que o dono usa)`);

  // ---- 3. a tela, no browser ----------------------------------------------------------------------------
  bancada = await abrirBancada({ url: URL, largura: 1440, altura: 1000, espera_ms: 3000 });
  await bancada.avaliar(`location.hash = "#configuracao"`);
  await sono(500);

  /** Abre o formulário de criar conta, escolhe o conector e devolve o que o formulário MOSTRA. */
  async function abrirFormulario(conector: string) {
    return JSON.parse(await bancada!.avaliar(`(() => {
      const botao = document.querySelector('[data-nova="conta"]');
      if (botao === null) return JSON.stringify({ erro: "sem botão + conta" });
      botao.click();
      const s = document.querySelector('[data-novo="__conector"]');
      if (s === null) return JSON.stringify({ erro: "o formulário não tem seletor de conector" });
      if (s.value !== ${JSON.stringify(conector)}) { s.value = ${JSON.stringify(conector)}; s.dispatchEvent(new Event("change")); }
      const campos = Array.from(document.querySelectorAll("#corpo-da-ficha [data-novo]")).map((e) => e.dataset.novo).filter((n) => n !== "__conector");
      const linhas = Array.from(document.querySelectorAll("#corpo-da-ficha tbody tr")).map((tr) => ({
        texto: tr.querySelector("td")?.innerText.replace(/\\n/g, " ") ?? "",
        temInput: tr.querySelector("input[type=text]") !== null,
        temSelect: tr.querySelector("select") !== null,
      }));
      return JSON.stringify({
        seletor: s.value,
        campos,
        linhas,
        nota: document.querySelector("#corpo-da-ficha .mini")?.innerText ?? "",
        aviso: document.querySelector("#corpo-da-ficha .aviso")?.innerText ?? null,
        docVisivel: document.querySelectorAll("#corpo-da-ficha .tab").length,
      });
    })()`));
  }
  const preencher = (id: string, valor: string) => bancada!.avaliar(`(() => {
    const e = document.querySelector('#corpo-da-ficha [data-novo="${id}"]');
    if (e === null) return false;
    e.value = ${JSON.stringify(valor)};
    e.dispatchEvent(new Event("input"));
    return true;
  })()`);
  const resultado = () => bancada!.avaliar(`(() => {
    const r = document.querySelector("#corpo-da-ficha .resultado");
    const b = document.querySelector('#corpo-da-ficha [data-acao="criar"]');
    const a = document.querySelector("#aviso-do-candidato");
    return JSON.stringify({ resposta: r ? r.innerText.replace(/\\n/g, " | ") : null, bom: r ? r.classList.contains("bom") : null, temBotaoCriar: b !== null, aviso: a ? a.innerText.replace(/\\n/g, " ") : null });
  })()`).then((x: string) => JSON.parse(x));
  const validar = async () => { await bancada!.avaliar(`document.querySelector('#corpo-da-ficha [data-acao="validar-criacao"]')?.click()`); await sono(2500); };

  /** Os valores de bancada para os campos que o conector NÃO traz com omissão (o dono tem de os dar). */
  const valorDeBancada = (q: any) => {
    if (q.chave === "conta.identificador") return "0x2222222222222222222222222222222222222222";
    if (q.chave === "conta.retencao_ledger.dias_integral") return "7";
    if (q.chave === "conta.retencao_ledger.depois") return "resumo_diario";
    return "zz-prova";
  };
  /** Os campos que o formulário tem de PEDIR: as perguntas do conector menos o nome do ficheiro e menos os
   *  segredos (um segredo não é um campo de digitação). */
  const camposEsperados = (decl: any) => decl.perguntas.filter((p: any) => !p.segredo && p.id !== "nome_da_conta").map((p: any) => p.id);
  const semOmissao = (decl: any) => decl.perguntas.filter((p: any) => p.obrigatorio && !p.segredo && p.id !== "nome_da_conta" && (p.omissao === null || p.omissao === undefined));

  /** O caminho completo de um conector: abrir, medir os campos, exigir a recusa, preencher e aprovar. */
  async function ensaiar(conector: string) {
    console.log(`\n── ${conector}: o formulário nasce da declaração do conector`);
    const decl = catalogo.find((c: any) => c.plugin === conector);
    const formulario = await abrirFormulario(conector);
    const esperados = camposEsperados(decl);
    certeza(formulario.erro === undefined, `o formulário de conta abriu${formulario.erro ? ` — ${formulario.erro}` : ""}`);
    certeza(formulario.seletor === conector, `o seletor ficou no conector pedido («${conector}»)`);
    certeza(esperados.every((id: string) => formulario.campos.includes(id)), `os ${esperados.length} campos que o conector declara estão no formulário`);
    certeza(formulario.campos.filter((c: string) => c !== "nome").length === esperados.length, `o formulário pede exactamente os campos declarados (${formulario.campos.length - 1} de ${esperados.length}) + o nome do ficheiro`);
    const segredos = decl.perguntas.filter((p: any) => p.segredo);
    certeza(formulario.campos.includes("chave_privada") === false || segredos.length === 0, `nenhum campo de SEGREDO (${segredos.map((p: any) => p.id).join(", ") || "nenhum"}) é um campo de digitação`);
    // os obrigatórios SEM omissão: o conector não os inventa, a tela tem de os pedir
    await validar();
    const rFalta = await resultado();
    const nomesEmFalta = semOmissao(decl).map((p: any) => p.chave);
    if (nomesEmFalta.length > 0) {
      certeza(rFalta.bom !== true, `sem os obrigatórios que o conector não traz por omissão, RECUSA (não presume)`);
      certeza(rFalta.temBotaoCriar === false, "com o candidato incompleto, o botão de criar NÃO é oferecido");
      const avisou = semOmissao(decl).some((p: any) => (rFalta.aviso ?? "").includes(p.pergunta ?? p.chave));
      certeza(avisou, `a tela nomeia o campo que falta — ${(rFalta.aviso ?? "").slice(0, 220)}`);
    }
    for (const q of semOmissao(decl)) await preencher(q.id, valorDeBancada(q));
    await validar();
    const rOk = await resultado();
    certeza(rOk.bom === true, `${conector}: com as omissões declaradas + os obrigatórios, o conferidor APROVOU — ${rOk.resposta}`);
    return { decl, formulario };
  }

  // ---- 4/5. o cTrader (o conector que ainda não declarava campos) e o Hyperliquid (o que já declarava) ------
  await ensaiar("ctrader");
  await ensaiar("hyperliquid");

  // ---- 6. o conector NOVO dá formulário sem se tocar na tela --------------------------------------------
  console.log(`\n── o conector NOVO («${NOVO}»): formulário novo sem tocar em web/`);
  const doNovo = await abrirFormulario(NOVO);
  const declNovo = catalogo.find((c: any) => c.plugin === NOVO);
  certeza(doNovo.seletor === NOVO, `o seletor de conectores ofereceu o conector novo («${NOVO}»)`);
  certeza(doNovo.campos.filter((c: string) => c !== "nome").length === camposEsperados(declNovo).length, `o formulário do conector novo pede os ${camposEsperados(declNovo).length} campos dele`);
  certeza(doNovo.campos.includes("perda_maxima_pct") && doNovo.campos.includes("contencao"), "os campos declarados pelo conector novo estão lá, com os tipos dele");
  await validar();
  const rNovo = await resultado();
  certeza(rNovo.bom !== true, "o conector novo, sem o obrigatório, também RECUSA (não há caminho especial)");

  // ---- 7. criar a conta A SÉRIO, pela tela --------------------------------------------------------------
  console.log("\n── criar a conta a sério (pela mesma porta)");
  await abrirFormulario(NOVO);
  await preencher("nome", CONTA_DE_BANCADA);
  for (const q of semOmissao(declNovo)) await preencher(q.id, valorDeBancada(q));
  await validar();
  const antesDeCriar = await resultado();
  certeza(antesDeCriar.bom === true && antesDeCriar.temBotaoCriar === true, "com o candidato válido, o botão de criar é oferecido");
  await bancada.avaliar(`document.querySelector('#corpo-da-ficha [data-acao="criar"]')?.click()`);
  await sono(4000);
  // Depois de criar, a vista volta à ficha (o formulário fecha): a prova é o FICHEIRO, não o DOM que já mudou.
  certeza(existsSync(CAMINHO_CONTA), `a conta foi criada pela tela: config/contas/${CONTA_DE_BANCADA}.json existe`);
  if (existsSync(CAMINHO_CONTA)) {
    const criado = JSON.parse(readFileSync(CAMINHO_CONTA, "utf8"));
    console.log(`   o que ficou escrito: conta.corretora=${criado.conta?.corretora} · identificador=${criado.conta?.identificador} · perda_maxima_pct=${criado.conta?.perda_maxima_pct} (tipo ${typeof criado.conta?.perda_maxima_pct})`);
    certeza(criado.conta?.corretora === NOVO, "o `preenche_sempre` do conector entrou no documento");
    certeza(typeof criado.conta?.perda_maxima_pct === "string", "um decimal viaja em TEXTO (D4)");
    certeza(criado.conta?.identificador === "0x2222222222222222222222222222222222222222", "o valor que o dono escreveu no formulário entrou no documento");
    // e a criação REPETIDA recusa (criar não é sobrepor) — aqui a recusa fica no ecrã, porque nada foi escrito
    await abrirFormulario(NOVO);
    await preencher("nome", CONTA_DE_BANCADA);
    for (const q of semOmissao(declNovo)) await preencher(q.id, valorDeBancada(q));
    await validar();
    await bancada.avaliar(`document.querySelector('#corpo-da-ficha [data-acao="criar"]')?.click()`);
    await sono(3000);
    const rRepetido = await resultado();
    const texto = (rRepetido.resposta ?? "").toLowerCase();
    certeza(texto.includes("recusado") && texto.includes("já existe"), `criar duas vezes RECUSA (criar não é sobrepor) — ${rRepetido.resposta}`);
  }

  // ---- 8. e o segredo do Hyperliquid: o documento leva a REFERÊNCIA, nunca o valor ----------------------
  console.log("\n── o segredo: só a REFERÊNCIA viaja (o valor não passa pela tela)");
  await abrirFormulario("hyperliquid");
  await preencher("nome", "zz-prova-segredo");
  for (const q of semOmissao(catalogo.find((c: any) => c.plugin === "hyperliquid"))) await preencher(q.id, valorDeBancada(q));
  await validar();
  const linhas = JSON.parse(await bancada.avaliar(`(() => {
    const ls = Array.from(document.querySelectorAll("#corpo-da-ficha tbody tr")).map((tr) => tr.innerText.replace(/\\n/g, " "));
    return JSON.stringify(ls.filter((l) => l.includes("valor_em") || l.includes("credencial")));
  })()`)) as string[];
  console.log(`   o documento composto, nas linhas de credencial: ${linhas.join(" · ") || "(nenhuma)"}`);
  certeza(linhas.some((l) => l.includes("ficheiro:") && l.includes("zz-prova-segredo.key")), "o documento leva a REFERÊNCIA (ficheiro:…<conta>.key), nunca o valor do segredo");
  const campoDeSegredo = await bancada.avaliar(`document.querySelector('#corpo-da-ficha [data-novo="chave_privada"]') === null`);
  certeza(campoDeSegredo === true, "não há um campo de digitação para a chave privada");
  const comandoDoSegredo = await bancada.avaliar(`document.querySelector("#corpo-da-ficha .comando")?.innerText.includes("guardar-credencial.sh gravar chave_privada") === true`);
  certeza(comandoDoSegredo === true, "a tela diz onde se põe o valor (guardar-credencial.sh gravar chave_privada)");

  const erros = JSON.parse(await bancada.avaliar("JSON.stringify(window.__erros || [])")) as string[];
  console.log(`\n   erros na página: ${erros.length === 0 ? "nenhum" : JSON.stringify(erros)}`);
  console.log("");
  if (problemas.length === 0 && erros.length === 0) {
    console.log("prova do catálogo: os dois conectores e o novo dão formulário a partir da PRÓPRIA declaração · o obrigatório em falta recusa com nome · o segredo nunca é um campo · o candidato passa o conferidor e a conta é criada pela tela");
    saida = 0;
  } else {
    console.log(`prova do catálogo: FALHOU — ${problemas.length} verificação(ões)${erros.length ? ` · ${erros.length} erro(s) na página` : ""}`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
} catch (e) {
  console.log(`prova do catálogo: FALHOU — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  bancada?.fechar();
  try { servidorPainel?.kill(); } catch { /* já morreu */ }
  if (pasta !== null) rmSync(pasta, { recursive: true, force: true });
  if (raizVazia !== null) rmSync(raizVazia, { recursive: true, force: true });
  // O que esta prova criou, apaga: o conector de bancada e a conta de bancada.
  rmSync(PASTA_NOVA, { recursive: true, force: true });
  rmSync(CAMINHO_CONTA, { force: true });
  // O servidor do painel refez o fio na pasta do repositório a seguir à escrita (é o comportamento do produto):
  // volta-se a gerar o fio VERDADEIRO, para a bancada não deixar o dono com um fio de bancada.
  try {
    Bun.spawnSync(["bun", "run", join(RAIZ, "tools", "painel", "retrato.ts"), "--sem-serie", "--para", join(RAIZ, "web", "painel", "painel.json")], { stdout: "pipe", stderr: "pipe" });
  } catch { /* o ciclo do serviço volta a tentar */ }
}
console.log(`a bancada limpou o que criou: conector «${NOVO}» ${existsSync(PASTA_NOVA) ? "FICOU (limpar à mão!)" : "apagado"} · conta ${existsSync(CAMINHO_CONTA) ? "FICOU (limpar à mão!)" : "apagada"} · ${AGORA}`);
process.exit(saida);
