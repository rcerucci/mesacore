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
import { cloidDoPreenchimento } from "../brokers/hyperliquid/cloid.ts";
import {
  enviosJaRegistados,
  jaSaiu,
  reconstruirMapaDeMarcas,
  type EnvioRegistado,
  type ReconstrucaoDoMapa,
} from "./arranque.ts";

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
/**
 * O FICHEIRO DOS DESFECHOS desta conta — ao lado da operacao, como o mapa e o registo. E' aqui que o operador
 * grava o que o venue respondeu a' ordem que ele levou, e e' AQUI que o arranque le' o que ja' saiu (o desfecho
 * e' a prova de envio) e o que reconstroi o mapa de marcas.
 */
function caminhoDoFicheiroDosDesfechos(): string {
  return join(dirname(para), `desfechos-${nomeDaConta}.jsonl`);
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
 * AS FICHAS LIGADAS AGORA — relidas do disco.
 *
 * Era uma lista de arranque (`ligadas`, um `const`) usada em sítios onde tinha de ser a de agora: o pedido ao
 * setup, a config da mesa, a autorização do carteiro. Medido em 30/09/2026 (ensaio `tools/observar-multipar.sh`):
 * ligar um par a quente punha-o na operação (porque a operação já relia) e NÃO o punha na config da mesa — e a
 * mesa, ao ver um instrumento sem mandato, RECUSA e rebenta (`instrumento sem mandato do dono`). Meio-quente é
 * pior do que frio: derruba quem está a trabalhar. Agora há uma só fonte, e é a do agora.
 */
function fichasLigadasAgora(): Ficha[] {
  return lerFichasDaConta(nomeDaConta).filter(
    (f) => f.cabecalho.run === true && (soOPar === null || f.cabecalho.instrumento === soOPar),
  );
}

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
// AS VELAS — pedidas no RELÓGIO DA FICHA, e GARANTIDAS NO CICLO.
//
// O QUE ISTO ERA, E O DEFEITO QUE FAZIA (medido a 30/09/2026, com `tools/observar-multipar.sh`): as velas eram
// puxadas UMA VEZ, no arranque, sobre as fichas ligadas naquele instante. Duas consequências, as duas más:
//   * um par ligado a quente (ficha com `run: true` a meio da corrida) nunca tinha velas — e o plugin, sem
//     ficheiro de velas, não propõe (e faz bem), mas o par nunca entrava;
//   * numa corrida LONGA o ficheiro ficava parado na barra do arranque: o setup decidia sobre barras velhas, a
//     barra nunca rolava, e a trava de «uma entrada por barra» (D-021) bloqueava tudo para sempre.
// Agora as velas de cada par activo são garantidas NO CICLO: puxa-se quando o ficheiro falta, e quando já há uma
// barra fechada que o ficheiro não tem — uma vez por barra, não uma vez por volta.
const MS_DO_RELOGIO: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
  "4h": 14_400_000, "1d": 86_400_000,
};
/** Quando se puxou cada par (por instrumento E relógio: o relógio da ficha pode mudar), para não se repetir. */
const puxadasEm = new Map<string, number>();

/**
 * O MANDATO QUE A ÚLTIMA CONFIG ESCRITA DECLAROU — o que a mesa ainda pode ter em mãos.
 *
 * Serve à ordem das escritas (o bloco das três escritas, no fim de cada volta): a união do mandato novo com este
 * é o que garante que nenhuma leitura intermédia da config fica sem um par que a operação ainda reporta.
 */
let mandatoEscrito: Record<string, unknown> | null = null;

/**
 * AS LEITURAS DA VOLTA EM CURSO, por par — e é isto que faz a mesa poder decidir sobre QUALQUER par.
 *
 * O conector entrega UMA leitura por par e por ciclo (`--leitura-a-cada`), e o operador escreve a operação a cada
 * entrega. A operação levava a leitura do par que falou nessa volta e `falhas: { leitura: true }` nos outros —
 * e como o conector lê os pares por ordem alfabética, o ÚLTIMO a escrever era sempre o mesmo. Medido na corrida de
 * 30/09/2026 (2 pares, H1): o BTC foi lido com números em 5 voltas seguidas e a mesa viu-o **4 em 4 ciclos**
 * como `sem_leitura` — logo nunca podia decidir sobre ele. Um par lido e não decidível é um par que não existe.
 *
 * A leitura de um par vale enquanto for do CICLO DE LEITURA EM CURSO (`tickMs`): passado um ciclo inteiro sem
 * ele falar, o par não tem leitura NESTA volta e a operação di-lo. É o que a RN-D7 quer dizer com «nunca a
 * anterior» — o ausente é ausente, e não é o retrato que já lá estava.
 */
const leiturasDaVolta = new Map<string, { leitura: Record<string, unknown>; recebida_ms: number; respondeu: boolean }>();
const VALIDADE_DA_LEITURA_MS = tickMs;

