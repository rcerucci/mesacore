// A BANCADA DO VIGIA (recorte 003). Este ficheiro responde aos modos da porta `vigia.sh`.
//
// `--arranque` (US1, T024): o vigia a governar a mesa, com as sete portas, uma de cada vez.
//
//   - prova-se a SEQUENCIA inteira: o comando entra no vigia, o vigia arranca a mesa como processo filho,
//     corre as portas, e a resposta que sai e a resposta QUE A MESA DEU;
//   - prova-se o que a T021 pede: quando as portas recusam, o **nome daquela porta** fica no registro do
//     vigia (`porta`), com o que se chegou a conferir - o motivo generico nao chega a ninguem;
//   - NAO se prova o comportamento da mesa (tem as bancadas dela) nem as portas (tem a bateria do
//     arranque): mede-se a fronteira entre os dois e o que o vigia acrescenta.
//
// As mutacoes NAO se inventam aqui: leem-se de `core/ciclo/arranque.casos.json`, onde ja esta declarada
// uma por porta. Duas baterias a declarar as mesmas mutacoes divergiriam, e a que ficasse por actualizar
// seria a que mente.
//
// Nada aqui toca numa corretora e nada pede chave: o conector e duble (RN-E24).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";
import { validar } from "../../contracts/esqueleto/framing.ts";
import { fundir } from "./fundir.ts";

const MODO = process.argv[2] ?? "";
if (MODO !== "--arranque" && MODO !== "--orfandade") {
  const tarefa = MODO === "--encerramento" ? "T038" : MODO === "--verbos" ? "T044" : "(desconhecido)";
  console.log(`${MODO}: NAO IMPLEMENTADO (tarefa ${tarefa})`);
  process.exit(2);
}

const VERSAO = "1.1.0";
const comando = (id: string, carga: Record<string, unknown>) =>
  JSON.stringify({ contrato: VERSAO, tipo: "comando", id, carga });

const declarado = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core/ciclo/arranque.casos.json"), "utf8"));
const manifestoDoFixture = JSON.parse(readFileSync(join(RAIZ_DO_REPO, declarado.manifesto_fixture), "utf8"));

const dir = mkdtempSync(join(tmpdir(), "vigia-"));
let verificacoes = 0;
let divergentes = 0;
const falhas: string[] = [];
function conferir(nome: string, ok: boolean, detalhe = "") {
  verificacoes++;
  if (!ok) {
    divergentes++;
    falhas.push(`${nome}${detalhe ? " :: " + detalhe : ""}`);
  }
}

// A ORFANDADE corre AQUI, e nao no topo: ela usa as definicoes partilhadas acima (`conferir`, `declarado`,
// `manifestoDoFixture`), e chama-las antes de existirem seria ler `const` em zona morta.
if (MODO === "--orfandade") await bancadaDaOrfandade();

/** Escreve os tres ficheiros que o vigia le, a partir do padrao do arranque + a mudanca do caso. */
function preparar(mudanca: Record<string, unknown>) {
  const config = fundir(declarado.padrao.config, mudanca.config_mudanca);
  const marcas = fundir(declarado.padrao.marcas, mudanca.marcas_mudanca);
  // A mudanca entra na CARGA do manifesto, e nao no envelope: a versao que a porta confere e a que a ponta
  // DECLARA (carga.versao). Aplicada ao envelope, a mutacao caia num sitio que ninguem le - e o caso
  // passava a aceitar um arranque que devia recusar.
  const mensagem = JSON.parse(JSON.stringify(manifestoDoFixture));
  mensagem.carga = fundir(manifestoDoFixture.carga, mudanca.manifesto_mudanca);
  if (mudanca.manifesto_instrumentos !== undefined) mensagem.carga.instrumentos = mudanca.manifesto_instrumentos;
  for (const campo of (mudanca.manifesto_remover as string[] | undefined) ?? []) delete mensagem.carga[campo];

  const caminhos = {
    config: join(dir, "config.json"),
    manifesto: join(dir, "manifesto.json"),
    marcas: join(dir, "marcas.json"),
    registo: join(dir, "vigia.json"),
    portas: join(dir, "arranque.json"),
    // O LEDGER tem de ser da bancada. Com o valor por omissao, o vigia lia (e a mesa escrevia) o ledger do
    // REPOSITORIO - estado de runtime que nao e desta corrida. E como o vigia passou a LER o ledger no
    // regresso (T029), um ledger sujo decidia a bancada inteira: todas as respostas vinham
    // `mesa_ja_em_operacao`. Medido antes de corrigir: 35 divergencias.
    ledger: join(dir, "ledger.jsonl"),
  };
  writeFileSync(caminhos.config, JSON.stringify(config));
  writeFileSync(caminhos.manifesto, JSON.stringify(mensagem));
  writeFileSync(caminhos.marcas, JSON.stringify(marcas));
  rmSync(caminhos.registo, { force: true });
  rmSync(caminhos.portas, { force: true });
  rmSync(caminhos.ledger, { force: true });
  return caminhos;
}

