#!/usr/bin/env bun
// O OPERADOR — o processo que liga o conector aos setups, por conta, e escreve o ficheiro de operação.
//
// PORQUE EXISTE. Medido, e era o portão para o primeiro setup: o conector JÁ emite a leitura ao vivo, a mesa JÁ
// sabe lê-la do ficheiro de operação, e o setup JÁ sabe falar o contrato — mas **ninguém escrevia o ficheiro**.
// Faltava esta peça, e é ela que fecha o circuito:
//
//   conector (processo) --stdout--> OPERADOR --ficheiro--> mesa (ciclo)
//                                    |
//                                    +--setup (processo, a língua que declarar)--> proposta
//
// ELE É MULTIPAR, E É UMA CONTA INTEIRA. O operador não recebe "um par": recebe o **nome da conta**, vai às
// fichas dessa conta (`fichas/<CONTA>/<PAR>-<setup>.json`), e trabalha as que estão com `run: true`. Desligar um
// par é editar uma linha da ficha, não mexer em código. E cada par traz o SEU relógio (o `relogio` do cabeçalho):
// o mesmo setup corre a 1h num par e a 30m noutro, porque quem decide o relógio é a ficha, não o assistente.
//
// O QUE AQUI NÃO SE FAZ, e é a razão de esta peça ser pequena:
//   * não se decide nada — o operador não avalia a proposta nem a corrige; leva o que o setup disse à mesa;
//   * não se calcula sinal — quem calcula é o setup, e o operador não sabe o que é uma média;
//   * não se inventa leitura — par sem leitura do conector entra na operação SEM `leitura` (a mesa trata como
//     `sem_leitura`, RN-D7), nunca com a leitura anterior, que seria mentira com ar de fresca;
//   * não se vê o risco — ao setup vai só o que ele precisa: as CONSTANTES do indicador e o `run`. O
//     `saldo_pct`, a `alavancagem` e as bandas ficam do lado da mesa (RN-M4.1: o setup nunca os vê).
//
// O RELÓGIO É UM SÓ. O setup é uma CHAMADA com resposta, nunca um processo com vida própria: dois relógios dariam
// duas respostas à pergunta "quando é que esta decisão aconteceu?", uma delas fora do registo.
//
// Uso:
//   bun run vigia/operador.ts --conta hl-real-sol \
//        --para /tmp/operacao.json --tick 60000 --voltas 6 [--par SOL] [--mercado <pasta>] [--dias 30]
//
// Repare que NÃO há `--setup`: quem diz qual setup serve cada par é a ficha (`cabecalho.setup`). É assim que um
// operador só serve setups diferentes em pares diferentes da mesma conta.

import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { validar, versaoVigente } from "../contracts/esqueleto/framing.ts";
import { derivarCloid } from "../brokers/hyperliquid/cloid.ts";

const RAIZ = join(import.meta.dir, "..");
const argv = process.argv.slice(2);
const arg = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i < 0 ? undefined : argv[i + 1];
};
function morrer(mensagem: string): never {
  console.error(JSON.stringify({ etapa: "operador", veredicto: "recusado", porque: mensagem }));
  process.exit(2);
}
function dizer(o: unknown): void {
  console.log(JSON.stringify(o));
}

const nomeDaConta = arg("--conta") ?? morrer("falta `--conta <nome da conta>` (as fichas vivem em fichas/<nome>/)");
const para = arg("--para") ?? morrer("falta `--para <ficheiro de operacao>`");
const soOPar = arg("--par") ?? null; // opcional: sem ele, percorre TODAS as fichas ligadas da conta
// OS NUMEROS POR OMISSAO DO OPERADOR, com nome. Eram `arg("--tick") ?? "60000"` (e companhia): o valor por
// omissao de uma opcao de linha de comando e' uma declaracao do instrumento, e uma declaracao escrita como
// literal solto no meio do argumento nao se le nem se muda - passa a ter nome, e o nome diz o que e'.
const TICK_POR_OMISSAO_MS = 60_000;
const VOLTAS_POR_OMISSAO = 1;
const DIAS_DE_HISTORICO_POR_OMISSAO = 30;
const tickMs = arg("--tick") === undefined ? TICK_POR_OMISSAO_MS : Number(arg("--tick"));
const voltasPedidas = arg("--voltas") === undefined ? VOLTAS_POR_OMISSAO : Number(arg("--voltas"));
const pastaDoMercado = arg("--mercado") ?? null;
const diasDeHistorico = arg("--dias") === undefined ? DIAS_DE_HISTORICO_POR_OMISSAO : Number(arg("--dias"));
const caminhoDaCredencial = join(RAIZ, "config", "contas", `${nomeDaConta}.json`);
// O AMBIENTE da conta manda nas velas tambem: ler o livro da testnet e as barras da producao da' um `mid`
// contra um preco que nao e' o do venue onde se opera — centimos, mas centimos contam quando a banda e' 0.25 ATR.
const ambienteDaConta = ((): "teste" | "producao" => {
  try {
    const c = JSON.parse(readFileSync(caminhoDaCredencial, "utf8"));
    return c?.conexao?.ambiente === "producao" ? "producao" : "teste";
  } catch {
    return "teste";
  }
})();
if (!existsSync(caminhoDaCredencial)) {
  morrer(`nao existe a credencial da conta ${nomeDaConta} (${caminhoDaCredencial}): a ficha diz o NOME da conta, o ficheiro da conta guarda a chave — e a chave nao mora nas fichas`);
}