/**
 * AS RETIRADAS, par a par: um par que estava ligado e deixou de estar, e o que a ficha dele manda fazer à posição.
 *
 * Decisão do dono (30/09/2026): **retirar um par FECHA a posição dele** — a retirada e o fecho são o mesmo acto, e
 * um par retirado com posição viva seria uma posição sem ninguém a governá-la. Enquanto o fecho não estiver
 * cumprido o par FICA NA OPERAÇÃO (com a proposta `caixa`, que é o fecho a mercado da casa) e o carteiro continua
 * autorizado a levá-lo; só quando ele estiver plano é que o par sai — e sai com linha no log.
 *
 * Sem `ao_desligar` declarado na ficha, vale a regra do dono (fechar). `ao_desligar: "manter"` é uma declaração
 * EXPLÍCITA de deixar a posição viva, e então o par sai e o log diz que a posição ficou — não se cala.
 */
const retiradas = new Map<string, { desde_ms: number; fechar: boolean; motivo: string }>();
let ligadasNaVoltaAnterior: string[] = [];

/** Detecta as retiradas desta volta e alimenta `retiradas`. Um par que desapareça do disco também é uma retirada,
 *  e essa FECHA: a regra do dono não pode depender de a ficha ainda existir para ser lida — desaparecer a ficha
 *  de um par com posição viva é o caso em que a posição mais precisa de ser fechada. */
function registarRetiradas(ligadasAgora: string[]): void {
  const todas = lerFichasDaConta(nomeDaConta);
  for (const nome of ligadasNaVoltaAnterior) {
    if (ligadasAgora.includes(nome) || retiradas.has(nome)) continue;
    const ficha = todas.find((f) => String(f.cabecalho.instrumento) === nome);
    const declarado: unknown = ficha?.cabecalho.ao_desligar;
    if (declarado !== undefined && declarado !== "fechar" && declarado !== "manter") {
      throw new Error(
        `a ficha de ${nome} declara \`ao_desligar: ${JSON.stringify(declarado)}\`: os valores sao "fechar" ou ` +
          "\"manter\" — um valor que nao se entende nao se adivinha, porque o que esta' em jogo e' uma posicao viva",
      );
    }
    const fechar = declarado !== "manter";
    const motivo = ficha === undefined
      ? "a ficha desapareceu do disco com o par ligado: fecha-se pela regra do dono"
      : declarado === "manter"
        ? "a ficha diz `ao_desligar: manter`: o par sai e a posicao fica"
        : "retirado a quente: a posicao fecha com a retirada (regra do dono)";
    retiradas.set(nome, { desde_ms: Date.now(), fechar, motivo });
    dizer({ etapa: "operador", instrumento: nome, veredicto: fechar ? "retirado_a_fechar" : "retirado_a_manter", porque: motivo });
  }
  ligadasNaVoltaAnterior = ligadasAgora;
}

function caminhoDasVelas(ficha: Ficha): string | null {
  if (pastaDoMercado === null) return null;
  return join(pastaDoMercado, `velas-${String(ficha.cabecalho.instrumento)}-${String(ficha.cabecalho.relogio)}.jsonl`);
}

async function puxarVelas(ficha: Ficha): Promise<boolean> {
  const instrumento = String(ficha.cabecalho.instrumento);
  const relogio = String(ficha.cabecalho.relogio);
  const pedido = spawn("bun", ["run", join(RAIZ, "brokers", "hyperliquid", "mercado.ts"),
    "--velas", instrumento, "--intervalo", relogio, "--dias", String(diasDeHistorico),
    "--ambiente", ambienteDaConta, "--para-pasta", String(pastaDoMercado), "--actualizar"],
    { cwd: RAIZ, env: process.env, stdio: ["ignore", "ignore", "pipe"] });
  let queixa = "";
  pedido.stderr.on("data", (b) => (queixa += b.toString()));
  const codigo = await new Promise<number | null>((r) => pedido.on("close", (c) => r(c)));
  if (codigo !== 0) {
    dizer({ etapa: "operador", aviso: "as velas nao se actualizaram", instrumento, relogio, codigo, queixa: queixa.slice(-300) });
    return false;
  }
  return true;
}

/**
 * AS VELAS DESTE PAR ESTÃO PRONTAS? Puxa-as se não estiverem, e diz se ficaram.
 *
 * Três razões para puxar, e só três: (a) o ficheiro não existe (par ligado agora); (b) a última barra do
 * ficheiro já fechou e já passou um passo inteiro desde ela — há barra nova para buscar; (c) nunca se puxou
 * este par nesta corrida. O tecto de uma puxada por passo evita bater no venue a cada volta quando ele não tem
 * barras novas (um instrumento novo, ou um intervalo sem negócio).
 *
 * Sem pasta de mercado, ou com um relógio que a tabela não conhece, isto devolve `false` e NÃO puxa nada: quem
 * decide o que fazer com a ausência é quem chama — aqui não se inventa um caminho nem um intervalo.
 */