/**
 * Corre o VIGIA como processo e conduz-lo: escreve as linhas, espera as respostas, e MORTA-o.
 *
 * Nao se usa `spawnSync` de proposito - e a licao que a primeira corrida deu: o vigia e um processo LONGO
 * por natureza (segura a mesa e os conectores), e quem decide quando ele acaba e a bancada. Com `spawnSync`
 * a bancada ficava a espera de um processo que so acaba quando a operacao acaba.
 */
async function correrVigia(linhas: string[], mudanca: Record<string, unknown> = {}) {
  const c = preparar(mudanca);
  const args = [
    "run", join(RAIZ_DO_REPO, "vigia", "vigia.ts"),
    "--config", c.config, "--manifesto", c.manifesto,
    "--marcas", c.marcas, "--registo", c.registo, "--portas", c.portas, "--ledger", c.ledger,
  ];
  if (mudanca.inventario_mudanca !== undefined) args.push("--inventario", "falso");
  if (mudanca.registo_retomavel !== undefined) args.push("--registo-retomavel", String(mudanca.registo_retomavel));

  const proc = spawn("bun", args, { stdio: ["pipe", "pipe", "pipe"] });
  let bruto = "";
  proc.stdout.setEncoding("utf8");
  const respostas = () => bruto.split("\n").filter((l) => l.trim() !== "");
  const chegou = new Promise<void>((resolver) => {
    const limite = setTimeout(resolver, 30000); // 30s: o arranque corre as sete portas (o inventario leva ~1s)
    proc.stdout.on("data", (p: string) => {
      bruto += p;
      if (respostas().length >= linhas.length) { clearTimeout(limite); resolver(); }
    });
  });
  proc.stdin.write(linhas.join("\n") + "\n");
  await chegou;
  const saida = respostas();

  // O vigia nao sai sozinho quando tem operacao nas maos: quem o termina e esta bancada. E leva consigo o
  // que levantou - os pids que ele proprio registou.
  proc.kill("SIGKILL");
  let registro: any = { transicoes: [], leituras: [], processos: [] };
  try { registro = JSON.parse(readFileSync(c.registo, "utf8")); } catch { /* ausente: as provas reprovam */ }
  for (const p of registro.processos ?? []) {
    if (typeof p.pid === "number") { try { process.kill(p.pid, "SIGKILL"); } catch { /* ja morreu */ } }
  }
  return { saida, registro };
}

// As sete portas, pelos casos que ja as declaram (um caso por porta).
const PORTAS = ["conectores", "manifesto", "mandato", "contenda", "inventario", "versao_do_contrato", "sessao"] as const;
const casoDaPorta = (porta: string) => declarado.casos.find((c: any) => c.porta_esperada === porta);

if (MODO === "--arranque") console.log("=== bancada do vigia: as sete portas, uma de cada vez, e o que ele acrescenta\n");