// ---------------------------------------------------------------------------------------------------------
// AS FICHAS DA CONTA — quem manda é o `run` da ficha, e cada uma traz o seu relógio.

interface Ficha {
  cabecalho: Record<string, any>;
  constantes: Record<string, any>;
  ficheiro: string;
  setup: string;
  pastaDoSetup: string;
}
/**
 * As fichas de uma conta: `fichas/<SETUP>/<PAR>-<CONTA>.json`.
 *
 * O nome é para o olho e o cabeçalho é a verdade — e é por isso que se CONFERE que os dois dizem a mesma
 * conta: um ficheiro renomeado (ou copiado de outra conta sem lhe mudar o cabeçalho) passaria a mentir em
 * silêncio, e é exactamente o género de mentira que não se vê no registo.
 */
/**
 * O MAPA DE MARCAS — cloid -> marca -> ficha (RN-T16.1, D-008). FICHEIRO, append-only, ao lado da operacao.
 *
 * Cada linha e' uma ordem NOSSA que o venue aceitou: o `cloid` que seguiu, a marca que a mesa compunha, a
 * referencia e o instrumento. E' daqui que sai `marcas_nossas_conhecidas` — a resposta a' pergunta "esta posicao
 * e' nossa?" — e e' isto que faz a mesa reconhecer e GERIR a posicao que ela propria abriu.
 *
 * Append-only de proposito: e' um registo de auditoria, e um registo que se reescreve deixa de o ser. Uma linha
 * ilegivel RECUSA a leitura do mapa (nao se salta por cima dela: um mapa com buracos diz "esta posicao nao e'
 * nossa" com a mesma cara com que diz a verdade).
 */
function caminhoDasMarcas(): string {
  return join(dirname(para), `marcas-${nomeDaConta}.jsonl`);
}
function lerMarcas(): { cloid: string; marca: number; referencia: string; instrumento: string; quando: string }[] {
  const caminho = caminhoDasMarcas();
  if (!existsSync(caminho)) return [];
  const linhas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");
  return linhas.map((l) => {
    try {
      return JSON.parse(l) as { cloid: string; marca: number; referencia: string; instrumento: string; quando: string };
    } catch {
      morrer(`o mapa de marcas (${caminho}) tem uma linha ilegivel: um mapa com buracos decide a posse por engano`);
    }
  });
}
/** As marcas que esta conta conhece PARA ESTE INSTRUMENTO: e' o que a operacao leva a mesa. */
function marcasConhecidasDaConta(instrumento: string): number[] {
  return [...new Set(lerMarcas().filter((m) => m.instrumento === instrumento).map((m) => m.marca))];
}
function apontarMarca(m: { cloid: string; marca: number; referencia: string; instrumento: string }): void {
  const linha = JSON.stringify({ ...m, quando: new Date().toISOString() }) + "\n";
  appendFileSync(caminhoDasMarcas(), linha);
}

function lerFichasDaConta(nome: string): Ficha[] {
  const raiz = join(RAIZ, "fichas");
  if (!existsSync(raiz)) morrer(`nao existe a pasta de fichas (${raiz}): um par sem ficha nao e' operado`);
  const fichas: Ficha[] = [];
  for (const pasta of readdirSync(raiz).sort()) {
    const caminhoDaPasta = join(raiz, pasta);
    if (!statSync(caminhoDaPasta).isDirectory()) continue;
    for (const ficheiro of readdirSync(caminhoDaPasta).sort()) {
      if (!ficheiro.endsWith(".json")) continue;
      const f = JSON.parse(readFileSync(join(caminhoDaPasta, ficheiro), "utf8"));
      if (f?.cabecalho === undefined || f?.constantes === undefined) {
        morrer(`${pasta}/${ficheiro} nao tem cabecalho e constantes: um ficheiro por par, com o cabecalho padrao primeiro`);
      }
      for (const campo of ["conta", "instrumento", "relogio", "run", "setup", "enviar"] as const) {
        if (f.cabecalho[campo] === undefined) morrer(`${pasta}/${ficheiro} nao declara \`${campo}\` no cabecalho`);
      }
      if (f.cabecalho.conta !== nome) continue;   // ficha de outra conta: nao e' desta corrida
      const esperado = `${f.cabecalho.instrumento}-${f.cabecalho.conta}.json`;
      if (ficheiro !== esperado) {
        morrer(`${pasta}/${ficheiro}: o nome nao bate com o cabecalho (esperado \`${esperado}\`). O nome e' para o olho, o cabecalho e' a verdade, e um ficheiro renomeado mentiria em silencio`);
      }
      if (f.cabecalho.setup !== pasta) {
        morrer(`${pasta}/${ficheiro}: o cabecalho diz \`setup: ${f.cabecalho.setup}\` e a pasta diz \`${pasta}\`: um dos dois mente`);
      }
      const pastaDoSetup = join("setups", String(f.cabecalho.setup));
      if (!existsSync(join(RAIZ, pastaDoSetup, "setup.json"))) {
        morrer(`${pasta}/${ficheiro}: o setup \`${f.cabecalho.setup}\` nao existe em ${pastaDoSetup}/setup.json`);
      }
      fichas.push({ cabecalho: f.cabecalho, constantes: f.constantes, ficheiro: `${pasta}/${ficheiro}`, setup: String(f.cabecalho.setup), pastaDoSetup });
    }
  }
  return fichas;
}