async function garantirVelas(ficha: Ficha): Promise<boolean> {
  const instrumento = String(ficha.cabecalho.instrumento);
  const relogio = String(ficha.cabecalho.relogio);
  const passo = MS_DO_RELOGIO[relogio];
  const caminho = caminhoDasVelas(ficha);
  if (caminho === null || passo === undefined) return false;
  const agora = Date.now();
  const existe = existsSync(caminho);
  let precisa = !existe;
  if (existe) {
    // A ÚLTIMA BARRA do ficheiro. Sem tempo na última linha, o ficheiro não é um ficheiro de velas: pára-se aqui
    // em vez de se decidir «está velho» ou «está fresco» a partir de um valor que não se leu.
    const linhas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");
    const ultima: unknown = linhas.length > 0 ? (JSON.parse(linhas[linhas.length - 1]!) as { t?: unknown }).t : undefined;
    if (typeof ultima !== "number" || !Number.isFinite(ultima)) {
      throw new Error(
        `o ficheiro de velas de ${instrumento} (${caminho}) tem uma ultima linha sem tempo: sem barra nao se ` +
          "sabe se o ficheiro esta' actual, e uma leitura que nao se sabe nao serve para decidir",
      );
    }
    precisa = agora >= ultima + 2 * passo;
  }
  const chave = `${instrumento}-${relogio}`;
  const ultimaPuxada = puxadasEm.get(chave);
  if (precisa) {
    // Já se puxou neste passo? Não se repete. Sem marca no mapa não há puxada anterior — é a primeira, e a
    // primeira tem de acontecer (não há aqui valor por omissão: a ausência da marca É a informação).
    if (ultimaPuxada !== undefined && agora - ultimaPuxada < passo) return existe;
    puxadasEm.set(chave, agora);
    return await puxarVelas(ficha);
  }
  return true;
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

/** A leitura do venue na FORMA COMPACTA que o ciclo lê: o venue chama-lhe `estado` e o contrato do ciclo
 *  chama-lhe `estado_do_mercado` — foi isto que fez o ciclo recusar a primeira operação escrita
 *  (`mercado/m-1: campo_obrigatorio_ausente`). Converte-se num sítio só, e não se «arranja» o contrato para
 *  acomodar o nome do venue. */
function leituraCompacta(doVenue: Record<string, unknown>): Record<string, unknown> {
  const leitura: Record<string, unknown> = {
    instrumento: doVenue.instrumento,
    tempo_do_venue_ms: doVenue.tempo_do_venue_ms,
    idade_do_dado_ms: doVenue.idade_do_dado_ms,
    estado_do_mercado: doVenue.estado,
    equity: doVenue.equity,
  };
  // AS ORDENS VIVAS (contrato 1.9.0): vao com a leitura, sem serem tocadas — o conector ja' as validou contra o
  // contrato antes de as emitir, e a mesa precisa delas para saber o que esta' pendurado.
  leitura.ordens_abertas = doVenue.ordens_abertas;
  for (const campo of ["bid", "ask", "ultimo", "posicao"] as const) {
    if (doVenue[campo] !== undefined) leitura[campo] = doVenue[campo];
  }
  return leitura;
}

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

  // ---- O ARRANQUE: o que os desfechos ja' gravados dizem ao processo que agora nasce -------------------
  //
  // Duas leituras do MESMO ficheiro (`desfechos-<conta>.jsonl`), antes de o conector arrancar, porque as duas
  // respondem a perguntas que o processo perdeu ao morrer:
  //
  //   (a) O QUE JA' SAIU. O registo le'-se desde o inicio (`posicaoNoRegisto = 0`, mais abaixo) e o carteiro
  //       levava todas as boletas que encontrasse — incluindo a abertura ja' preenchida. A prova de envio e' o
  //       DESFECHO GRAVADO (o registo nao guarda nenhum campo que o diga): semeia-se com ele o mapa `envios`,
  //       que e' o que `levarBoletas` consulta antes de entregar a boleta ao conector.
  //   (b) O MAPA QUE FALTA. O mapa so' ganhava linhas em runtime: depois de um reinicio ficava vazio, e a
  //       posicao ABERTA lia-se SEM marca — alheia, relatada e nao gerida. Reconstroi-se dos desfechos
  //       confirmados, com a MESMA funcao do runtime (`cloidDoPreenchimento`), e o ficheiro fica no lugar
  //       ANTES de o conector arrancar (e' ele que o le', pelo `MARCAS_DA_CONTA`).
  //
  // Um desfecho que nao se le' RECUSA o arranque inteiro (`morrer`): arrancar com um buraco no registo das
  // ordens e' reenviar o que nao devia, ou ler como alheia uma posicao que e' nossa.
  const caminhoDosDesfechos = caminhoDoFicheiroDosDesfechos();
  let jaEnviados: Map<string, EnvioRegistado>;
  let reconstrucao: ReconstrucaoDoMapa;
  try {
    jaEnviados = enviosJaRegistados(caminhoDosDesfechos);
    reconstrucao = reconstruirMapaDeMarcas(caminhoDosDesfechos, caminhoDasMarcas());
  } catch (e) {
    morrer(`o arranque nao se pode fazer a partir dos desfechos: ${e instanceof Error ? e.message : String(e)}`);
  }
  dizer({
    etapa: "operador", arranque: "desfechos_relembrados",
    desfechos_lidos: reconstrucao.desfechos_lidos,
    referencias_ja_enviadas: [...jaEnviados.keys()],
    marcas_reconstruidas: reconstrucao.marcas_reconstruidas,
    marcas_ja_no_mapa: reconstrucao.marcas_ja_no_mapa,
    desfechos_que_nao_confirmam: reconstrucao.desfechos_que_nao_confirmam,
    mapa: caminhoDasMarcas(),
  });

  // O CAMINHO DO MAPA DE MARCAS VAI NO AMBIENTE DO CONECTOR — sem isto o mapa escreve-se e ninguem o le'.
  //
  // A leitura de mercado (`leitura-do-mercado.ts`, `mapaDeMarcas()`) le' o caminho de `MARCAS_DA_CONTA`, e o
  // conector e' filho DESTE processo: o ambiente dele passa por aqui. Era `env: process.env`, e ninguem punha
  // `MARCAS_DA_CONTA` la' — mesmo com o mapa escrito (a marca registada ao confirmar o preenchimento), a
  // posicao chegava a mesa SEM marca, e uma posicao sem marca e' alheia. O caminho e' O MESMO ficheiro que
  // este processo escreve (`caminhoDasMarcas()`): nao se inventa formato nenhum, liga-se o que ja' existia.
  const conector = spawn("bun", ["run", join(RAIZ, "brokers", "hyperliquid", "processo.ts"),
    "--casos", casos, "--ficha", `@${caminhoDaCredencial}`, "--ao-vivo", "--leitura-a-cada", String(tickMs)],
    { cwd: RAIZ, env: { ...process.env, MARCAS_DA_CONTA: caminhoDasMarcas() } });
  // O `stderr` DO CONECTOR É DRENADO — e isto é uma correcção, não um enfeite. Era um `pipe` que ninguém lia:
  // (a) os diagnósticos dele (as portas, as leituras recusadas) eram INVISÍVEIS no registo do operador — e foi
  // isso que deixou sem resposta a pergunta «porque é que o BTC não foi lido depois de a ficha dele ligar?» no
  // ensaio de 30/09/2026; (b) um `pipe` cheio bloqueia quem escreve nele, logo o conector podia parar por
  // ninguém ler. Drena-se para o nosso `stderr`, que é o ficheiro onde o operador já escreve.
  conector.stderr.on("data", (b: Buffer) => process.stderr.write(b));

  // ---- O CARTEIRO: a mao que aperta o gatilho --------------------------------------------------------
  //
  // A mesa decide e escreve a BOLETA na linha do ciclo do registo (que e' append-only). Quem a leva ao conector
  // e' este processo, que ja' tem o `stdin` dele. E so' a leva se a FICHA daquele par o autorizar: o cabecalho
  // traz `enviar: true|false`, e nada sai por omissao — sem essa autorizacao a boleta fica no registo e
  // REGISTA-SE por que' nao saiu. Nao ha caminho em que uma ordem saia sem o dono a ter escrito numa ficha.
  const envios = new Map<string, EnvioRegistado>();
  // A MEMORIA DO ARRANQUE ENTRA AQUI, ANTES DE O CARTEIRO CORRER: as referencias que os desfechos provam que
  // ja' sairam ficam no mesmo mapa que o carteiro consulta. E' o que faz o reenvio da boleta ja' preenchida
  // parar (ver `vigia/arranque.ts`) — sem isto, o registo era relido desde o inicio e a ordem saia outra vez.
  for (const [referencia, envio] of jaEnviados) envios.set(referencia, envio);
  let posicaoNoRegisto = 0;
  const caminhoDoRegisto = join(dirname(para), "registo.jsonl");

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
      if (referencia === "") continue; // sem referencia nao ha ordem a levar
      // JA' SAIU? A boleta que tem DESFECHO GRAVADO nao se reenvia: o desfecho e' a prova de que ela chegou ao
      // venue (o registo nao guarda nenhum campo que o diga, e inventa-lo seria a mesa a escrever o que so' o
      // carteiro sabe). Isto fecha o reenvio de arranque: o registo e' relido desde o inicio, e sem esta
      // paragem a abertura ja' preenchida saia OUTRA VEZ — uma ordem a mais, no venue, na conta do dono.
      if (jaSaiu(referencia, envios)) {
        dizer({ etapa: "carteiro", instrumento, referencia, enviei: false,
                porque: "esta boleta ja' tem desfecho gravado: o arranque releu o registo e NAO a reenvia" });
        continue;
      }
      // A FICHA DE AGORA, relida — e a da CONTA (nao so' as ligadas): um par retirado continua a precisar de
      // levar o FECHO da posicao, e a ficha dele e' que diz o que a retirada manda.
      const ficha = lerFichasDaConta(nomeDaConta).find((f) => String(f.cabecalho.instrumento) === instrumento);
      const emRetiradaAFechar = retiradas.get(instrumento)?.fechar === true;
      // O INTERRUPTOR MANDA, e o fecho de uma retirada NAO e' excepcao a ele: a ficha diz `ao_desligar: fechar`
      // (o fecho faz parte da retirada) mas `enviar: false` continua a significar "nada sai". Quando as duas
      // coisas se cruzam, o fecho nao sai e o carteiro DI-LO — uma posicao viva em maos tem de se ler no log.
      const autorizado = ficha !== undefined && ficha.cabecalho.enviar === true;
      const marca = Number(boleta.marca_de_posse);
      envios.set(referencia, { marca, referencia, instrumento, recusado: !autorizado });
      if (!autorizado) {
        dizer({ etapa: "carteiro", instrumento, referencia, enviei: false,
                porque: ficha === undefined
                  ? `a ficha de ${instrumento} nao existe nesta conta: a boleta fica no registo`
                  : emRetiradaAFechar
                    ? `o par foi RETIRADO e a ficha manda fechar a posicao (\`ao_desligar: fechar\`), mas diz \`enviar: ${JSON.stringify(ficha.cabecalho.enviar)}\`: o fecho NAO saiu e a posicao fica em maos`
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
          appendFileSync(caminhoDosDesfechos, JSON.stringify({ quando: new Date().toISOString(), ...envio, desfecho: o.carga }) + "\n");
          // A MARCA E' NOSSA QUANDO O VENUE CONFIRMA — E A CHAVE E' A QUE ELE GUARDOU.
          //
          // O DEFEITO QUE ISTO CORRIGE (medido a 01/10/2026, conta `hl-teste-plugin`): a ordem
          // `61581177468` foi preenchida (0.00117 @ 84367.0) e o venue devolveu a NOSSA marca no `cloid`
          // (`resposta_do_venue.bruto.cloid = 0xbf62594cce5cacfd083dd6d15cd97aa8`) — e o mapa de marcas
          // ficou VAZIO, por duas razoes:
          //
          //   1. a guarda comparava a classificacao com `aceita`/`preenchida`, palavras que o conjunto
          //      FECHADO do contrato NAO tem (`contracts/vocabulario.json`: `aceite`, nunca `aceita`) —
          //      nenhum desfecho passava, e o mapa nunca se escrevia;
          //   2. a chave registada era o `cloid` DERIVADO AQUI, do NOME da conta — e o conector deriva-o do
          //      ENDERECO (`estado.ficha.conta`): valores diferentes (medido: `0xbf62594c...` do venue
          //      contra `0x349994e8...` do nome). A leitura cruza o mapa com o `cloid` que o venue publica
          //      em `userFills`: so' a chave DELE liga a posicao a marca.
          //
          // Sem marca, a posicao le-se como ALHEIA: a mesa relatou a posicao que ela propria abriu e nao a
          // geriu durante 121 ciclos. Quem decide o que se faz a uma posicao ALHEIA nao muda (fica como
          // esta', em `core/ciclo/ciclo.ts`); o que muda e' a mesa passar a reconhecer a sua.
          if (o?.tipo === "desfecho") {
            const confirmado = cloidDoPreenchimento(o.carga);
            if (confirmado.ok) {
              apontarMarca({ cloid: confirmado.cloid, marca: envio.marca, referencia: envio.referencia, instrumento: envio.instrumento });
              dizer({ etapa: "carteiro", instrumento: envio.instrumento, referencia: envio.referencia, marca: envio.marca,
                      marca_registada: true, cloid: confirmado.cloid });
            } else {
              dizer({ etapa: "carteiro", instrumento: envio.instrumento, referencia: envio.referencia, marca: envio.marca,
                      marca_registada: false, porque: confirmado.porque });
            }
          }
        }
        console.error(`[conector] ${linha.slice(0, 300)}`);
        continue;
      }
      const instrumento = String(msg.carga?.instrumento);
      // AS FICHAS SÃO RELIDAS A CADA LEITURA, E É ESTA A LISTA QUE MANDA: uma ficha nova entra sozinha, sem
      // reiniciar o operador (o pedido do dono: "se tivesse uma ficha de eth ... ele nao precisa de reinicio").
      // Reler custa um `readdir` por leitura e poupa um reinicio — e é a mesma lista que vai na operação E na
      // config da mesa, que era o que faltava para o par ligado a quente não fazer a mesa recusar.
      const agoraLigadas = fichasLigadasAgora();
      // AS FICHAS DA CONTA, RELIDAS AGORA — as mesmas que a operação e a config vão usar, e que incluem as fichas
      // de pares RETIRADOS (precisas enquanto a posição deles não estiver fechada).
      const fichasDaConta = lerFichasDaConta(nomeDaConta);
      // AS RETIRADAS DESTA VOLTA (antes de tudo o resto): quem estava ligado e deixou de estar entra em
      // `retiradas`, e o que a ficha dele manda fazer à posição fica decidido aqui, uma vez.
      registarRetiradas(agoraLigadas.map((f) => String(f.cabecalho.instrumento)));
      const ficha = agoraLigadas.find((f) => String(f.cabecalho.instrumento) === instrumento);
      if (ficha === undefined) {
        // UM PAR DA CONTA QUE NAO ESTA' LIGADO NESTA VOLTA (retirado, ou a fechar): a leitura dele nao e' "inutil"
        // — e' a leitura de um par que esta' a ser retirado, e quem a trata e' o bloco das retiradas. Contar isto
        // como inutil MATAVA A CORRIDA: tres voltas de um par retirado e o operador escrevia `prazo` e terminava.
        const conhecidoDaConta = fichasDaConta.some((f) => String(f.cabecalho.instrumento) === instrumento);
        if (conhecidoDaConta) {
          // A LEITURA GUARDA-SE, mesmo sem o par estar ligado: e' ela que diz ao bloco da retirada se a posicao
          // ja' esta' plana. Sem isto, um par retirado ficava preso para sempre — na operacao, sem leitura e sem
          // fecho, porque o bloco da retirada nunca sabia se havia posicao. (`respondeu: false` porque o setup
          // deste par NAO foi perguntado nesta volta: e' a verdade, e nao um valor por omissao.)
          leiturasDaVolta.set(instrumento, {
            leitura: leituraCompacta(msg.carga as Record<string, unknown>),
            recebida_ms: Date.now(),
            respondeu: false,
          });
          dizer({ etapa: "operador", instrumento, veredicto: "par_nao_ligado",
                  porque: "o par esta' na conta mas nao esta' ligado: quem trata da leitura dele e' a retirada" });
          continue;
        }
        // Par que o conector leu e a conta nao tem: nao serve. E se isto se repetir, os pares ligados
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

      const leitura = leituraCompacta(msg.carga as Record<string, unknown>);

      const manifestoDaFicha = manifestoDe(ficha);
      // AS VELAS DESTE PAR, GARANTIDAS AGORA. Sem velas o setup não propõe (e diz por quê) — mas um par ligado
      // a quente não pode ficar à espera de um ficheiro que só se puxava no arranque. Puxa-se aqui, e a operação
      // sai na mesma: o par entra com a leitura e SEM proposta, que é a verdade.
      let proposta: unknown | null = null;
      let erro: string | null = null;
      let respondeu = false;
      if (await garantirVelas(ficha)) {
        ({ proposta, erro, respondeu } = await correrSetup(msg, ficha, manifestoDaFicha));
      } else {
        erro =
          `as velas de ${instrumento} no relogio ${String(ficha.cabecalho.relogio)} nao estao prontas: ` +
          "sem barras nao se pede proposta ao setup";
        dizer({ etapa: "operador", instrumento, veredicto: "sem_velas", porque: erro });
      }
      // Guarda-se a proposta que acabou de chegar, com o instante em que chegou (auditoria: quando o setup
      // falou, e nao so' o que disse). A barra vai dentro da propria proposta (contrato 1.8.0).
      if (proposta !== null) {
        ultimaProposta.set(String((msg.carga as any)?.instrumento), {
          carga: (proposta as any).carga,
          recebida_ms: Date.now(),
        });
      }
      // A LEITURA DESTA VOLTA ENTRA NO MAPA DO CICLO. É isto que faz os OUTROS pares serem decidíveis: sem ela, a
      // operação saía com a leitura de um par e o silêncio nos restantes (ver a nota do `leiturasDaVolta`).
      leiturasDaVolta.set(instrumento, { leitura, recebida_ms: Date.now(), respondeu });

      // A OPERAÇÃO LEVA TODAS AS FICHAS LIGADAS, e não só a que falou nesta volta: a mesa decide, por ciclo,
      // sobre o que está na operação — e um par ligado que desaparecesse do ficheiro era um par que a mesa
      // deixava de ver. O par sem leitura entra SEM `leitura` (sem_leitura, RN-D7), nunca com a anterior.
      const instrumentos: Record<string, unknown> = {};
      for (const f of agoraLigadas) {
        const nome = String(f.cabecalho.instrumento);
        const eOGueFalou = nome === instrumento;
        // A LEITURA DESTE PAR: a que acabou de chegar (se foi ele a falar), ou a do MESMO ciclo de leitura (se
        // falou primeiro — o conector entrega uma por par e por ciclo). Fora do ciclo não há leitura, e a operação
        // di-lo; o que não se faz é servir um retrato antigo como se fosse de agora.
        const guardada = leiturasDaVolta.get(nome);
        const fresca =
          guardada !== undefined && Date.now() - guardada.recebida_ms <= VALIDADE_DA_LEITURA_MS ? guardada : null;
        instrumentos[nome] = {
          ...(fresca !== null ? { leitura: fresca.leitura } : {}),
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
          falhas: fresca !== null ? { leitura: false, setup_respondeu: fresca.respondeu } : { leitura: true },
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

      // ------------------------------------------------------------------------------------------------
      // OS PARES EM RETIRADA QUE AINDA TÊM POSIÇÃO FICAM NA OPERAÇÃO — com o fecho a mercado proposto.
      //
      // Decisão do dono (30/09/2026): a retirada de um par e o fecho da posição dele são o MESMO acto. Um par que
      // saísse da operação com posição viva ficava sem ninguém a governá-la. Enquanto o fecho não estiver cumprido o
      // par continua a ser reportado (com `caixa`), o mandato continua a governá-lo (a config inclui-o) e o carteiro
      // continua autorizado a levar a boleta. `caixa` é um dos quatro lados do contrato (RN-T4) e é o fecho a
      // mercado da casa — o mesmo que o encerramento usa.
      for (const [nome, r] of [...retiradas]) {
        if (agoraLigadas.some((f) => String(f.cabecalho.instrumento) === nome)) continue; // ainda ligado: nao e' retirada
        const guardada = leiturasDaVolta.get(nome);
        const fresca =
          guardada !== undefined && Date.now() - guardada.recebida_ms <= VALIDADE_DA_LEITURA_MS ? guardada : null;
        const posicao = fresca === null ? undefined : (fresca.leitura as Record<string, unknown>).posicao;
        if (!r.fechar) {
          dizer({ etapa: "operador", instrumento: nome, veredicto: "retirado_com_posicao_em_maos", porque: r.motivo });
          retiradas.delete(nome);
          continue;
        }
        if (fresca !== null && (posicao === undefined || posicao === null)) {
          dizer({ etapa: "operador", instrumento: nome, veredicto: "retirada_cumprida",
                  porque: "sem posicao viva: o par sai da operacao" });
          retiradas.delete(nome);
          continue;
        }
        const fichaDaRetirada = fichasDaConta.find((f) => String(f.cabecalho.instrumento) === nome);
        if (fichaDaRetirada === undefined) {
          dizer({ etapa: "operador", instrumento: nome, veredicto: "retirada_sem_ficha",
                  porque: "a ficha desapareceu: sem ela o par nao tem mandato (RN-A1) e a operacao nao o pode reportar — a posicao fica por fechar" });
          continue;
        }
        const passo = MS_DO_RELOGIO[String(fichaDaRetirada.cabecalho.relogio)];
        const instanteDoVenue = fresca === null ? null : Number((fresca.leitura as Record<string, unknown>).tempo_do_venue_ms);
        const barra = passo === undefined || instanteDoVenue === null || !Number.isFinite(instanteDoVenue)
          ? undefined
          : Math.floor(instanteDoVenue / passo) * passo;
        instrumentos[nome] = {
          ...(fresca !== null ? { leitura: fresca.leitura } : {}),
          falhas: fresca !== null ? { leitura: false } : { leitura: true },
          divergente: false,
          marcas_nossas_conhecidas: marcasConhecidasDaConta(nome),
          relogio: String(fichaDaRetirada.cabecalho.relogio),
          ficha: `${fichaDaRetirada.setup}_v${String(manifestoDe(fichaDaRetirada).versao).split(".")[0]}`,
          template: resolverTemplate(manifestoDe(fichaDaRetirada), fichaDaRetirada),
          parametros: fichaDaRetirada.constantes,
          risco: {
            saldo_pct: fichaDaRetirada.cabecalho.saldo_pct,
            alavancagem: fichaDaRetirada.cabecalho.alavancagem,
            bandas: fichaDaRetirada.cabecalho.bandas,
            prazo_de_resposta_ms: fichaDaRetirada.cabecalho.prazo_de_resposta_ms,
          },
          ...(barra === undefined
            ? {}
            : {
                proposta: {
                  setup: { nome: fichaDaRetirada.setup, versao: manifestoDe(fichaDaRetirada).versao },
                  lado: "caixa",
                  barra_ms: barra,
                },
              }),
        };
        dizer({ etapa: "operador", instrumento: nome, veredicto: "retirada_a_fechar",
                porque: barra === undefined
                  ? "sem leitura (ou sem instante do venue) nesta volta: o fecho nao se pode compor — a conta tem de continuar a ler o par (`conta.instrumentos`)"
                  : "posicao viva: o par fica na operacao com o fecho a mercado proposto (`caixa`)" });
      }

      // A CONFIG DA MESA, gerada das fichas (o `--config` do core ainda le a ficha num objecto so', D-014).
      // E' uma VISTA: os valores vem das fichas, e nenhum e' inventado aqui.
      //
      // E É A MESMA LISTA QUE VAI NA OPERAÇÃO (`agoraLigadas`): um par que a operação reporta e a config não
      // governa faz a mesa RECUSAR a operação inteira e morrer (`instrumento sem mandato do dono: BTC`), medido
      // a 30/09/2026. Operação e config saem sempre do mesmo conjunto, ou não sai nenhuma.
      const fichasParaAMesa: Record<string, unknown> = {};
      // AS LIGADAS **E** AS EM RETIRADA QUE AINDA FECHAM: o mandato tem de governar tudo o que a operação
      // reporta — e a operação reporta os pares em retirada até a posição deles estar fechada (senão a mesa
      // recusava a operação inteira, que é o modo de falha que já se pagou uma vez).
      for (const f of [...agoraLigadas, ...fichasDaConta.filter((f) => retiradas.has(String(f.cabecalho.instrumento)))]) {
        fichasParaAMesa[String(f.cabecalho.instrumento)] = {
          saldo_pct: f.cabecalho.saldo_pct,
          alavancagem: f.cabecalho.alavancagem,
          bandas: f.cabecalho.bandas,
          versao_do_mandato: `${f.setup}_v${String(manifestoDe(f).versao).split(".")[0]}`,
          setup: { prazo_de_resposta_ms: f.cabecalho.prazo_de_resposta_ms },
        };
      }
      // -----------------------------------------------------------------------------------------------
      // A ORDEM DAS ESCRITAS É UM PROTOCOLO — a mesa relê o mandato a cada volta (`core/servidor.ts`).
      //
      // Entre a escrita da config e a da operação há um instante em que a mesa pode ler as duas. Se a config
      // chegasse primeiro SEM um par que a operação ainda reporta, a mesa recusava a operação inteira e morria
      // (`instrumento sem mandato do dono`) — uma armadilha pronta a disparar de cada vez que o dono desligasse um
      // par a quente. Escreve-se por isso em três tempos: (1) a UNIÃO do mandato anterior com o novo, (2) a
      // operação, (3) o mandato final. Nenhuma leitura intermédia tem um par na operação que a config não governe.
      const escreverConfig = (fichas: Record<string, unknown>): void => {
        writeFileSync(`${para}.config.json`, JSON.stringify({
          _nota: "vista das fichas para a mesa (D-014: o core ainda le a ficha num objecto so'). Nao editar a mao.",
          // A LISTA DO DONO, no TOPO (FR-042): sem ela a mesa rebenta o ciclo, e faz bem - avisar por omissao
          // era a mesa a escolher pelo dono.
          eventos_que_avisam: ["cb", "encerramento", "desconhecido", "recusa", "divergencia", "falha_de_leitura", "contenda"],
          arranque_apos_cb: "exige_decisao",
          fichas,
        }, null, 1) + "\n");
      };
      // (1) O MANDATO QUE COBRE TUDO: o novo, mais o anterior — um par que SAI fica coberto até a operação deixar
      // de o reportar, e um par que ENTRA já está coberto quando a operação o reportar.
      const mandatoQueCobreTudo: Record<string, unknown> = {};
      for (const [instrumento, ficha] of Object.entries(fichasParaAMesa)) mandatoQueCobreTudo[instrumento] = ficha;
      if (mandatoEscrito !== null) {
        for (const [instrumento, ficha] of Object.entries(mandatoEscrito)) {
          if (!(instrumento in mandatoQueCobreTudo)) mandatoQueCobreTudo[instrumento] = ficha;
        }
      }
      escreverConfig(mandatoQueCobreTudo);

      // (2) A OPERAÇÃO.
      escreverOperacao({
        nota: `escrito pelo operador · ${new Date().toISOString()} · conta ${nomeDaConta} · conector hyperliquid · setups ${[...new Set(agoraLigadas.map((f) => `${f.setup} ${manifestoDe(f).versao}`))].join(", ")}`,
        ligacao: "ligada",
        instrumentos,
      });
      // (3) O MANDATO FINAL. Só é uma escrita diferente quando algum par SAIU (na união ele ainda estava) — e é
      // esta a escrita que o tira: depois dela a operação já não o reporta, logo o mandato pode deixar de o cobrir.
      if (Object.keys(mandatoQueCobreTudo).length !== Object.keys(fichasParaAMesa).length) {
        escreverConfig(fichasParaAMesa);
      }
      mandatoEscrito = fichasParaAMesa;
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