/* ------------------------------------------------------------------ A ORFANDADE (US2, T031)

O que se mede aqui, e por que e esta a medida que prova a fronteira:

  - com o vigia MORTO, a mesa continua a operar: N voltas do RELOGIO dela tem de dar N linhas novas no
    registo (SC-001). A contagem nao se adivinha pelo tempo: le-se o numero da volta que a propria mesa
    escreveu na linha (`nota: "ciclo N"`) e compara-se com o numero de linhas. Se uma volta se perder, os
    dois numeros discordam - e e essa discordancia que a bancada procura;
  - o vigia que volta LE o estado da mesa no ledger dela e NAO arranca nada (T029): uma leitura com
    `em_operacao`, ZERO transicoes novas, e a resposta `mesa_ja_em_operacao` a um `start`;
  - o que NAO se prova: que o conector esta ligado. O duble de conector e um processo de uma boleta so, e a
    ligacao a serio e o recorte do plugin (declarado).

A operacao e a configuracao NAO se inventam: a leitura vem do caso declarado em `core/ciclo/ciclo.casos.json`
(o primeiro caso) e o mandato vem da configuracao do arranque. Assim a decisao que o relogio toma e
conferida contra a que a bateria do ciclo ja declara para a mesma leitura.
*/
async function bancadaDaOrfandade() {
  console.log("=== bancada da orfandade: a mesa contra a morte do vigia (SC-001, T028, T029)\n");

  const declaradoDoCiclo = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core/ciclo/ciclo.casos.json"), "utf8"));
  const casoDoCiclo = declaradoDoCiclo.casos[0];
  const config = declarado.padrao.config;
  const dir2 = mkdtempSync(join(tmpdir(), "vigia-orfandade-"));
  const caminhos = {
    config: join(dir2, "config.json"),
    manifesto: join(dir2, "manifesto.json"),
    operacao: join(dir2, "operacao.json"),
    marcas: join(dir2, "marcas.json"),
    registo: join(dir2, "vigia.json"),
    portas: join(dir2, "arranque.json"),
    ledger: join(dir2, "ledger.jsonl"),
  };
  const instrumento = "EURUSD";
  const operacao = {
    nota: "duble de operacao: a leitura do caso declarado, e o que o setup propoe",
    ligacao: "ligada",
    instrumentos: {
      [instrumento]: {
        leitura: casoDoCiclo.leitura,
        proposta: { setup: declaradoDoCiclo.padrao.proposta_setup, ...casoDoCiclo.proposta },
        ficha: casoDoCiclo.ficha ?? declaradoDoCiclo.padrao.ficha,
        template: casoDoCiclo.template ?? declaradoDoCiclo.padrao.template,
        marcas_nossas_conhecidas: casoDoCiclo.marcas_nossas_conhecidas ?? declaradoDoCiclo.padrao.marcas_nossas_conhecidas,
      },
    },
  };
  writeFileSync(caminhos.config, JSON.stringify(config));
  writeFileSync(caminhos.manifesto, JSON.stringify(manifestoDoFixture));
  writeFileSync(caminhos.operacao, JSON.stringify(operacao));

  const argsDoVigia = [
    "run", join(RAIZ_DO_REPO, "vigia", "vigia.ts"),
    "--config", caminhos.config, "--manifesto", caminhos.manifesto,
    "--marcas", caminhos.marcas, "--registo", caminhos.registo, "--portas", caminhos.portas,
    "--ledger", caminhos.ledger, "--tick", "120", "--operacao", caminhos.operacao,
  ];

  const lerLinhas = (caminho: string) => {
    try {
      return readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    } catch { return []; }
  };
  const voltas = (linhas: any[]) => linhas.filter((l) => l.tipo === "ciclo");
  const numeroDaVolta = (l: any): number | null => {
    const m = /ciclo (\d+)/.exec(l?.nota ?? "");
    return m ? Number(m[1]) : null;
  };

  // 1. O VIGIA #1 arranca a mesa com relogio e fica vivo (o `stdin` fica aberto de proposito).
  // A LIMPEZA E DO `finally`, e nao da ultima linha: uma bancada que rebenta a meio nao pode deixar uma
  // mesa a operar na maquina (medido: a primeira corrida, com um erro de escrita meu, deixou uma).
  const paraMatar: number[] = [];
  process.on("exit", () => {
    for (const pid of paraMatar) {
      try { process.kill(pid, "SIGKILL"); } catch { /* ja morreu */ }
    }
  });

  const vigia1 = spawn("bun", argsDoVigia, { stdio: ["pipe", "pipe", "pipe"] });
  let respostaDoStart = "";
  vigia1.stdout.setEncoding("utf8");
  vigia1.stdout.on("data", (p: string) => { respostaDoStart += p; });
  vigia1.stdin.write(comando("o-1", { verbo: "start", autor: "dono", pedido_id: "o-1" }) + "\n");

  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await espera(2600); // deixa arrancar (as portas levam ~1s) e correr algumas voltas

  const cargaDoStart = JSON.parse(respostaDoStart.trim().split("\n")[0] ?? "{}")?.carga ?? {};
  conferir("orfandade: o `start` foi aceite com o vigia vivo", cargaDoStart.aceito === true,
    `aceito=${cargaDoStart.aceito} motivo=${cargaDoStart.motivo}`);

  const registo1 = JSON.parse(readFileSync(caminhos.registo, "utf8"));
  const pidDaMesa = registo1.processos?.find((p: any) => p.papel === "mesa")?.pid;
  const pidsDosConectores = (registo1.processos ?? []).filter((p: any) => p.papel === "conector").map((p: any) => p.pid);
  for (const pid of [pidDaMesa, ...pidsDosConectores]) if (typeof pid === "number") paraMatar.push(pid);
  conferir("orfandade: o vigia registou quem levantou (a mesa e o conector)",
    typeof pidDaMesa === "number" && pidsDosConectores.length === 1,
    `mesa=${pidDaMesa} conectores=${JSON.stringify(pidsDosConectores)}`);

  const antes = voltas(lerLinhas(caminhos.ledger));
  conferir("orfandade: a mesa ja ciclava com o vigia vivo", antes.length >= 2, `voltas antes da morte: ${antes.length}`);

  // 2. MATA-SE O VIGIA (SIGKILL: nao ha despedida, nao ha limpeza - e o pior caso, que e o que se quer).
  vigia1.kill("SIGKILL");
  await espera(1200); // a mesa tem de continuar sozinha durante este tempo

  const depois = voltas(lerLinhas(caminhos.ledger));
  const novas = depois.slice(antes.length);
  conferir("orfandade: a mesa continuou a ciclar depois da morte do vigia (FR-006)",
    novas.length >= 2, `voltas novas: ${novas.length}`);

  // 3. SC-001: N voltas = N linhas. O numero da volta e o que a propria mesa escreveu; a contagem e do
  //    ficheiro. Se uma volta se perder, os dois numeros discordam.
  const primeira = numeroDaVolta(novas[0]);
  const ultima = numeroDaVolta(novas[novas.length - 1]);
  const voltasContadas = primeira !== null && ultima !== null ? ultima - primeira + 1 : -1;
  conferir("orfandade/SC-001: as voltas contadas pela mesa sao as linhas escritas",
    voltasContadas === novas.length, `voltas=${voltasContadas} linhas novas=${novas.length}`);

  const semMotivo = novas.filter((l) => l.acao === "nada" && !l.motivo);
  conferir("orfandade/SC-011: nenhuma decisao de nao-fazer sem motivo", semMotivo.length === 0,
    `sem motivo: ${semMotivo.length}`);

  const acaoEsperada = casoDoCiclo.decisao_esperada?.acao;
  conferir("orfandade: a mesa decide o que a bateria do ciclo declara para a mesma leitura",
    novas.every((l) => l.acao === acaoEsperada), `esperado '${acaoEsperada}', obtido ${JSON.stringify(novas.map((l) => l.acao))}`);

  // 4. O REGRESSO (T029): um vigia novo le o estado da mesa no ledger dela e nao arranca nada.
  const resultado2 = spawnSync("bun", argsDoVigia, {
    input: comando("o-2", { verbo: "start", autor: "dono", pedido_id: "o-2" }) + "\n",
    encoding: "utf8", timeout: 20000,
  });
  const registo2 = JSON.parse(readFileSync(caminhos.registo, "utf8"));
  const leitura = (registo2.leituras ?? []).at(-1) ?? {};
  conferir("regresso: o vigia LE o estado da mesa no ledger dela (T029)",
    leitura.estado_da_mesa === "em_operacao", `lido '${leitura.estado_da_mesa}' de ${leitura.de}`);
  const novasDoRegresso = (registo2.transicoes ?? []).slice(registo1.transicoes.length);
  conferir("regresso: o vigia NAO arranca nada por conta propria",
    novasDoRegresso.every((t: any) => t.aceito === false), `transicoes novas: ${JSON.stringify(novasDoRegresso.map((t: any) => t.motivo))}`);
  // T030 - UM SO ESCRITOR NA COSTURA. A prova e o que NAO aconteceu: o vigia que voltou nao abriu um
  // segundo canal para a mesa (nenhuma mesa nova levantada). Se tivesse aberto, haveria duas mesas a
  // escrever no mesmo ledger - que e exactamente o que a RN-E7 proibe.
  const mesasDoRegresso = (registo2.processos ?? []).filter((p: any) => p.papel === "mesa");
  conferir("regresso/T030: um so escritor - o vigia que voltou NAO levantou uma segunda mesa",
    mesasDoRegresso.length === (registo1.processos ?? []).filter((p: any) => p.papel === "mesa").length,
    `mesas no registro do regresso: ${mesasDoRegresso.length}`);

  const respostaDoRegresso = JSON.parse((resultado2.stdout ?? "").trim().split("\n")[0] ?? "{}")?.carga ?? {};
  conferir("regresso: o `start` e recusado com o motivo da mesa",
    respostaDoRegresso.aceito === false && respostaDoRegresso.motivo === "mesa_ja_em_operacao",
    `aceito=${respostaDoRegresso.aceito} motivo=${respostaDoRegresso.motivo}`);

  // 5. LIMPEZA: a mesa orfa e os conectores que o SIGKILL deixou vivos, pelos pids que o vigia registou.
  for (const pid of paraMatar) {
    try { process.kill(pid, "SIGKILL"); } catch { /* ja morreu */ }
  }
  paraMatar.length = 0;
  await espera(200); // dar tempo a que morram antes de se apagar o que escreveram
  rmSync(dir2, { recursive: true, force: true });

  for (const f of falhas) console.log("FALHA " + f);
  console.log(`ok    orfandade/mesa-com-vigia-vivo · ${antes.length} voltas antes da morte do vigia`);
  console.log(`ok    orfandade/mesa-com-vigia-MORTO (FR-006) · ${novas.length} voltas novas depois do SIGKILL · ` +
    `SC-001: ${voltasContadas} voltas contadas pela mesa x ${novas.length} linhas escritas`);
  console.log(`ok    regresso/T029 · estado lido no ledger da mesa: "${leitura.estado_da_mesa}" · ` +
    `transicoes novas do vigia: ${novasDoRegresso.length} · resposta ao start: "${respostaDoRegresso.motivo}"`);
  console.log(`ok    regresso/T030 · um so escritor: ${mesasDoRegresso.length} mesa(s) no registro (nenhuma nova)`);
  console.log(
    `\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ` +
      `${novas.length} voltas com o vigia morto · ${voltasContadas} voltas contadas x ${novas.length} linhas`,
  );
  process.exit(divergentes === 0 ? 0 : 1);
}

