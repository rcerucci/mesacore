#!/usr/bin/env bun
// O OPERADOR — quem LIGA o conector ao setup e escreve o ficheiro de operação, a cada volta.
//
// PORQUE EXISTE. Medido, e era o portão para o primeiro setup: o conector JÁ emite a leitura ao vivo
// (`{"tipo":"mercado", ..., "equity":"989.82", "bid":"83510.0"}`), a mesa JÁ sabe lê-la do ficheiro de operação
// (`core/servidor.ts --operacao`), e o setup JÁ sabe falar o contrato — mas **ninguém escrevia o ficheiro**, e o
// vigia continuava a apontar para os dublês. Faltava esta peça, e é ela que fecha o circuito:
//
//   conector (processo) --stdin/stdout--> OPERADOR --ficheiro--> mesa (ciclo)
//                                          |
//                                          +--setup (processo, a língua que ele quiser)--> proposta
//
// COMO FALA COM O SETUP, e porque assim: **pelo seam da casa** — uma mensagem JSON por linha, no `stdin` do
// setup, e a `proposta` na linha do `stdout` dele. É o mesmo contrato do conector, e é o que faz um setup em
// Python e um em TypeScript serem o mesmo plugin para a mesa. O setup recebe a leitura do mercado por ali e as
// VELAS pelos ficheiros (`brokers/hyperliquid/mercado.ts --para-pasta`, o formato JSONL já provado nas duas
// línguas) — porque barras são muitos números por volta, e não se empurram por uma linha de conversa.
//
// O QUE AQUI NÃO SE FAZ: não se decide nada. O operador não avalia a proposta, não a corrige, não inventa
// leitura que o conector não deu: leva o que um deu ao outro e escreve o que ambos disseram, com a hora.
//
// Uso:
//   bun run vigia/operador.ts --ficha @config/contas/hl-teste-plugin.json \
//        --setup setups/cruzamento_de_media --instrumento BTC \
//        --para /tmp/operacao.json --tick 5000 --voltas 3 [--mercado <pasta>]

import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

const ficha = arg("--ficha") ?? morrer("falta `--ficha @<configuracao da conta>`");
const pastaDoSetup = arg("--setup") ?? morrer("falta `--setup setups/<nome>`");
const instrumento = arg("--instrumento") ?? morrer("falta `--instrumento <simbolo>`");
const para = arg("--para") ?? morrer("falta `--para <ficheiro de operacao>`");
const tickMs = Number(arg("--tick") ?? "5000");
const voltasPedidas = Number(arg("--voltas") ?? "1");
const pastaDoMercado = arg("--mercado") ?? null;

