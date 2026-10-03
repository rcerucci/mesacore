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
import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { fundir } from "./fundir.ts";
import { reiniciarTravosDeBarra } from "../../core/ciclo/relogio.ts";
import { lerParaOCiclo } from "../../core/leitura/fixtures.ts";

/**
 * A BARRA DO SINAL como um setup a declara: a ultima barra FECHADA do relogio da ficha (aqui 1h).
 *
 * A bancada precisa dela porque a mesa so' age numa proposta que seja DESTA barra — e a operacao desta bancada
 * e' um duble escrito a mao. Nao se inventa um numero: calcula-se do MESMO instante que a mesa vai ler, pela
 * mesma funcao que a mesa usa para montar a leitura.
 */
/**
 * O INSTANTE DO VENUE que o duble declara (30 min dentro de uma hora cheia): com ele escrito na operacao, o
 * instante que a bancada usa para calcular a barra e' o MESMO que a mesa le' — sem isto os dois podiam cair em
 * barras diferentes, e a bancada acusava a mesa de uma coisa que era da bancada.
 */
const INSTANTE_DO_DUBLE = 1730005500000;

/**
 * A BARRA FECHADA a que pertence o instante do duble — a hora CHEIA, e nao o instante menos uma hora (que cai
 * dentro da barra anterior, e nao na abertura dela). Foi este o erro que fez a bancada acusar a mesa: medido.
 */
function barraDoInstanteDoDuble(): number {
  const passo = 3_600_000;
  return Math.floor(INSTANTE_DO_DUBLE / passo) * passo - passo;
}

function barraDoSinalDaLeitura(leitura: any): number {
  const passo = 3_600_000;
  const t = Number(lerParaOCiclo(leitura, null, 0).mercado?.tempo_do_venue_ms);
  if (!Number.isFinite(t)) throw new Error("a leitura do caso nao tem `tempo_do_venue_ms`: sem instante nao ha barra");
  return Math.floor(t / passo) * passo - passo;
}

const MODO = process.argv[2] ?? "";
if (MODO !== "--arranque" && MODO !== "--orfandade" && MODO !== "--encerramento" && MODO !== "--verbos") {
  const tarefa = "(desconhecido)";
  console.log(`${MODO}: NAO IMPLEMENTADO (tarefa ${tarefa})`);
  process.exit(2);
}