// 1. O CAMINHO FELIZ - sem ele as recusas nao significam nada.
{
  const feliz = declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam"));
  const { saida, registro } = await correrVigia(
    [comando("a-1", { verbo: "start", autor: "dono", pedido_id: "a-1" })],
    feliz,
  );
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("feliz: start aceite", carga.aceito === true, `aceito=${carga.aceito} motivo=${carga.motivo}`);
  // T023/RN-M4.9: o instante e o DA MESA. O vigia copia-o, e nao carimba o seu - uma segunda contabilidade
  // do mesmo facto (o relogio do vigia ao lado do relogio da mesa) daria duas horas para uma so transicao.
  conferir("feliz: o instante e o da mesa (o vigia nao carimba o seu)",
    registro.transicoes[0]?.instante_ms === carga.instante_ms,
    `vigia=${registro.transicoes[0]?.instante_ms} mesa=${carga.instante_ms}`);
  conferir("feliz: parada->em_operacao", carga.transicao?.de === "parada" && carga.transicao?.para === "em_operacao",
    `${carga.transicao?.de}->${carga.transicao?.para}`);
  conferir("feliz: as sete portas conferidas", registro.transicoes[0]?.portas_conferidas?.length === PORTAS.length,
    `conferidas=${registro.transicoes[0]?.portas_conferidas?.length}`);
  console.log(`ok    arranque/todas-as-portas-passam · ${registro.transicoes[0]?.portas_conferidas?.length} portas conferidas · ` +
    `parada->${carga.transicao?.para} · ${carga.aceito ? "aceite" : "recusado: " + carga.motivo}`);
}

