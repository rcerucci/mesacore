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
import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { validar } from "../contracts/esqueleto/framing.ts";

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
const tickMs = Number(arg("--tick") ?? "60000");
const voltasPedidas = Number(arg("--voltas") ?? "1");
const pastaDoMercado = arg("--mercado") ?? null;
const diasDeHistorico = Number(arg("--dias") ?? "30");
const caminhoDaCredencial = join(RAIZ, "config", "contas", `${nomeDaConta}.json`);
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
      for (const campo of ["conta", "instrumento", "relogio", "run", "setup"] as const) {
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
      "--ambiente", "producao", "--para-pasta", pastaDoMercado, "--actualizar"],
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

function correrSetup(leitura: unknown, ficha: Ficha, manifesto: ManifestoDoSetup): Promise<{ proposta: unknown | null; erro: string | null }> {
  return new Promise((resolve) => {
    // As CONSTANTES e o relógio do par — e mais nada da ficha. O risco não passa por aqui (RN-M4.1).
    const p = spawn(manifesto.comando[0]!, manifesto.comando.slice(1), {
      cwd: join(RAIZ, ficha.pastaDoSetup),
      env: {
        ...process.env,
        CONSTANTES: JSON.stringify(ficha.constantes),
        INSTRUMENTO: String(ficha.cabecalho.instrumento),
        RELOGIO: String(ficha.cabecalho.relogio),
        PASTA_DE_MERCADO: pastaDoMercado ?? "",
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
    p.on("close", () => {
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
          if (r.veredicto === "aceite") return resolve({ proposta: obj, erro });
          return resolve({ proposta: null, erro: `a proposta do setup nao passa o contrato: ${r.motivo}` });
        }
      }
      resolve({ proposta: null, erro });
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
    buffer = pedacos.pop() ?? "";
    for (const linha of pedacos) {
      if (linha.trim() === "") continue;
      let msg: any;
      try {
        msg = JSON.parse(linha);
      } catch {
        continue;
      }
      if (msg?.tipo !== "mercado") continue;
      const instrumento = String(msg.carga?.instrumento);
      const ficha = ligadas.find((f) => String(f.cabecalho.instrumento) === instrumento);
      if (ficha === undefined) {
        // Par que o conector leu e a conta nao tem ligado: nao serve. E se isto se repetir, os pares ligados
        // que ninguem le' ficam a espera de nada — o prazo corta isso.
        inuteis += 1;
        if (inuteis >= LEITURAS_INUTEIS) {
          const instrumentos: Record<string, unknown> = {};
          for (const f of ligadas) {
            const nome = String(f.cabecalho.instrumento);
            instrumentos[nome] = {
              ficha: `${f.setup}_v${String(manifestoDe(f).versao).split(".")[0]}`,
              template: manifestoDe(f).template ?? {},
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
      for (const campo of ["bid", "ask", "ultimo", "posicao"] as const) {
        if (doVenue[campo] !== undefined) leitura[campo] = doVenue[campo];
      }

      const manifestoDaFicha = manifestoDe(ficha);
      const { proposta, erro } = await correrSetup(msg, ficha, manifestoDaFicha);

      // A OPERAÇÃO LEVA TODAS AS FICHAS LIGADAS, e não só a que falou nesta volta: a mesa decide, por ciclo,
      // sobre o que está na operação — e um par ligado que desaparecesse do ficheiro era um par que a mesa
      // deixava de ver. O par sem leitura entra SEM `leitura` (sem_leitura, RN-D7), nunca com a anterior.
      const instrumentos: Record<string, unknown> = {};
      for (const f of ligadas) {
        const nome = String(f.cabecalho.instrumento);
        const eOGueFalou = nome === instrumento;
        instrumentos[nome] = {
          ...(eOGueFalou ? { leitura } : {}),
          ficha: `${f.setup}_v${String(manifestoDe(f).versao).split(".")[0]}`,
          template: manifestoDe(f).template ?? {},
          parametros: f.constantes,
          // À mesa vai a parte operacional do cabeçalho; ao setup foi só `constantes` (RN-M4.1).
          risco: {
            saldo_pct: f.cabecalho.saldo_pct,
            alavancagem: f.cabecalho.alavancagem,
            bandas: f.cabecalho.bandas,
            prazo_de_resposta_ms: f.cabecalho.prazo_de_resposta_ms,
          },
          ...(eOGueFalou && proposta !== null ? { proposta: (proposta as any).carga } : {}),
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
        nota: `escrito pelo operador · ${new Date().toISOString()} · conta ${nomeDaConta} · conector hyperliquid · setups ${[...new Set(ligadas.map((f) => `${f.setup} ${manifestoDe(f).versao}`))].join(", ")}`,
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