// A versao do contrato NAO se escreve aqui: LE-SE de `contracts/versao.json` (`versaoVigente`). Escrita a
// mao, esta bancada envelheceria em silencio na proxima emenda — e todos os comandos que ela escreve ao
// vigia passariam a ser recusados por `versao_do_contrato_divergente`.
const VERSAO = versaoVigente();
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
if (MODO === "--encerramento") await bancadaDoEncerramento();
if (MODO === "--verbos") await bancadaDosVerbos();

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
/* --------------------------------------------------------------- O ENCERRAMENTO (US3, T038)

Os QUATRO desfechos do `stop` com posicao viva, mais as duas recusas que a T033 acrescentou e a decisao
sem pergunta. Cada cenario corre o VIGIA a serio (processo, com a mesa filha), contra dubleis.

O que se mede, e por que e esta a medida:
  - sem resposta, o prazo CUMPRE-SE: a mesa volta a `em_operacao` (a abrir incluido) e o `stop` fica
    ARCHIVADO como pendente. Prova-se pelo registo da MESA (a transicao com o motivo) e pelas marcas (o
    pedido guardado) - uma mesa congelada a espera nao aparece em sitio nenhum, e e isso que se procura;
  - com `manter`, a mesa fica `parada` com posicao viva E o aviso fica no registro do vigia: quem ler depois
    tem de ver o que foi dito ao dono ANTES de escolher;
  - com `fechar_a_mercado`, a liquidacao corre: a volta do relogio decide `fechar` (com boleta) e a mesa so
    fica `parada` quando nao ha posicao nossa para fechar em instrumento nenhum;
  - sem prazo na ficha ou sem os numeros da corretora, a mesa RECUSA o `stop` - e diz qual dos dois faltou.
*/
/* --------------------------------------------------------------- OS TRES VERBOS (US4, T044)

`pause`, `reset` e `nova_sessao` sao os tres em que uma confusao custa dinheiro. Cada cenario corre o VIGIA a
serio, com a mesa filha, contra dubleis.

O que se mede, e por que e esta a medida:
  - a pausa suspende ABRIR e mais nada. O par de controlo e o que prova as duas metades: com a mesma pausa, o
    caso que abriria nao abre E o caso que fecharia FECHA. Sem o segundo, "a pausa suspende abrir" podia ser
    "a pausa para a mesa" - e a posicao ficava sem defesa;
  - o `reset` reinicia sem tocar em nada, e di-lo. Prova-se por TRES lados: o efeito na resposta, o ficheiro de
    marcas (a inibicao continua la) e o `start` seguinte, que continua a recusar. Um reset que limpasse a
    inibicao apagaria o CB que a propria mesa disparou;
  - o `nova_sessao` e o UNICO caminho fora da inibicao, e grava uma sessao que se pode comparar: o equity de
    partida (da corretora) e a unidade (ficha, versao do setup, versao do mandato). Sem qualquer dos dois,
    RECUSA com o nome do que faltou - e o `start` seguinte so passa depois da sessao gravada;
  - um campo que a mensagem do comando nao tem e RECUSADO (FR-020): o campo da conta entra no dia em que a
    mesa servir mais do que uma conta, e nao antes.
*/
async function bancadaDosVerbos() {
  // D-021: cada fase e' UMA mesa. Sem este reinicio, o travao da barra de uma fase entrava na seguinte (o mesmo
  // processo), e as 10 voltas da orfandade ficavam todas em `nada` — medido antes de o corrigir.
  reiniciarTravosDeBarra();
  console.log("=== bancada dos verbos: pause, reset e nova_sessao (T044)\n");

  const declaradoDoCiclo = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core/ciclo/ciclo.casos.json"), "utf8"));
  const padraoDoCiclo = declaradoDoCiclo.padrao;
  const casoDo = (prefixo: string) => declaradoDoCiclo.casos.find((c: any) => c.nome.startsWith(prefixo));
  const abre = casoDo("normal-proposta-buy-abre");
  const fecha = casoDo("normal-proposta-caixa-com-posicao");

  const base = JSON.parse(JSON.stringify(declarado.padrao.config));
  const config = (semVersaoDoMandato = false) => {
    const c = JSON.parse(JSON.stringify(base));
    for (const ficha of Object.values<any>(c.fichas)) {
      ficha.setup = { prazo_de_resposta_ms: 1500 };
      if (!semVersaoDoMandato) ficha.versao_do_mandato = "risco-v3";
    }
    return c;
  };
  const operacao = (caso: any, comEquity: boolean) => {
    const leitura: any = { ...caso.leitura, tempo_do_venue_ms: INSTANTE_DO_DUBLE };
    if (comEquity) leitura.equity = "1000.00"; else delete leitura.equity;
    return {
      nota: "duble de operacao dos verbos", ligacao: "ligada",
      corretora: { posicao: "0.25", nocional: "25000.00", margem: "1000.00", distancia_de_liquidacao: "0.081", resultado_nao_realizado: "-125.40" },
      instrumentos: {
        EURUSD: {
          leitura,
          // A barra vem calculada da leitura: e' ela que faz a proposta ser DESTA barra (contrato 1.8.0).
          proposta: { setup: padraoDoCiclo.proposta_setup, ...caso.proposta, barra_ms: barraDoSinalDaLeitura(leitura) },
          ficha: caso.ficha ?? padraoDoCiclo.ficha,
          template: padraoDoCiclo.template,
          marcas_nossas_conhecidas: caso.marcas_nossas_conhecidas ?? [],
          // A LEITURA DECLARA O QUE NAO TROUXE E SE DIVERGIU: ausente = recusa (o ciclo nao
          // decide a bem de uma leitura que ninguem conferiu). Bancada: o caso e' que declara.
          falhas: caso.falhas ?? { leitura: false },
          divergente: caso.divergente ?? false,
          relogio: "1h",
        },
      },
    };
  };
  const marcasInibidas = (caminho: string) =>
    writeFileSync(caminho, JSON.stringify({
      sessao: null,
      inibicao_cb: { motivo: "perda de 5% na sessao", instante_ms: 1, perda_medida: "50.00" },
      desconhecido: [], pedidos: [],
    }, null, 2));

  const correr = async (
    nome: string,
    linhas: string[],
    quantasRespostas: number,
    opcoesCenario: { config?: any; operacao?: any; inibida?: boolean; espera?: number; posicaoViva?: boolean } = {},
  ) => {
    const dir = mkdtempSync(join(tmpdir(), `vigia-verbos-${nome}-`));
    const c = {
      config: join(dir, "config.json"), manifesto: join(dir, "manifesto.json"),
      operacao: join(dir, "operacao.json"), marcas: join(dir, "marcas.json"),
      registo: join(dir, "vigia.json"), portas: join(dir, "portas.json"), ledger: join(dir, "ledger.jsonl"),
    };
    writeFileSync(c.config, JSON.stringify(opcoesCenario.config ?? config()));
    writeFileSync(c.manifesto, JSON.stringify(manifestoDoFixture));
    writeFileSync(c.operacao, JSON.stringify(opcoesCenario.operacao ?? operacao(fecha, true)));
    if (opcoesCenario.inibida) marcasInibidas(c.marcas);
    writeFileSync(c.portas, JSON.stringify({ passam: true, portas_conferidas: ["conectores"] }));
    const proc = spawn("bun", [
      "run", join(RAIZ_DO_REPO, "vigia", "vigia.ts"),
      "--config", c.config, "--manifesto", c.manifesto, "--marcas", c.marcas,
      "--registo", c.registo, "--portas", c.portas, "--ledger", c.ledger, "--operacao", c.operacao,
      "--posicao-viva", String(opcoesCenario.posicaoViva ?? false), "--tick", "150",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let bruto = "", erros = "";
    proc.stdout!.setEncoding("utf8"); proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (p: string) => { erros += p; });
    const respostas = () => bruto.split("\n").filter((l) => l.trim() !== "");
    const chegou = new Promise<void>((resolver) => {
      const limite = setTimeout(resolver, 30000);
      proc.stdout!.on("data", (p: string) => {
        bruto += p;
        if (respostas().length >= quantasRespostas) { clearTimeout(limite); resolver(); }
      });
    });
    proc.stdin!.write(linhas.join("\n") + "\n");
    await chegou;
    if (opcoesCenario.espera) await new Promise((r) => setTimeout(r, opcoesCenario.espera));
    const saida = respostas();
    proc.kill("SIGKILL");
    let registro: any = { transicoes: [], processos: [] };
    try { registro = JSON.parse(readFileSync(c.registo, "utf8")); } catch { /* as provas reprovam */ }
    for (const p of registro.processos ?? []) {
      if (typeof p.pid === "number") { try { process.kill(p.pid, "SIGKILL"); } catch { /* ja morreu */ } }
    }
    const lerLedger = () => {
      try { return readFileSync(c.ledger, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l)); }
      catch { return []; }
    };
    const marcas = () => { try { return JSON.parse(readFileSync(c.marcas, "utf8")); } catch { return null; } };
    return { saida, registro, ledger: lerLedger(), marcas, carga: (i: number) => JSON.parse(saida[i] ?? "{}")?.carga ?? {}, dir, erros };
  };

  const cmd = (id: string, verbo: string, extra: Record<string, unknown> = {}) =>
    comando(id, { verbo, autor: "dono", pedido_id: id, ...extra });

  // 1 e 2. A PAUSA: o par de controlo. Abrir nao abre; fechar FECHA.
  const p1 = await correr("pause-abrir", [cmd("a1", "start"), cmd("a2", "pause")], 2, { operacao: operacao(abre, true), espera: 900 });
  const cicloPausado = p1.ledger.filter((l: any) => l.tipo === "ciclo").at(-1);
  conferir("pause/RN-V2.1: com a mesa pausada a ABERTURA e suspensa",
    cicloPausado?.motivo === "mesa_pausada_nao_abre" && cicloPausado?.acao !== "abrir",
    `acao=${cicloPausado?.acao} motivo=${cicloPausado?.motivo}`);

  const p2 = await correr("pause-fechar", [cmd("b1", "start"), cmd("b2", "pause")], 2, { operacao: operacao(fecha, true), espera: 900 });
  const cicloDefende = p2.ledger.filter((l: any) => l.tipo === "ciclo" && l.acao === "fechar");
  conferir("pause/FR-010: a pausa NAO suspende defender - o CB e a liquidacao correm",
    cicloDefende.length > 0, `voltas com fechar=${cicloDefende.length} · estado=${p2.carga(1).transicao?.para}`);

  // 3. O RESET: nao limpa a inibicao, e di-lo.
  const r1 = await correr("reset", [cmd("c1", "reset"), cmd("c2", "start")], 2, { inibida: true });
  const reinicio = r1.carga(0);
  conferir("reset/FR-005: o reset diz o que NAO tocou", reinicio.efeito === "reset_nao_toca_em_nada",
    `efeito=${reinicio.efeito}`);
  conferir("reset: as marcas continuam com a inibicao do CB",
    r1.marcas()?.inibicao_cb?.motivo === "perda de 5% na sessao", `inibicao=${JSON.stringify(r1.marcas()?.inibicao_cb)?.slice(0, 60)}`);
  conferir("reset: o `start` seguinte continua a recusar (a inibicao nao foi limpa)",
    r1.carga(1).motivo === "sessao_inibida", `motivo=${r1.carga(1).motivo}`);

  // 4. NOVA SESSAO sem motivo: o motivo e do dono e sem ele o registo nao explica a sessao.
  const n1 = await correr("sem-motivo", [cmd("d1", "nova_sessao")], 1,
    { config: (() => { const c = config(); return c; })(), operacao: operacao(abre, true) });
  conferir("nova_sessao/RN-V10: sem motivo e RECUSADA", n1.carga(0).motivo === "comando_incompleto",
    `motivo=${n1.carga(0).motivo}`);

  // 5 e 6. O PONTO DE PARTIDA: sem o equity, e sem a unidade, recusa - e diz qual faltou.
  const n2 = await correr("sem-equity", [cmd("e1", "nova_sessao", { motivo: "trocar de ficha" })], 1,
    { operacao: operacao(abre, false) });
  conferir("nova_sessao/T042-RN-M3: sem o equity da corretora RECUSA (nao se grava base vazia)",
    n2.carga(0).motivo === "equity_de_partida_nao_lido", `motivo=${n2.carga(0).motivo}`);

  const n3 = await correr("sem-unidade", [cmd("f1", "nova_sessao", { motivo: "trocar de ficha" })], 1,
    { config: config(true), operacao: operacao(abre, true) });
  conferir("nova_sessao/T042-FR-034: sem a versao do mandato RECUSA (a unidade e do dono)",
    n3.carga(0).motivo === "unidade_de_comparacao_nao_declarada", `motivo=${n3.carga(0).motivo}`);

  // 7. NOVA SESSAO completa: grava a sessao E levanta a inibicao - e o `start` seguinte passa.
  const n4 = await correr("completa", [cmd("g1", "nova_sessao", { motivo: "sessao nova depois do CB" }), cmd("g2", "start")], 2,
    { inibida: true, operacao: operacao(abre, true) });
  const sessao = n4.marcas()?.sessao;
  conferir("nova_sessao/T042: grava autor, motivo, instante, equity de partida e a unidade",
    n4.carga(0).efeito === "sessao_nova_gravada" && sessao?.autor === "dono" &&
      sessao?.motivo === "sessao nova depois do CB" && sessao?.equity_de_partida === "1000.00" &&
      sessao?.configuracao_em_vigor?.ficha === "ema_cruz" &&
      sessao?.configuracao_em_vigor?.versao_do_setup === "1.0.0" &&
      sessao?.configuracao_em_vigor?.versao_do_mandato === "risco-v3" &&
      Number.isInteger(sessao?.instante_ms),
    `sessao=${JSON.stringify(sessao)?.slice(0, 150)}`);
  conferir("nova_sessao/FR-038: e o UNICO caminho fora da inibicao (o `start` seguinte arranca)",
    n4.marcas()?.inibicao_cb === null && n4.carga(1).transicao?.para === "em_operacao",
    `inibicao=${String(n4.marcas()?.inibicao_cb)} para=${n4.carga(1).transicao?.para}`);

  // 8 e 9. Os dois limites do verbo: posicao viva, e um campo que a mensagem nao tem.
  const n5 = await correr("posicao-viva", [cmd("h1", "nova_sessao", { motivo: "trocar de ficha" })], 1,
    { operacao: operacao(abre, true), posicaoViva: true });
  conferir("nova_sessao: com posicao viva RECUSA (a sessao nova nao serve para limpar posicao)",
    n5.carga(0).motivo === "sessao_nova_com_posicao_viva", `motivo=${n5.carga(0).motivo}`);

  const n6 = await correr("campo-a-mais", [cmd("i1", "nova_sessao", { motivo: "trocar de ficha", conta: "conta-2" })], 1,
    { operacao: operacao(abre, true) });
  conferir("nova_sessao/FR-020: o campo da CONTA ainda nao existe - um campo a mais e RECUSADO",
    n6.carga(0).motivo === "comando_com_campo_a_mais", `motivo=${n6.carga(0).motivo}`);

  for (const x of [p1, p2, r1, n1, n2, n3, n4, n5, n6]) rmSync(x.dir, { recursive: true, force: true });

  for (const falha of falhas) console.log("FALHA " + falha);
  console.log("ok    cenario/pausa · abrir suspenso, fechar continua · " + `motivo do ciclo: ${cicloPausado?.motivo}`);
  console.log(`ok    cenario/reset · efeito ${reinicio.efeito} · inibicao intacta · start ainda recusa`);
  console.log(`ok    cenario/nova-sessao · equity ${sessao?.equity_de_partida}, unidade ${sessao?.configuracao_em_vigor?.ficha}@${sessao?.configuracao_em_vigor?.versao_do_mandato} · inibicao levantada`);
  console.log(`ok    cenario/recusas · ${n2.carga(0).motivo} · ${n3.carga(0).motivo} · ${n5.carga(0).motivo} · ${n6.carga(0).motivo}`);
  console.log(
    `\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · 9 cenarios ` +
      "(pausa-abrir, pausa-fechar, reset, sem-motivo, sem-equity, sem-unidade, completa, posicao-viva, campo-a-mais)",
  );
  process.exit(divergentes === 0 ? 0 : 1);
}