// 2. UMA PORTA FALHADA, POR PORTA: a resposta recusa, e o NOME DA PORTA fica no registro (T021).
for (const porta of PORTAS) {
  const caso = casoDaPorta(porta);
  if (caso === undefined) {
    conferir(`porta ${porta}: ha um caso declarado`, false, "nenhum caso em arranque.casos.json");
    continue;
  }
  // A porta dos conectores, vista do VIGIA: o caso declara `conectores_de_pe: []` (quem corre as portas nao
  // os pos de pe). Traduzido para o vigia, isso e um nome que ele NAO consegue resolver - a configuracao
  // aponta para um conector sem duble/plugin, e e assim que ele fica (e se diz) fora.
  const mudanca = porta === "conectores" ? { ...caso, config_mudanca: { conectores: ["conector_que_nao_existe"] } } : caso;
  const { saida, registro } = await correrVigia(
    [comando("b-1", { verbo: "start", autor: "dono", pedido_id: "b-1" })],
    mudanca,
  );
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  const t = registro.transicoes[0] ?? {};
  conferir(`porta ${porta}: a resposta recusa`, carga.aceito === false, `aceito=${carga.aceito}`);
  // O motivo aceita duas formas, e as duas dizem a mesma coisa: a porta do arranque recusou
  // (`porta_do_arranque_falhou`), ou a propria TABELA tinha um motivo mais especifico para aquele estado
  // (o CB inibido, por exemplo) e deu esse. O segundo nao e um generico: e mais preciso. O que nao se
  // aceita e um "nao" sem razao, ou uma razao que nao seja nenhuma destas duas.
  conferir(`porta ${porta}: o motivo e o daquela porta`,
    carga.motivo === "porta_do_arranque_falhou" || carga.motivo === caso.motivo_esperado,
    `motivo=${carga.motivo} esperado=porta_do_arranque_falhou|${caso.motivo_esperado}`);
  conferir(`porta ${porta}: a mesa NAO arrancou`, t.de === "parada" && t.para === "parada", `${t.de}->${t.para}`);
  conferir(`porta ${porta}: o registro NOMEIA a porta`, t.porta === porta, `porta=${t.porta} esperado=${porta}`);
  conferir(`porta ${porta}: o registro diz o que se conferiu`, Array.isArray(t.portas_conferidas) && t.portas_conferidas.length > 0,
    `conferidas=${JSON.stringify(t.portas_conferidas)}`);
  console.log(`ok    arranque/${porta}-recusa · resposta="${carga.motivo}" · registro nomeia a porta "${t.porta}" · ` +
    `conferidas ate a falha: ${JSON.stringify(t.portas_conferidas)} · mesa ${t.de}->${t.para}`);
}