const todas = lerFichasDaConta(nomeDaConta);
const ligadas = todas.filter((f) => f.cabecalho.run === true && (soOPar === null || f.cabecalho.instrumento === soOPar));

/**
 * A ULTIMA PROPOSTA RECEBIDA, por instrumento — e o instante em que chegou.
 *
 * O setup propoe UMA VEZ por barra fechada e cala-se: a proposta existe no ficheiro durante uma leitura so'.
 * A mesa relê a operacao em cada volta, e sem esta memoria podia nunca a ver. Nao ha aqui juizo nenhum sobre a
 * idade dela: a barra viaja dentro da proposta e quem a julga e' a mesa, com motivo proprio.
 */
const ultimaProposta = new Map<string, { carga: unknown; recebida_ms: number } | null>();
dizer({
  etapa: "operador", conta: nomeDaConta, fichas: todas.length,
  ligadas: ligadas.map((f) => `${f.cabecalho.instrumento}-${f.cabecalho.setup} (${f.cabecalho.relogio})`),
  setups: [...new Set(ligadas.map((f) => f.setup))],
  desligadas: todas.filter((f) => f.cabecalho.run !== true).map((f) => f.ficheiro),
});
if (ligadas.length === 0) {
  dizer({ etapa: "operador", veredicto: "nada_a_fazer", porque: `nenhuma ficha com run=true na conta ${nomeDaConta}` });
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------
// O MANIFESTO DO SETUP — a única coisa que o operador precisa de saber dele: como se arranca.

interface ManifestoDoSetup {
  nome: string;
  versao: string;
  linguagem: string;
  comando: string[];
  template?: Record<string, unknown>;
  nota?: string;
}
function lerManifestoDoSetup(pasta: string): ManifestoDoSetup {
  const caminho = join(RAIZ, pasta, "setup.json");
  if (!existsSync(caminho)) morrer(`o setup nao declara \`setup.json\` em ${pasta}: sem ele nao se sabe como o arrancar`);
  const m = JSON.parse(readFileSync(caminho, "utf8")) as ManifestoDoSetup;
  for (const campo of ["nome", "versao", "linguagem", "comando"] as const) {
    if (m[campo] === undefined || m[campo] === null) morrer(`o \`setup.json\` de ${pasta} nao declara \`${campo}\``);
  }
  if (!Array.isArray(m.comando) || m.comando.length === 0) morrer(`\`comando\` de ${pasta} tem de ser um argv nao vazio`);
  return m;
}
/**
 * O TEMPLATE TEM DUAS CARAS, e confundi-las custou uma recusa (medida: a mesa recebeu
 * `tipo: {tipo:"escolha", opcoes:["mercado"], omissao:"mercado"}` e o contrato recusou com
 * `parcial_nao_declarada`). O `template` do `setup.json` e' o que se PUBLICA (o descritor de cada item, para o
 * questionario e a tela); o que a MESA consome sao os VALORES. Aqui resolvem-se: o valor e' a omissao declarada,
 * e a ficha do par pode troca-lo pelas suas constantes.
 */
function resolverTemplate(manifesto: ManifestoDoSetup, ficha: Ficha): Record<string, unknown> {
  const valores: Record<string, unknown> = {};
  // O MANIFESTO SEM TEMPLATE NAO E' UM TEMPLATE VAZIO. `manifesto.template ?? {}` devolvia zero valores: a
  // mesa recebia uma operacao sem constante nenhuma e decidia sobre um setup que nao declarou nada — o genero
  // de vazio que passa por "nao ha nada a declarar". O template e' o que o setup PUBLICA (o resto da
  // configuracao da mesa sai dele), e um setup que o nao publica nao esta' pronto a ser corrido.
  const template: unknown = manifesto.template;
  if (template === undefined || template === null || typeof template !== "object" || Array.isArray(template)) {
    morrer(`o setup ${ficha.setup} nao publica \`template\` no seu setup.json (veio ${String(template)}): sem template nao ha valores a resolver, e a mesa decidiria com a ficha pela metade`);
  }
  for (const [campo, descritor] of Object.entries(template as Record<string, unknown>)) {
    const d = descritor as Record<string, unknown> | null;
    const chave = campo.replace(/^constantes\./, "");
    const daFicha = (ficha.constantes as Record<string, unknown>)[chave];
    if (daFicha !== undefined) valores[campo] = daFicha;
    else if (d !== null && typeof d === "object" && "omissao" in d) valores[campo] = d.omissao;
    else valores[campo] = descritor;
  }
  return valores;
}

// Um manifesto POR SETUP, carregado à medida (a conta pode correr setups diferentes em pares diferentes).
const manifestos = new Map<string, ManifestoDoSetup>();
function manifestoDe(f: Ficha): ManifestoDoSetup {
  let m = manifestos.get(f.setup);
  if (m === undefined) { m = lerManifestoDoSetup(f.pastaDoSetup); manifestos.set(f.setup, m); }
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// AS VELAS — pedidas no RELÓGIO DA FICHA. Uma actualização por (instrumento, relógio).

if (pastaDoMercado !== null) {
  for (const f of ligadas) {
    const relogio = String(f.cabecalho.relogio);
    const instrumento = String(f.cabecalho.instrumento);
    void 0;
    const pedido = spawn("bun", ["run", join(RAIZ, "brokers", "hyperliquid", "mercado.ts"),
      "--velas", instrumento, "--intervalo", relogio, "--dias", String(diasDeHistorico),
      "--ambiente", ambienteDaConta, "--para-pasta", pastaDoMercado, "--actualizar"],
      { cwd: RAIZ, env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    let queixa = "";
    pedido.stderr.on("data", (b) => (queixa += b.toString()));
    const codigo = await new Promise<number | null>((r) => pedido.on("close", (c) => r(c)));
    if (codigo !== 0) {
      dizer({ etapa: "operador", aviso: "as velas nao se actualizaram", instrumento, relogio, codigo, queixa: queixa.slice(-300) });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// O SETUP: um processo por CHAMADA. Recebe a leitura no stdin, devolve a `proposta` no stdout.

function correrSetup(leitura: unknown, ficha: Ficha, manifesto: ManifestoDoSetup): Promise<{ proposta: unknown | null; erro: string | null; respondeu: boolean }> {
  return new Promise((resolve) => {
    // As CONSTANTES e o relógio do par — e mais nada da ficha. O risco não passa por aqui (RN-M4.1).
    const p = spawn(manifesto.comando[0]!, manifesto.comando.slice(1), {
      cwd: join(RAIZ, ficha.pastaDoSetup),
      env: {
        ...process.env,
        CONSTANTES: JSON.stringify(ficha.constantes),
        INSTRUMENTO: String(ficha.cabecalho.instrumento),
        RELOGIO: String(ficha.cabecalho.relogio),
        // A PASTA DAS VELAS so' entra no ambiente se o operador a tiver declarado. Era `pastaDoMercado ?? ""`, e
        // uma pasta vazia e' um caminho que nao existe: o setup ia recusar mais tarde com "nao existe o ficheiro
        // de velas do par" — o SINTOMA, e nao a causa. Sem a variavel, o setup diz o que falta a serio (a pasta),
        // pelo `exigido()` dele (setups/sigma/plugin.ts).
        ...(pastaDoMercado === null ? {} : { PASTA_DE_MERCADO: pastaDoMercado }),
        // O ESTADO DO SETUP: e' ele que sabe em que barra ja' entrou este par. Vive junto da operacao, e
        // sobrevive a reinicios — se vivesse na memoria do processo, um reinicio abria outra vez na mesma barra.
        PASTA_DE_ESTADO: join(dirname(para), "estado"),
      },
    });
    let erro: string | null = null;
    let saida = "";
    const dec = new TextDecoder();
    p.stdout.on("data", (b) => (saida += dec.decode(b)));
    p.stderr.on("data", (b) => {
      const t = dec.decode(b).trim();
      if (t !== "") erro = t.slice(0, 400);
    });
    p.on("close", (codigo) => {
      // A proposta procura-se pela FORMA DO CONTRATO, e valida-se contra ele: uma linha que o contrato recusaria
      // não é proposta, e o operador não a "arranja".
      for (const linha of saida.split("\n")) {
        if (linha.trim() === "") continue;
        let obj: any;
        try {
          obj = JSON.parse(linha);
        } catch {
          continue;
        }
        if (obj?.tipo === "proposta") {
          const r = validar(linha);
          if (r.veredicto === "aceite") return resolve({ proposta: obj, erro, respondeu: codigo === 0 });
          return resolve({ proposta: null, erro: `a proposta do setup nao passa o contrato: ${r.motivo}`, respondeu: false });
        }
      }
      // SEM PROPOSTA, MAS TENDO RESPONDIDO: o setup correu ate' ao fim e nao propoe NESTA volta. E' o caso
      // normal do `sigma`, que propoe UMA vez por barra fechada; o `codigo` diz se o processo correu (0) ou
      // se rebentou/silenciou (nao-zero) — e sao coisas diferentes.
      return resolve({ proposta: null, erro, respondeu: codigo === 0 });
    });
    p.stdin.write(JSON.stringify(leitura) + "\n");
    p.stdin.end();
  });
}

// ---------------------------------------------------------------------------------------------------------
// A OPERAÇÃO — escrita ATÓMICA: temporário + rename. Uma leitura a meio de uma escrita daria à mesa um mundo
// que não existiu, e a mesa decide sobre esta leitura.

function escreverOperacao(conteudo: unknown): void {
  const dir = dirname(para);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const temporario = `${para}.tmp-${process.pid}`;
  writeFileSync(temporario, JSON.stringify(conteudo, null, 1) + "\n");
  renameSync(temporario, para);
}

// AS FALHAS DA LEITURA, por instrumento, ditas pelo conector (as `ausentes_do_mercado`). Sem isto a operacao
// nao declara o que a leitura nao trouxe — e o ciclo, com razao, recusa decidir.
const ausentesDoMercado = new Map<string, string[]>();
const portasVistas: { porta: string; veredicto: string; motivo?: string | null }[] = [];
function gravarPortas(): void {
  const falhadas = portasVistas.filter((o) => o.veredicto !== "passou" && o.veredicto !== "nao_corrida");
  const desfecho = {
    passam: portasVistas.length > 0 && falhadas.length === 0,
    porta: falhadas[0]?.porta ?? null,
    motivo: falhadas[0]?.motivo ?? null,
  };
  const caminho = `${para}.portas.json`;
  const temporario = `${caminho}.tmp-${process.pid}`;
  writeFileSync(temporario, JSON.stringify(desfecho) + "\n");
  renameSync(temporario, caminho);
}

async function main(): Promise<void> {
  const casos = join(RAIZ, "brokers", "hyperliquid", "casos", "processo.casos.json");
  const conector = spawn("bun", ["run", join(RAIZ, "brokers", "hyperliquid", "processo.ts"),
    "--casos", casos, "--ficha", `@${caminhoDaCredencial}`, "--ao-vivo", "--leitura-a-cada", String(tickMs)],
    { cwd: RAIZ, env: process.env });

  // ---- O CARTEIRO: a mao que aperta o gatilho --------------------------------------------------------
  //
  // A mesa decide e escreve a BOLETA na linha do ciclo do registo (que e' append-only). Quem a leva ao conector
  // e' este processo, que ja' tem o `stdin` dele. E so' a leva se a FICHA daquele par o autorizar: o cabecalho
  // traz `enviar: true|false`, e nada sai por omissao — sem essa autorizacao a boleta fica no registo e
  // REGISTA-SE por que' nao saiu. Nao ha caminho em que uma ordem saia sem o dono a ter escrito numa ficha.
  const envios = new Map<string, { marca: number; referencia: string; instrumento: string; recusado: boolean }>();
  let posicaoNoRegisto = 0;
  const caminhoDoRegisto = join(dirname(para), "registo.jsonl");
  const caminhoDosDesfechos = join(dirname(para), `desfechos-${nomeDaConta}.jsonl`);

  function levarBoletas(): void {
    if (!existsSync(caminhoDoRegisto)) return;
    const texto = readFileSync(caminhoDoRegisto, "utf8");
    if (texto.length <= posicaoNoRegisto) return;
    const novas = texto.slice(posicaoNoRegisto).split("\n").filter((l) => l.trim() !== "");
    posicaoNoRegisto = texto.length;
    for (const l of novas) {
      let o: any;
      try {
        o = JSON.parse(l);
      } catch {
        continue; // linha a meio de escrita: le'-se na volta seguinte
      }
      if (o?.tipo !== "ciclo" || o?.boleta === null || o?.boleta === undefined) continue;
      const instrumento = String(o.instrumento);
      const boleta = o.boleta as Record<string, unknown>;
      // A REFERENCIA E' OBRIGATORIA: sem ela nao ha cloid a derivar, nem ordem a reconciliar depois. Uma boleta
      // que nao a traga e' um defeito NOSSO (a mesa compoe-a sempre) e diz-se, em vez de se inventar uma chave.
      const referenciaBruta = boleta.referencia_do_cliente;
      if (referenciaBruta === undefined || referenciaBruta === null || String(referenciaBruta) === "") {
        dizer({ etapa: "carteiro", instrumento, enviei: false,
                porque: "a boleta do registo veio sem `referencia_do_cliente`: sem referencia nao ha ordem a levar" });
        continue;
      }
      const referencia = String(referenciaBruta);
      if (referencia === "" || envios.has(referencia)) continue; // sem referencia nao ha ordem; e nao se repete
      const ficha = ligadas.find((f) => String(f.cabecalho.instrumento) === instrumento);
      const autorizado = ficha !== undefined && ficha.cabecalho.enviar === true;
      const marca = Number(boleta.marca_de_posse);
      envios.set(referencia, { marca, referencia, instrumento, recusado: !autorizado });
      if (!autorizado) {
        dizer({ etapa: "carteiro", instrumento, referencia, enviei: false,
                porque: ficha === undefined
                  ? `o par ${instrumento} nao esta' ligado: a boleta fica no registo`
                  : `a ficha de ${instrumento} diz \`enviar: ${JSON.stringify(ficha.cabecalho.enviar)}\`: a boleta fica no registo` });
        continue;
      }
      const linha = JSON.stringify({ contrato: versaoVigente(), tipo: "boleta", id: referencia, carga: boleta });
      conector.stdin.write(linha + "\n");
      dizer({ etapa: "carteiro", instrumento, referencia, enviei: true, marca });
    }
  }
  const carteiro = setInterval(levarBoletas, 5000);

  const dec = new TextDecoder();
  let buffer = "";
  let voltas = 0;
  let aFechar = false;
  // O PRAZO (D-017): uma leitura que nao vem nao pode deixar a operacao por escrever para sempre. Ao fim de
  // `LEITURAS_INUTEIS` leituras que nao servem nenhum par ligado, escreve-se a operacao com o que existe — os
  // pares sem leitura entram SEM `leitura` (sem_leitura, RN-D7), que e' a verdade, em vez de silencio.
  const LEITURAS_INUTEIS = 3;
  let inuteis = 0;

  const terminar = () => {
    if (aFechar) return;
    aFechar = true;
    try {
      conector.kill();
    } catch {
      // o processo ja' nao existe: nada a fazer, e nao se inventa um erro
    }
    dizer({ etapa: "operador", veredicto: "fim", voltas, operacao: para, setups: [...new Set(ligadas.map((f) => `${f.setup} ${manifestoDe(f).versao} (${manifestoDe(f).linguagem})`))] });
    process.exit(0);
  };

  // AS PORTAS DO ARRANQUE: o operador recolhe o desfecho delas e grava-o onde a mesa o vai ler. Sem este
  // ficheiro a mesa RECUSA o `start` (nomeando `nao conferidas`) — e faz bem.
  conector.stderr.on("data", (b) => {
    for (const l of dec.decode(b).split("\n")) {
      if (l.trim() === "") continue;
      try {
        const o = JSON.parse(l);
        if (o.porta) {
          portasVistas.push({ porta: o.porta, veredicto: o.veredicto, motivo: o.motivo ?? null });
          gravarPortas();
        }
        if (o.etapa === "ausentes_do_mercado" && typeof o.instrumento === "string") {
          ausentesDoMercado.set(o.instrumento, Array.isArray(o.ausentes) ? o.ausentes : []);
        }
      } catch {
        // Linha que nao e' JSON de porta: e' o RESTO do diagnostico do conector, e imprime-se. Engoli-lo foi
        // o que me deixou cego quando o conector arrancava e nao entregava leitura: o operador registava o
        // silencio e o conector sabia a razao. (D-019.)
        const limpa = l.trim();
        if (limpa !== "") console.error(`[conector] ${limpa.slice(0, 400)}`);
      }
    }
  });

  conector.stdout.on("data", async (b) => {
    buffer += dec.decode(b);
    const pedacos = buffer.split("\n");
    buffer = pedacos.pop()!;
    for (const linha of pedacos) {
      if (linha.trim() === "") continue;
      let msg: any;
      try {
        msg = JSON.parse(linha);
      } catch {
        continue;
      }
      if (msg?.tipo !== "mercado") {
        // O conector tambem fala pelo STDOUT (as `etapa` do diagnostico), e isso nao e' leitura. Imprime-se:
        // foi por nao o fazer que uma leitura de outro nome passou despercebida esta noite. (D-019, segunda metade.)
        // O DESFECHO DA ORDEM QUE SAIU: registado num ficheiro proprio do operador (o registo da mesa tem um
        // vocabulario fechado e um desfecho NAO e' uma linha da mesa — quem enviou foi o carteiro).
        const o = (() => {
          try { return JSON.parse(linha); } catch { return null; }
        })();
        const id = o?.id === undefined ? "" : String(o.id);
        if (envios.has(id) && (o?.tipo === "desfecho" || o?.tipo === "resolucao")) {
          const envio = envios.get(id)!;
          const derivado = derivarCloid(String(nomeDaConta), envio.instrumento, envio.referencia);
          appendFileSync(caminhoDosDesfechos, JSON.stringify({ quando: new Date().toISOString(), ...envio, desfecho: o.carga }) + "\n");
          if (derivado.ok && o?.tipo === "desfecho" && (o.carga?.classificacao === "aceita" || o.carga?.classificacao === "preenchida")) {
            apontarMarca({ cloid: derivado.cloid, marca: envio.marca, referencia: envio.referencia, instrumento: envio.instrumento });
          }
        }
        console.error(`[conector] ${linha.slice(0, 300)}`);
        continue;
      }
      const instrumento = String(msg.carga?.instrumento);
      // AS FICHAS SAO RELIDAS A CADA LEITURA: uma ficha nova entra sozinha, sem reiniciar o operador (o pedido
      // do dono: "se tivesse uma ficha de eth ... ele nao precisa de reinicio"). Uma leitura por minuto: a
      // releitura custa um `readdir` e poupa um reinicio.
      const agoraLigadas = lerFichasDaConta(nomeDaConta).filter(
        (f) => f.cabecalho.run === true && (soOPar === null || f.cabecalho.instrumento === soOPar),
      );
      const ficha = ligadas.find((f) => String(f.cabecalho.instrumento) === instrumento);
      if (ficha === undefined) {
        // Par que o conector leu e a conta nao tem ligado: nao serve. E se isto se repetir, os pares ligados
        // que ninguem le' ficam a espera de nada — o prazo corta isso.
        inuteis += 1;
        if (inuteis >= LEITURAS_INUTEIS) {
          const instrumentos: Record<string, unknown> = {};
          for (const f of agoraLigadas) {
            const nome = String(f.cabecalho.instrumento);
            instrumentos[nome] = {
              ficha: `${f.setup}_v${String(manifestoDe(f).versao).split(".")[0]}`,
              template: resolverTemplate(manifestoDe(f), f),
              parametros: f.constantes,
              risco: { saldo_pct: f.cabecalho.saldo_pct, alavancagem: f.cabecalho.alavancagem, bandas: f.cabecalho.bandas, prazo_de_resposta_ms: f.cabecalho.prazo_de_resposta_ms },
              erro_do_setup: `prazo esgotado: ${inuteis} leituras seguidas sem nenhuma para este par (o conector le outros instrumentos?)`,
            };
          }
          escreverOperacao({
            nota: `escrito pelo operador (PRAZO, D-017) · ${new Date().toISOString()} · conta ${nomeDaConta} · nenhuma leitura para os pares ligados`,
            ligacao: "sem_leitura",
            instrumentos,
          });
          dizer({ etapa: "operador", veredicto: "prazo", leituras_inuteis: inuteis, operacao: para, ligadas: ligadas.map((f) => f.cabecalho.instrumento) });
          return terminar();
        }
        continue;
      }
      // A ULTIMA PROPOSTA POR INSTRUMENTO — e a barra dela.
      //
      // O setup fala UMA VEZ por barra e cala-se nas voltas seguintes: a proposta vive no ficheiro durante uma
      // leitura e mais nenhuma. Como a mesa relê a operacao a cada volta (era aqui que ela vivia de um retrato),
      // sem esta memoria a proposta podia nao ser vista por ninguem — e uma entrada perdida por uma corrida de
      // ficheiros e' uma perda que so' se descobre horas depois, no registo. Guarda-se com a barra que o setup
      // declarou: quem decide se ela ainda e' desta barra e' a MESA (motivo `proposta_de_barra_antiga`).
      if (!ultimaProposta.has(String((msg.carga as any)?.instrumento))) ultimaProposta.set(String((msg.carga as any)?.instrumento), null);
      inuteis = 0;
      if (voltas >= voltasPedidas) return terminar();
      voltas += 1;

      // A LEITURA VAI NA FORMA COMPACTA, que é a que o ciclo lê: o venue chama-lhe `estado` e o contrato do
      // ciclo chama-lhe `estado_do_mercado` — foi isto que fez o ciclo recusar a primeira operação escrita
      // (`mercado/m-1: campo_obrigatorio_ausente`). Converte-se AQUI, num sítio só, e não se "arranja" o
      // contrato para acomodar o nome do venue.
      const doVenue = msg.carga as Record<string, unknown>;
      const leitura: Record<string, unknown> = {
        instrumento: doVenue.instrumento,
        tempo_do_venue_ms: doVenue.tempo_do_venue_ms,
        idade_do_dado_ms: doVenue.idade_do_dado_ms,
        estado_do_mercado: doVenue.estado,
        equity: doVenue.equity,
      };
      // AS ORDENS VIVAS (contrato 1.9.0): vao com a leitura, sem serem tocadas — o conector ja' as validou
      // contra o contrato antes de as emitir, e a mesa precisa delas para saber o que esta' pendurado.
      leitura.ordens_abertas = doVenue.ordens_abertas;
      for (const campo of ["bid", "ask", "ultimo", "posicao"] as const) {
        if (doVenue[campo] !== undefined) leitura[campo] = doVenue[campo];
      }

      const manifestoDaFicha = manifestoDe(ficha);
      const { proposta, erro, respondeu } = await correrSetup(msg, ficha, manifestoDaFicha);
      // Guarda-se a proposta que acabou de chegar, com o instante em que chegou (auditoria: quando o setup
      // falou, e nao so' o que disse). A barra vai dentro da propria proposta (contrato 1.8.0).
      if (proposta !== null) {
        ultimaProposta.set(String((msg.carga as any)?.instrumento), {
          carga: (proposta as any).carga,
          recebida_ms: Date.now(),
        });
      }

      // A OPERAÇÃO LEVA TODAS AS FICHAS LIGADAS, e não só a que falou nesta volta: a mesa decide, por ciclo,
      // sobre o que está na operação — e um par ligado que desaparecesse do ficheiro era um par que a mesa
      // deixava de ver. O par sem leitura entra SEM `leitura` (sem_leitura, RN-D7), nunca com a anterior.
      const instrumentos: Record<string, unknown> = {};
      for (const f of agoraLigadas) {
        const nome = String(f.cabecalho.instrumento);
        const eOGueFalou = nome === instrumento;
        instrumentos[nome] = {
          ...(eOGueFalou ? { leitura } : {}),
          // AS FALHAS: ou o conector disse que nao houve nenhuma ausencia (mapa sem entrada = leitura completa,
          // e o operador nao a inventa), ou vao as que ele declarou. Sem leitura, sem falhas.
          // AS FALHAS, na forma do contrato: a leitura que existe nao falhou; o setup respondeu SE RESPONDEU
          // — e "respondeu" e' o processo do setup ter CORRIDO ate' ao fim (`respondeu`, do codigo de saida e
          // da validade da resposta), nunca o ter proposto algo.
          //
          // Era `proposta !== null`, e era um defeito de traducao com consequencias: o `sigma` propoe UMA vez
          // por barra fechada e nas outras voltas cala-se DE PROPOSITO — e cada um desses silencios entrava
          // aqui como `setup_respondeu: false`, o que poe o instrumento em `congelada` (nao abre, NAO FECHA,
          // e avisa o dono). Medido na observacao de 30/09/2026: 11 voltas seguidas `congelada` com o setup a
          // funcionar exactamente como devia. Uma posicao viva ficava sem defesa por causa de uma traducao.
          falhas: eOGueFalou ? { leitura: false, setup_respondeu: respondeu } : { leitura: true },
          divergente: eOGueFalou ? false : false,
          // AS MARCAS DE POSSE QUE A MESA CONHECE (RN-T16.1, D-008): do mapa marca -> ficha, que se constroi
          // do que NOS enviamos (a boleta + a resolucao). Sem marca conhecida a posicao le-se como ALHEIA, e
          // a mesa nao a gere. O campo vai sempre declarado — a mesa RECUSA a operacao que o nao traga.
          marcas_nossas_conhecidas: marcasConhecidasDaConta(nome),
          // O RELOGIO DA FICHA: e' ele que define a barra, e sem barra a mesa nao tem como travar uma segunda
          // entrada na mesma (D-021). O relogio da config manda na ordem.
          relogio: String(f.cabecalho.relogio),
          ficha: `${f.setup}_v${String(manifestoDe(f).versao).split(".")[0]}`,
          template: resolverTemplate(manifestoDe(f), f),
          parametros: f.constantes,
          // À mesa vai a parte operacional do cabeçalho; ao setup foi só `constantes` (RN-M4.1).
          risco: {
            saldo_pct: f.cabecalho.saldo_pct,
            alavancagem: f.cabecalho.alavancagem,
            bandas: f.cabecalho.bandas,
            prazo_de_resposta_ms: f.cabecalho.prazo_de_resposta_ms,
          },
          // A PROPOSTA E' A ULTIMA RECEBIDA, nao so' a desta volta: o setup cala-se depois de falar, e a mesa
          // so' ve' o que estiver escrito. A barra dela viaja dentro da proposta, e e' a mesa que decide se
          // ainda e' desta barra.
          ...(ultimaProposta.get(nome) != null
            ? {
                proposta: (ultimaProposta.get(nome) as { carga: unknown }).carga,
                proposta_recebida_ms: (ultimaProposta.get(nome) as { recebida_ms: number }).recebida_ms,
              }
            : {}),
          ...(eOGueFalou && erro !== null ? { erro_do_setup: erro } : {}),
        };
      }
      // A CONFIG DA MESA, gerada das fichas (o `--config` do core ainda le a ficha num objecto so', D-014).
      // E' uma VISTA: os valores vem das fichas, e nenhum e' inventado aqui.
      const fichasParaAMesa: Record<string, unknown> = {};
      for (const f of ligadas) {
        fichasParaAMesa[String(f.cabecalho.instrumento)] = {
          saldo_pct: f.cabecalho.saldo_pct,
          alavancagem: f.cabecalho.alavancagem,
          bandas: f.cabecalho.bandas,
          versao_do_mandato: `${f.setup}_v${String(manifestoDe(f).versao).split(".")[0]}`,
          setup: { prazo_de_resposta_ms: f.cabecalho.prazo_de_resposta_ms },
        };
      }
      writeFileSync(`${para}.config.json`, JSON.stringify({
        _nota: "vista das fichas para a mesa (D-014: o core ainda le a ficha num objecto so'). Nao editar a mao.",
        // A LISTA DO DONO, no TOPO (FR-042): sem ela a mesa rebenta o ciclo, e faz bem - avisar por omissao
        // era a mesa a escolher pelo dono.
        eventos_que_avisam: ["cb", "encerramento", "desconhecido", "recusa", "divergencia", "falha_de_leitura", "contenda"],
        arranque_apos_cb: "exige_decisao",
        fichas: fichasParaAMesa,
      }, null, 1) + "\n");

      escreverOperacao({
        nota: `escrito pelo operador · ${new Date().toISOString()} · conta ${nomeDaConta} · conector hyperliquid · setups ${[...new Set(agoraLigadas.map((f) => `${f.setup} ${manifestoDe(f).versao}`))].join(", ")}`,
        ligacao: "ligada",
        instrumentos,
      });
      dizer({
        etapa: "operador", volta: voltas, conta: nomeDaConta, instrumento,
        equity: (msg.carga as any).equity, bid: (msg.carga as any).bid, ask: (msg.carga as any).ask,
        lado_da_proposta: (proposta as any)?.carga?.lado ?? null, proposta_do_setup: proposta !== null,
        setup_falou: erro, operacao: para,
      });
      if (voltas >= voltasPedidas) return terminar();
    }
  });
  conector.on("close", () => terminar());
}

await main();