async function bancadaDoEncerramento() {
  // D-021: cada fase e' UMA mesa. Sem este reinicio, o travao da barra de uma fase entrava na seguinte (o mesmo
  // processo), e as 10 voltas da orfandade ficavam todas em `nada` — medido antes de o corrigir.
  reiniciarTravosDeBarra();
  console.log("=== bancada do encerramento: os desfechos do `stop` com posicao viva (T038)\n");

  const declaradoDoCiclo = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core/ciclo/ciclo.casos.json"), "utf8"));
  const padraoDoCiclo = declaradoDoCiclo.padrao;
  const comPosicao = declaradoDoCiclo.casos.find((c: any) => c.nome.startsWith("normal-proposta-caixa-com-posicao"));
  const semPosicao = declaradoDoCiclo.casos.find((c: any) => c.nome.startsWith("normal-proposta-caixa-sem-posicao"));

  const base = JSON.parse(JSON.stringify(declarado.padrao.config));
  const comPrazo = (prazo: number | null) => {
    const c = JSON.parse(JSON.stringify(base));
    for (const ficha of Object.values<any>(c.fichas)) {
      if (prazo === null) delete ficha.setup; else ficha.setup = { prazo_de_resposta_ms: prazo };
    }
    return c;
  };
  const operacao = (caso: any, comNumeros = true) => ({
    nota: "duble de operacao do encerramento",
    ligacao: "ligada",
    ...(comNumeros
      ? { corretora: { posicao: "0.25", nocional: "25000.00", margem: "1000.00", distancia_de_liquidacao: "0.081", resultado_nao_realizado: "-125.40" } }
      : {}),
    instrumentos: {
      EURUSD: {
        leitura: { ...caso.leitura, tempo_do_venue_ms: INSTANTE_DO_DUBLE },
        // A proposta e a do SETUP (um objecto `{nome, versao}`) com o lado do caso: `{nome, versao, lado}` no
        // mesmo nivel nao e a forma do contrato, e o ciclo recusa-a em silencio (proposta ausente -> hold).
        // Medido: 199 voltas sem uma unica decisao, e o motivo so aparecia na linha `nada` do registo.
        proposta: { setup: padraoDoCiclo.proposta_setup, ...caso.proposta, barra_ms: barraDoSinalDaLeitura(caso.leitura) },
        ficha: caso.ficha,
        template: padraoDoCiclo.template,
        marcas_nossas_conhecidas: caso.marcas_nossas_conhecidas ?? [],
        // A LEITURA DECLARA O QUE NAO TROUXE E SE DIVERGIU: ausente = recusa (o ciclo nao
        // decide a bem de uma leitura que ninguem conferiu). Bancada: o caso e' que declara.
        falhas: caso.falhas ?? { leitura: false },
        divergente: caso.divergente ?? false,
        relogio: "1h",
      },
    },
  });

  /** Prepara um cenario e corre o vigia; devolve o que ele respondeu e o que ficou escrito. */
  const correr = async (
    nome: string,
    linhas: string[],
    quantasRespostas: number,
    opcoesCenario: { config?: any; operacao?: any; espera?: number } = {},
  ) => {
    const dir = mkdtempSync(join(tmpdir(), `vigia-enc-${nome}-`));
    const c = {
      config: join(dir, "config.json"),
      manifesto: join(dir, "manifesto.json"),
      operacao: join(dir, "operacao.json"),
      marcas: join(dir, "marcas.json"),
      registo: join(dir, "vigia.json"),
      portas: join(dir, "portas.json"),
      ledger: join(dir, "ledger.jsonl"),
    };
    writeFileSync(c.config, JSON.stringify(opcoesCenario.config ?? comPrazo(600)));
    writeFileSync(c.manifesto, JSON.stringify(manifestoDoFixture));
    writeFileSync(c.operacao, JSON.stringify(opcoesCenario.operacao ?? operacao(comPosicao)));
    writeFileSync(c.portas, JSON.stringify({ passam: true, portas_conferidas: ["conectores"] }));
    const proc = spawn("bun", [
      "run", join(RAIZ_DO_REPO, "vigia", "vigia.ts"),
      "--config", c.config, "--manifesto", c.manifesto, "--marcas", c.marcas,
      "--registo", c.registo, "--portas", c.portas, "--ledger", c.ledger,
      "--operacao", c.operacao, "--posicao-viva", "true", "--tick", "150",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let bruto = "";
    let erros = "";
    proc.stdout!.setEncoding("utf8");
    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (p: string) => { erros += p; });
    const respostas = () => bruto.split("\n").filter((l) => l.trim() !== "");
    const chegou = new Promise<void>((resolver) => {
      const limite = setTimeout(resolver, 30000);
      proc.stdout!.on("data", (p: string) => {
        bruto += p;
        if (respostas().length >= quantasRespostas) { clearTimeout(limite); resolver(); }
      });
    });
    proc.stdin!.write(linhas.join("\n") + "\n");
    await chegou;
    if (opcoesCenario.espera) await new Promise((r) => setTimeout(r, opcoesCenario.espera));
    const saida = respostas();
    // O vigia nao sai sozinho com operacao nas maos: quem o termina e a bancada, e leva consigo os pids
    // registados (a mesa e os conectores).
    proc.kill("SIGKILL");
    let registro: any = { transicoes: [], processos: [] };
    try { registro = JSON.parse(readFileSync(c.registo, "utf8")); } catch { /* as provas reprovam */ }
    for (const p of registro.processos ?? []) {
      if (typeof p.pid === "number") { try { process.kill(p.pid, "SIGKILL"); } catch { /* ja morreu */ } }
    }
    const lerLedger = (caminho: string) => {
      try { return readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l)); }
      catch { return []; }
    };
    const marcas = (() => { try { return JSON.parse(readFileSync(c.marcas, "utf8")); } catch { return null; } })();
    const conferirCarga = (i: number) => JSON.parse(saida[i] ?? "{}")?.carga ?? {};
    return { saida, registro, ledger: lerLedger(c.ledger), marcas, carga: conferirCarga, dir, erros };
  };

  const cmd = (id: string, verbo: string) => comando(id, { verbo, autor: "dono", pedido_id: id });
  const decisao = (id: string, pedido: string, resposta: string) =>
    JSON.stringify({ contrato: VERSAO, tipo: "decisao_do_encerramento", id, carga: { pedido_id: pedido, resposta } });

  // 1. SEM RESPOSTA: o prazo cumpre-se e a mesa volta a operar com o `stop` pendente.
  const a = await correr("prazo", [cmd("e1", "start"), cmd("e2", "stop")], 3, { espera: 1400 });
  conferir("prazo: o `stop` entra em encerramento", a.carga(1).transicao?.para === "encerrando", `para=${a.carga(1).transicao?.para}`);
  conferir("prazo: a pergunta sai com o prazo do dono", a.carga(2).prazo_de_resposta_ms === 600, `prazo=${a.carga(2).prazo_de_resposta_ms}`);
  const voltou = a.ledger.filter((l: any) => l.tipo === "transicao" && l.motivo === "stop_pendente_por_prazo").at(-1);
  conferir("prazo/RN-V9.1: passado o prazo a mesa VOLTA a operar", voltou?.de === "encerrando" && voltou?.para === "em_operacao",
    `transicao=${voltou?.de}->${voltou?.para}`);
  conferir("prazo: o `stop` fica ARCHIVADO como pendente nas marcas",
    (a.marcas?.pedidos ?? []).some((p: any) => p.verbo === "stop" && p.motivo === "stop_pendente_por_prazo"),
    `pedidos=${JSON.stringify(a.marcas?.pedidos)}`);

  // 2. MANTER: parada com posicao viva, e o aviso no registro do vigia.
  const b = await correr("manter", [cmd("m1", "start"), cmd("m2", "stop"), decisao("m3", "m2", "manter")], 4, { espera: 500 });
  const tManter = b.registro.transicoes.find((t: any) => t.verbo === "stop");
  conferir("manter/T035: a mesa fica `parada` com posicao viva", b.carga(3).efeito === "parada_com_posicao_viva",
    `efeito=${b.carga(3).efeito}`);
  conferir("manter: o aviso de manter fica no registro do vigia", typeof tManter?.pergunta?.aviso_de_manter === "string" && tManter.pergunta.aviso_de_manter.includes("NADA DEFENDE"),
    `aviso=${String(tManter?.pergunta?.aviso_de_manter).slice(0, 40)}`);
  conferir("manter: o registro guarda os numeros e o prazo que o dono viu",
    Object.keys(tManter?.pergunta?.numeros ?? {}).length === 5 && tManter?.pergunta?.prazo_de_resposta_ms === 600,
    `numeros=${Object.keys(tManter?.pergunta?.numeros ?? {}).length} prazo=${tManter?.pergunta?.prazo_de_resposta_ms}`);

  // 3. FECHAR A MERCADO: a liquidacao corre, e a mesa so fica parada quando nao ha o que fechar.
  const c = await correr("fechar", [cmd("f1", "start"), cmd("f2", "stop"), decisao("f3", "f2", "fechar_a_mercado")], 4, { espera: 900 });
  conferir("fechar/T035: a decisao abre a liquidacao", c.carga(3).efeito === "liquidacao_em_curso", `efeito=${c.carga(3).efeito}`);
  const fechou = c.ledger.filter((l: any) => l.tipo === "ciclo" && l.acao === "fechar");
  conferir("fechar/T035: a liquidacao DECIDE fechar, com boleta", fechou.length > 0 && String(fechou[0].nota).includes("com boleta"),
    `voltas com fechar=${fechou.length} · ciclos=${c.ledger.filter((l: any) => l.tipo === "ciclo").length} · stderr=${c.erros.trim().slice(0, 120)}`);
  const aindaEncerrando = c.ledger.filter((l: any) => l.tipo === "transicao").at(-1);
  conferir("fechar: com posicao viva a mesa NAO fica parada ainda", aindaEncerrando?.para === "encerrando",
    `ultima transicao=${aindaEncerrando?.de}->${aindaEncerrando?.para}`);

  // 4. DECISAO SEM PERGUNTA: recusada, e com o nome certo.
  const d = await correr("sem-pergunta", [decisao("d1", "nada", "manter")], 1);
  conferir("decisao/T034: decisao sem pergunta e RECUSADA nomeada", d.carga(0).motivo === "decisao_sem_pergunta",
    `motivo=${d.carga(0).motivo}`);

  // 5. SEM OS NUMEROS DA CORRETORA: o `stop` recusa, porque o resumo nao se estima (RN-V8).
  const e = await correr("sem-numeros", [cmd("n1", "start"), cmd("n2", "stop")], 2, { operacao: operacao(comPosicao, false) });
  conferir("numeros/RN-V8: sem os numeros da corretora a mesa RECUSA o stop", e.carga(1).motivo === "numeros_da_corretora_ausentes",
    `motivo=${e.carga(1).motivo} para=${e.carga(1).transicao?.para}`);
  const eUltima = e.ledger.filter((l: any) => l.tipo === "transicao").at(-1);
  conferir("numeros: a posicao fica GOVERNADA (a mesa nao sai de `em_operacao`)", eUltima?.para === "em_operacao",
    `ultima transicao=${eUltima?.para}`);

  // 6. SEM O PRAZO DO DONO: idem, com o outro nome.
  const f = await correr("sem-prazo", [cmd("p1", "start"), cmd("p2", "stop")], 2, { config: comPrazo(null) });
  conferir("prazo-do-dono/RN-V9.1: sem prazo na ficha a mesa RECUSA o stop", f.carga(1).motivo === "prazo_de_resposta_nao_declarado",
    `motivo=${f.carga(1).motivo}`);

  // 7. LIQUIDACAO CUMPRIDA: a posicao ja fechou, e a mesa fica parada.
  const g = await correr("cumprida", [cmd("g1", "start"), cmd("g2", "stop"), decisao("g3", "g2", "fechar_a_mercado")], 4,
    { operacao: operacao(semPosicao), espera: 900 });
  const gParou = g.ledger.filter((l: any) => l.tipo === "transicao" && l.para === "parada").at(-1);
  conferir("cumprida/T035: sem posicao nossa a liquidacao termina e a mesa fica parada",
    gParou?.de === "encerrando" && String(gParou?.nota).includes("liquidacao cumprida"),
    `transicao=${gParou?.de}->${gParou?.para} nota=${String(gParou?.nota).slice(0, 40)}`);

  // 8. A LIQUIDACAO EM CURSO NAO SE INTERROMPE (D-007, FR-013). O dono respondeu «fechar a mercado» e a
  //    liquidacao esta' a correr — um `start` a meio NAO reabre: a tabela recusa-o com o motivo proprio
  //    (`liquidacao_em_curso`). Era aqui que a mesa REABRIA: a guarda `com_liquidacao_em_curso` existia na
  //    tabela, mas nenhum contexto a punha a `true`, e o `start` caia na linha `sempre` — a posicao ficava
  //    meio fechada e a mesa a volta a geri-la. A prova mede os DOIS lados: o nome da recusa, e o registo
  //    sem a transicao de reabertura.
  const h = await correr("liquidacao-em-curso", [cmd("h1", "start"), cmd("h2", "stop"), decisao("h3", "h2", "fechar_a_mercado"), cmd("h4", "start")], 5, { espera: 900 });
  const hReabriu = h.ledger.filter((l: any) => l.tipo === "transicao" && l.verbo === "start" && l.de === "encerrando" && l.para === "em_operacao");
  conferir("liquidacao-em-curso/D-007: o `start` a meio da liquidacao e RECUSADO nomeado",
    h.carga(4).motivo === "liquidacao_em_curso", `motivo=${h.carga(4).motivo}`);
  conferir("liquidacao-em-curso/D-007: e a mesa NAO reabre (nenhuma transicao `start`->em_operacao depois do stop)",
    hReabriu.length === 0, `reaberturas=${hReabriu.length} · ultima=${JSON.stringify(h.ledger.filter((l: any) => l.tipo === "transicao").at(-1))?.slice(0, 120)}`);
  conferir("liquidacao-em-curso/D-007: a recusa fica no registo com o nome dela",
    h.ledger.some((l: any) => l.tipo === "recusa" && l.motivo === "liquidacao_em_curso"),
    `recusas=${JSON.stringify(h.ledger.filter((l: any) => l.tipo === "recusa").map((l: any) => l.motivo))}`);

  // 9. O CONTROLO DO CASO 8, e o que impede o caso 8 de ser «a mesa recusa sempre»: o MESMO `start`, com a
  //    liquidacao POR COMECAR (o dono ainda nem respondeu a pergunta), REABRE a operacao — e' a resposta
  //    «nao feche» da US7, com a transicao `encerrando -> em_operacao` escrita pelo verbo `start`.
  const i = await correr("nao-fechar", [cmd("i1", "start"), cmd("i2", "stop"), cmd("i3", "start")], 4, { espera: 300 });
  const iReabriu = i.ledger.filter((l: any) => l.tipo === "transicao" && l.verbo === "start" && l.de === "encerrando" && l.para === "em_operacao");
  conferir("nao-fechar/US7: com a liquidacao por comecar o `start` REABRE a operacao",
    iReabriu.length === 1 && i.carga(3).transicao?.para === "em_operacao",
    `reaberturas=${iReabriu.length} para=${i.carga(3).transicao?.para}`);

  for (const x of [a, b, c, d, e, f, g, h, i]) rmSync(x.dir, { recursive: true, force: true });

  for (const falha of falhas) console.log("FALHA " + falha);
  // Uma linha por cenario: o relatorio e a saida crua, e nao a leitura que alguem fez dela (T026).
  console.log(`ok    cenario/prazo-expira · a mesa volta a \`em_operacao\` e o stop fica pendente nas marcas`);
  console.log(`ok    cenario/manter · ${b.carga(3).efeito} · aviso no registro: ${String(tManter?.pergunta?.aviso_de_manter).slice(0, 46)}...`);
  console.log(`ok    cenario/fechar-a-mercado · liquidacao decide \`fechar\` em ${fechou.length} volta(s) e a mesa fica em \`encerrando\``);
  console.log(`ok    cenario/decisao-sem-pergunta · recusada: ${d.carga(0).motivo}`);
  console.log(`ok    cenario/sem-numeros-da-corretora · recusada: ${e.carga(1).motivo}`);
  console.log(`ok    cenario/sem-prazo-do-dono · recusada: ${f.carga(1).motivo}`);
  console.log(`ok    cenario/liquidacao-cumprida · ${gParou?.de}->${gParou?.para} (sem posicao nossa a fechar)`);
  console.log(`ok    cenario/liquidacao-em-curso · o stop->fechar_a_mercado abre a liquidacao e o \`start\` a meio e recusado: ${h.carga(4).motivo}`);
  console.log(`ok    cenario/nao-fechar · com a liquidacao por comecar o mesmo \`start\` reabre: ${i.carga(3).transicao?.para}`);
  console.log(
    `\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · 9 cenarios ` +
      "(prazo, manter, fechar, decisao-sem-pergunta, sem-numeros, sem-prazo, liquidacao-cumprida, liquidacao-em-curso, nao-fechar)",
  );
  process.exit(divergentes === 0 ? 0 : 1);
}