// 3. O VIGIA ACRESCENTA OS VERBOS: start repetido, stop em parada, e o que a porta recusa sem incomodar a mesa.
{
  const feliz = declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam"));
  const { saida, registro } = await correrVigia(
    [
      comando("c-1", { verbo: "start", autor: "dono", pedido_id: "c-1" }),
      comando("c-2", { verbo: "start", autor: "dono", pedido_id: "c-2" }),
      comando("c-3", { verbo: "stop", autor: "dono", pedido_id: "c-3" }),
    ],
    feliz,
  );
  const ultima = JSON.parse(saida[1] ?? "{}")?.carga ?? {};
  conferir("start repetido: mesa_ja_em_operacao", ultima.motivo === "mesa_ja_em_operacao", `motivo=${ultima.motivo}`);
  conferir("start repetido: a transicao diz onde a mesa esta",
    ultima.transicao?.de === "em_operacao" && ultima.transicao?.para === "em_operacao",
    `${ultima.transicao?.de}->${ultima.transicao?.para}`);
  const parada = JSON.parse(saida[2] ?? "{}")?.carga ?? {};
  conferir("stop: a mesa diz o que sabe (mesa_ja_parada ou posicao_desconhecida)",
    ["mesa_ja_parada", "posicao_desconhecida", "mesa_ja_pausada"].includes(parada.motivo) || parada.aceito === true,
    `aceito=${parada.aceito} motivo=${parada.motivo}`);
  conferir("tres comandos, tres linhas no registro do vigia", registro.transicoes?.length === 3,
    `linhas=${registro.transicoes?.length}`);
  console.log(`ok    verbos/start-start-stop · start repetido="${ultima.motivo}" · stop="${parada.motivo ?? (parada.aceito ? "aceite" : "?")}" · ` +
    `${registro.transicoes?.length} linhas no registro`);
  for (const [i, linha] of saida.entries()) {
    const d = validar(linha);
    conferir(`resposta ${i + 1} e mensagem VALIDA do contrato`, d.veredicto === "aceite",
      `veredicto=${d.veredicto} motivo=${d.motivo}`);
    // T023: um aceite NAO traz motivo, e o efeito - quando existe - diz mais do que a transicao ja diz.
    // Um `efeito` igual ao `para` seria um enfeite a repetir o nome do estado, e o campo deixaria de
    // significar "ha mais para dizer" para significar "ha sempre".
    const c = JSON.parse(linha)?.carga ?? {};
    if (c.aceito === true) {
      conferir(`resposta ${i + 1}: aceito nao traz motivo`, c.motivo === undefined, `motivo=${c.motivo}`);
      if (c.efeito !== undefined) {
        conferir(`resposta ${i + 1}: o efeito nao repete o destino`, c.efeito !== c.transicao?.para,
          `efeito=${c.efeito} para=${c.transicao?.para}`);
      }
    }
  }
}