// ---------------------------------------------------------------------------------------------------------
// O manifesto do setup — a ÚNICA coisa que o operador precisa de saber sobre ele: como se arranca.
//
// A língua é declarada aqui e não interessa ao resto: `comando` é um argv. Um setup em Python declara
// ["python3","plugin.py"], um em TypeScript ["bun","run","plugin.ts"] — e a mesa nunca sabe a diferença.
interface ManifestoDoSetup {
  nome: string;
  versao: string;
  linguagem: string;
  comando: string[];
  ficheiro_de_mercado?: string;
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

const manifesto = lerManifestoDoSetup(pastaDoSetup);

// ---------------------------------------------------------------------------------------------------------
// O SETUP: um processo por volta. Recebe a leitura no stdin, devolve UMA linha `proposta` no stdout.

function correrSetup(leitura: unknown): Promise<{ proposta: unknown | null; linhas: string[]; erro: string | null }> {
  return new Promise((resolve) => {
    const p = spawn(manifesto.comando[0]!, manifesto.comando.slice(1), { cwd: join(RAIZ, pastaDoSetup), env: process.env });
    const linhas: string[] = [];
    let erro: string | null = null;
    const dec = new TextDecoder();
    p.stdout.on("data", (b) => linhas.push(...dec.decode(b).split("\n").filter((l) => l.trim() !== "")));
    p.stderr.on("data", (b) => {
      const t = dec.decode(b).trim();
      if (t !== "") erro = t.slice(0, 400);
    });
    p.on("close", () => {
      // A proposta procura-se pela FORMA DO CONTRATO, e valida-se contra ele: uma linha que o contrato recusaria
      // nao e' uma proposta — e o operador nao a "arranja".
      for (const linha of linhas) {
        let obj: any;
        try {
          obj = JSON.parse(linha);
        } catch {
          continue;
        }
        if (obj?.tipo === "proposta") {
          const r = validar(linha);
          if (r.veredicto === "aceite") return resolve({ proposta: obj, linhas, erro });
          return resolve({ proposta: null, linhas, erro: `a proposta do setup nao passa o contrato: ${r.motivo}` });
        }
      }
      resolve({ proposta: null, linhas, erro });
    });
    p.stdin.write(JSON.stringify(leitura) + "\n");
    p.stdin.end();
  });
}

// ---------------------------------------------------------------------------------------------------------
// O CONECTOR: um processo que fala a leitura, e o operador consome as linhas `mercado`.

function escreverOperacao(conteudo: unknown): void {
  // Escrita ATOMICA: temporario + rename. Uma leitura a meio de uma escrita daria a mesa um mundo que nao
  // existiu — e a mesa decide sobre esta leitura.
  const dir = dirname(para);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const temporario = `${para}.tmp-${process.pid}`;
  writeFileSync(temporario, JSON.stringify(conteudo, null, 1) + "\n");
  renameSync(temporario, para);
}

async function main(): Promise<void> {
  const casos = join(RAIZ, "brokers", "hyperliquid", "casos", "processo.casos.json");
  const conector = spawn(
    "bun",
    [
      "run", join(RAIZ, "brokers", "hyperliquid", "processo.ts"),
      "--casos", casos,
      "--ficha", ficha.startsWith("@") ? ficha : `@${join(RAIZ, ficha)}`,
      "--ao-vivo",
      "--leitura-a-cada", String(tickMs),
    ],
    { cwd: RAIZ, env: process.env },
  );

  const dec = new TextDecoder();
  let buffer = "";
  let voltas = 0;
  let aFechar = false;

  const terminar = () => {
    if (aFechar) return;
    aFechar = true;
    try {
      conector.kill();
    } catch {
      // o processo ja' nao existe: nada a fazer, e nao se inventa um erro
    }
    console.log(
      JSON.stringify({
        etapa: "operador",
        veredicto: "fim",
        voltas,
        operacao: para,
        setup: `${manifesto.nome} ${manifesto.versao} (${manifesto.linguagem})`,
      }),
    );
    process.exit(0);
  };

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
      if (msg?.tipo !== "mercado" || msg?.carga?.instrumento !== instrumento) continue;
      if (voltas >= voltasPedidas) return terminar();
      voltas += 1;

      const leitura = msg.carga;
      const { proposta, linhas, erro } = await correrSetup(msg);
      const operacao = {
        nota: `escrito pelo operador · ${new Date().toISOString()} · conector hyperliquid (${ficha}) · setup ${manifesto.nome} ${manifesto.versao}`,
        ligacao: "ligada",
        instrumentos: {
          [instrumento]: {
            leitura,
            ...(proposta === null
              ? {}
              : { proposta: (proposta as any).carga }),
            ...(erro === null ? {} : { erro_do_setup: erro }),
          },
        },
        ...(pastaDoMercado === null ? {} : { mercado: { pasta: pastaDoMercado, formato: "jsonl", ficheiro: manifesto.ficheiro_de_mercado ?? null } }),
      };
      escreverOperacao(operacao);
      console.log(
        JSON.stringify({
          etapa: "operador",
          volta: voltas,
          instrumento,
          equity: leitura.equity,
          bid: leitura.bid,
          ask: leitura.ask,
          lado_da_proposta: (proposta as any)?.carga?.lado ?? null,
          proposta_do_setup: proposta !== null,
          setup_falou: erro,
          operacao: para,
        }),
      );
      if (voltas >= voltasPedidas) return terminar();
    }
  });
  // AS PORTAS DO ARRANQUE: o operador recolhe o desfecho delas e grava-o onde a mesa o vai ler. Sem este
  // ficheiro a mesa RECUSA o `start` (nomeando `nao conferidas`) — e faz bem: a decisao de arrancar com as
  // portas por conferir nao se toma por omissao.
  const portasVistas: { porta: string; veredicto: string; motivo?: string | null }[] = [];
  const gravarPortas = () => {
    const falhadas = portasVistas.filter((o) => o.veredicto !== "passou" && o.veredicto !== "nao_corrida");
    const desfecho = { passam: portasVistas.length > 0 && falhadas.length === 0, porta: falhadas[0]?.porta ?? null, motivo: falhadas[0]?.motivo ?? null };
    const caminho = `${para}.portas.json`;
    const temporario = `${caminho}.tmp-${process.pid}`;
    writeFileSync(temporario, JSON.stringify(desfecho) + "\n");
    renameSync(temporario, caminho);
    if (portasVistas.length > 0) {
      console.error(JSON.stringify({ etapa: "operador", portas: portasVistas.length, falhadas: falhadas.length, ficheiro: caminho }));
    }
  };
  conector.stderr.on("data", (b) => {
    for (const l of dec.decode(b).split("\n")) {
      if (l.trim() === "") continue;
      try {
        const o = JSON.parse(l);
        if (o.porta) {
          portasVistas.push({ porta: o.porta, veredicto: o.veredicto, motivo: o.motivo ?? null });
          gravarPortas();
          console.error(JSON.stringify({ etapa: "arranque", porta: o.porta, veredicto: o.veredicto }));
        }
      } catch {
        // linha que nao e' do diagnostico: nao se imprime (o operador nao e' o log do conector)
      }
    }
  });
  conector.on("close", () => terminar());
}

await main();