async function bancadaDaOrfandade() {
  // D-021: cada fase e' UMA mesa. Sem este reinicio, o travao da barra de uma fase entrava na seguinte (o mesmo
  // processo), e as 10 voltas da orfandade ficavam todas em `nada` — medido antes de o corrigir.
  reiniciarTravosDeBarra();
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
        leitura: { ...casoDoCiclo.leitura, tempo_do_venue_ms: INSTANTE_DO_DUBLE },
        // A barra calculada do MESMO instante que a mesa vai ler (contrato 1.8.0): sem isto a proposta era
        // recusada por ser de outra barra, e a bancada acusava a mesa de um defeito que era da bancada.
        proposta: { setup: declaradoDoCiclo.padrao.proposta_setup, ...casoDoCiclo.proposta, barra_ms: barraDoInstanteDoDuble() },
        ficha: casoDoCiclo.ficha ?? declaradoDoCiclo.padrao.ficha,
        template: casoDoCiclo.template ?? declaradoDoCiclo.padrao.template,
        marcas_nossas_conhecidas: casoDoCiclo.marcas_nossas_conhecidas ?? declaradoDoCiclo.padrao.marcas_nossas_conhecidas,
        // A LEITURA DECLARA O QUE NAO TROUXE E SE DIVERGIU: ausente = recusa (o ciclo nao
        // decide a bem de uma leitura que ninguem conferiu). Bancada: o caso e' que declara.
        falhas: casoDoCiclo.falhas ?? { leitura: false },
        divergente: casoDoCiclo.divergente ?? false,
        relogio: "1h",
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
  // D-021 (30/09/2026): as voltas desta bancada caem TODAS na mesma barra, e o travao da barra faz da primeira
  // a entrada e das seguintes `nada` com motivo. A expectativa passa a ser essa — e continua a medir o que
  // media: que a mesa decide o que a bateria declara, na primeira volta em que a barra pode entrar.
  // A PRIMEIRA DECISAO DA FASE e' a entrada da barra (pode ter acontecido antes de o vigia morrer — e aconteceu:
  // medido). O travao faz das seguintes `nada` com motivo, e e' isso que se mede aqui.
  const decisoes = lerLinhas(caminhos.ledger).filter((l: any) => l.acao !== undefined);
  const primeiraEntrada = decisoes[0];
  conferir("orfandade: a mesa decide o que a bateria do ciclo declara para a mesma leitura",
    primeiraEntrada !== undefined && primeiraEntrada.acao === acaoEsperada,
    `esperado '${acaoEsperada}', obtido ${JSON.stringify(decisoes.map((l: any) => [l.acao, l.motivo]))}`);
  const repetidas = decisoes.slice(1);
  conferir("orfandade/D-021: as voltas seguintes da MESMA barra sao `nada` pelo travao, e dizem-no",
    repetidas.length > 0 && repetidas.every((l: any) => l.acao === "nada" && l.motivo === "entrada_ja_feita_nesta_barra"),
    `obtido ${JSON.stringify(repetidas.map((l: any) => [l.acao, l.motivo]))}`);

  // 4. A MESA RELE^ A OPERACAO (D-021). A mesma mesa orfa, o mesmo ficheiro: tira-se a `leitura` do
  //    instrumento e as voltas SEGUINTES tem de decidir `nada` pelo motivo da leitura ausente
  //    (`leitura_ausente_no_ciclo`). Era esta a prova que faltava: o defeito medido a 30/09/2026 foi a mesa
  //    decidir 44 vezes sobre o MESMO retrato (a operacao era lida uma vez, no arranque). Uma mesa que so'
  //    lesse uma vez continuaria a decidir sobre a leitura que ja' nao esta' no ficheiro, e esta prova
  //    reprovava — e' essa a diferenca que ela mede.
  const semLeitura = JSON.parse(JSON.stringify(operacao));
  delete semLeitura.instrumentos[instrumento].leitura;
  semLeitura.nota = "duble de operacao: a leitura SAIU do ficheiro (D-021)";
  writeFileSync(caminhos.operacao, JSON.stringify(semLeitura));
  await espera(900); // voltas suficientes (tick 120 ms) para a mudanca aparecer no ledger

  const depoisDaTroca = voltas(lerLinhas(caminhos.ledger)).slice(antes.length + novas.length);
  const peloMotivo = depoisDaTroca.filter((l: any) => l.motivo === "leitura_ausente_no_ciclo");
  conferir("orfandade/D-021: a mesa RELE^ a operacao - tirar a leitura do ficheiro muda a decisao seguinte",
    depoisDaTroca.length >= 2 && peloMotivo.length === depoisDaTroca.length,
    `voltas depois da troca=${depoisDaTroca.length} · pelo motivo novo=${peloMotivo.length} · ${JSON.stringify(depoisDaTroca.slice(0, 3).map((l: any) => [l.acao, l.motivo]))}`);

  // 5. O REGRESSO (T029): um vigia novo le o estado da mesa no ledger dela e nao arranca nada.
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