// 3b. `stop` NUMA MESA PARADA (T022): a mesa diz o que sabe - e a posicao, aqui, nao muda a resposta.
{
  const feliz = declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam"));
  const { saida, registro } = await correrVigia([comando("c-4", { verbo: "stop", autor: "dono", pedido_id: "c-4" })], feliz);
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("stop em parada: mesa_ja_parada", carga.aceito === false && carga.motivo === "mesa_ja_parada",
    `aceito=${carga.aceito} motivo=${carga.motivo}`);
  conferir("stop em parada: a transicao diz parada->parada",
    carga.transicao?.de === "parada" && carga.transicao?.para === "parada",
    `${carga.transicao?.de}->${carga.transicao?.para}`);
  conferir("stop em parada: uma linha no registro, com o verbo declarado",
    registro.transicoes?.length === 1 && registro.transicoes[0]?.verbo === "stop",
    `linhas=${registro.transicoes?.length} verbo=${registro.transicoes[0]?.verbo}`);
  console.log(`ok    verbos/stop-em-parada · resposta="${carga.motivo}" · parada->parada · ` +
    `sem conferir portas (portas conferidas: ${JSON.stringify(registro.transicoes[0]?.portas_conferidas)})`);
}

// 4. O COMANDO QUE NAO PRESTA: o vigia recusa e nao incomoda a mesa.
{
  const { saida } = await correrVigia(
    [comando("d-1", { verbo: "start", autor: "dono", pedido_id: "d-1", lado: "buy" })],
    declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam")),
  );
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("campo a mais: recusado", carga.aceito === false && carga.motivo === "comando_com_campo_a_mais",
    `aceito=${carga.aceito} motivo=${carga.motivo}`);
  console.log(`ok    porta/campo-a-mais · resposta="${carga.motivo}" (o vigia recusa sem incomodar a mesa)`);
}

rmSync(dir, { recursive: true, force: true });

for (const f of falhas) console.log("FALHA " + f);
console.log(
  `\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ` +
    `${PORTAS.length + 4} cenarios · vigia + mesa como processos`,
);
process.exit(divergentes === 0 ? 0 : 1);
