// O FEED DE MERCADO — a aquisição por STREAM, fora do caminho da decisão.
//
// PORQUE EXISTE (medido a 02/10/2026)
// ----------------------------------
// O operador puxa as velas DENTRO do laço: `await garantirVelas(ficha)` antes de pedir a proposta ao setup
// (`vigia/operador.ts`). Cada puxão custa 1,2-1,5 s de bloqueio, um processo `bun` NOVO (80 MB de pico) e um
// pedido ao venue — e, quando o ritmo subiu, o venue respondeu 253× `429 Too Many Requests` em menos de dois
// minutos. Um puxão por par também não escala: com 20 pares é pior na mesma proporção.
//
// O venue TEM stream — medido no próprio venue: `bbo` empurra o melhor bid/ask a ~0,5 s; `candle` empurra a barra
// quando ela muda. Por stream NÃO HÁ PEDIDOS: uma ligação serve 3 ou 20 pares, e a memória fica estável em vez de
// oscilar com os puxões.
//
// O QUE ELE ESCREVE, E POR ISSO NADA MAIS MUDA
// -------------------------------------------
// Escreve os MESMOS ficheiros que os consumidores JÁ leem — `velas-<PAR>-<RELOGO>.jsonl` da pasta do mercado — e
// um pequeno `precos-vivos.json`. Não é preciso tocar no setup (lê o mesmo ficheiro), na sobreposição/painel (idem),
// no contrato (nenhum schema muda) nem na mesa (que nunca viu o venue: é decisão, e só lê a operação).
//
// O QUE ELE NÃO FAZ: não decide, não escreve na operação, não fala com a mesa. Se estiver parado, o motor opera
// igual — só as velas param de chegar, e o setup di-lo (ele já sabe dizer «não há velas»).
//
// Uso:
//   bun run brokers/hyperliquid/feed.ts --corrida <dir> [--sem-precos] [--ambiente teste|real]

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import { INTERVALOS_DO_VENUE, type Intervalo } from "./mercado.ts";

const argv = process.argv.slice(2);
const argumento = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
};

const RAIZ = join(import.meta.dir, "..", "..");
const DIR_DA_CORRIDA =
  argumento("--corrida") ?? `${process.env["HOME"]}/.hermes/profiles/appbuilder/cache/scratch/corrida-de-risco`;
const PASTA_DO_MERCADO = join(DIR_DA_CORRIDA, "mercado");
const CAMINHO_DA_OPERACAO = join(DIR_DA_CORRIDA, "operacao.json");
const CAMINHO_DOS_PRECOS = join(PASTA_DO_MERCADO, "precos-vivos.json");
const SEM_PRECOS = argv.includes("--sem-precos");
// O ambiente: por omissão o de TESTE (é onde o sistema corre hoje); `real` só quando o dono o disser.
const IS_TESTNET = argumento("--ambiente") !== "real";

/** A lista de pares relê-se da operação: é assim que uma ficha ligada a quente entra (sem reiniciar o feed). */
const RELER_A_OPERACAO_MS = 5_000;
/** O tecto de escrita por par: o stream pode mandar 10×/s e o disco não precisa de saber disso. */
const ESCRITA_NO_MAXIMO_A_CADA_MS = 1_000;

function dizer(o: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ instante_ms: Date.now(), etapa: "feed", ...o }) + "\n");
}

type Vela = { t: number; T?: number; o: string; h: string; l: string; c: string; v?: string; n?: number; i?: string; s?: string };

/**
 * O relógio da ficha é um dos intervalos DO VENUE? A lista é a do `mercado.ts` (medida na fonte do SDK instalado) —
 * uma conta, um dono. Um relógio que não pertença à lista NÃO se subscreve: o canal `candle` recusaria, e forçar
 * com um `as` seria fingir que o venue aceita o que ele não aceita.
 */
function intervaloDoVenue(relogio: string): Intervalo | null {
  return (INTERVALOS_DO_VENUE as readonly string[]).includes(relogio) ? (relogio as Intervalo) : null;
}

// ---------------------------------------------------------------- o que está vivo

/** Os pares e os relógios, DA OPERAÇÃO — a mesma fonte que a mesa lê. Sem operação não há nada a servir (ainda). */
function paresDaOperacao(): { instrumento: string; relogio: string }[] {
  if (!existsSync(CAMINHO_DA_OPERACAO)) return [];
  let operacao: any;
  try {
    operacao = JSON.parse(readFileSync(CAMINHO_DA_OPERACAO, "utf8"));
  } catch {
    return []; // a operação a meio de uma escrita: tenta-se na volta seguinte, sem inventar nada
  }
  const instrumentos = operacao?.instrumentos;
  if (instrumentos === undefined || instrumentos === null || typeof instrumentos !== "object") return [];
  const saida: { instrumento: string; relogio: string }[] = [];
  for (const [instrumento, v] of Object.entries(instrumentos as Record<string, any>)) {
    const relogio = v?.relogio;
    if (typeof relogio === "string" && relogio !== "") saida.push({ instrumento, relogio });
  }
  return saida.sort((a, b) => (a.instrumento < b.instrumento ? -1 : 1));
}

// ---------------------------------------------------------------- o estado, por par

type Estado = {
  /** O HISTÓRICO e a barra em curso na MESMA lista: a última linha do ficheiro é, sempre, a barra a formar-se. */
  velas: Vela[];
  escritoEm: number;
  porEscrever: boolean;
};

const estado = new Map<string, Estado>();

function caminhoDasVelas(instrumento: string, relogio: string): string {
  return join(PASTA_DO_MERCADO, `velas-${instrumento}-${relogio}.jsonl`);
}

/** O histórico, lido UMA vez por par: o stream só traz a barra viva, o passado é do ficheiro. */
function lerHistorico(instrumento: string, relogio: string): Vela[] {
  const caminho = caminhoDasVelas(instrumento, relogio);
  if (!existsSync(caminho)) return [];
  const velas: Vela[] = [];
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    if (linha.trim() === "") continue;
    try {
      velas.push(JSON.parse(linha));
    } catch {
      // uma linha partida não se adivinha: ignora-se, e o setup já sabe recusar uma série curta
    }
  }
  return velas;
}

/**
 * Escreve o ficheiro das velas — ATOMICO (ficheiro novo + troca de nome).
 *
 * Medido: reescrever 672 KB custa 1,5 ms, e o tecto é de 1 s por par (0,15% de um núcleo). O `rename` é o mesmo
 * cuidado do resto do sistema: quem lê (o setup, a sobreposição) nunca apanha um ficheiro a meio.
 */
function escreverVelas(instrumento: string, relogio: string, e: Estado): void {
  mkdirSync(PASTA_DO_MERCADO, { recursive: true });
  const caminho = caminhoDasVelas(instrumento, relogio);
  const temporario = `${caminho}.a-escrever`;
  writeFileSync(temporario, e.velas.map((v) => JSON.stringify(v)).join("\n") + "\n");
  renameSync(temporario, caminho);
  e.escritoEm = Date.now();
  e.porEscrever = false;
}

/**
 * A BARRA QUE CHEGOU DO STREAM, encaixada no sítio dela.
 *
 * O `candle` manda a barra EM CURSO, e volta a mandá-la a cada mudança — com o mesmo `t` enquanto ela corre, e com
 * um `t` maior quando vira. Daí as três regras, e só três:
 *   * `t` igual ao da última -> SUBSTITUI (é a mesma barra, mais fresca);
 *   * `t` maior             -> ACRESCENTA (a anterior fechou, e o que dela sabemos já está gravado);
 *   * `t` menor             -> ignora (o venue pode reenviar; andar para trás no histórico seria inventar).
 */
function encaixarVela(e: Estado, v: Vela): void {
  const ultima = e.velas[e.velas.length - 1];
  if (ultima === undefined || v.t > ultima.t) {
    e.velas.push(v);
  } else if (v.t === ultima.t) {
    e.velas[e.velas.length - 1] = v;
  } else {
    return;
  }
  e.porEscrever = true;
}

// ---------------------------------------------------------------- o stream

const transport = new WebSocketTransport({ isTestnet: IS_TESTNET });
const cliente = new SubscriptionClient({ transport });
const subscrito = new Map<string, { candle: any; bbo: any | null }>();

/** As subscrições abertas — as que saíram do mandato fecham-se (ficha desligada a quente). */
async function garantirSubscricoes(): Promise<void> {
  const desejado = paresDaOperacao();
  const chaves = new Set(desejado.map((p) => `${p.instrumento}-${p.relogio}`));

  for (const [chave, s] of [...subscrito]) {
    if (chaves.has(chave)) continue;
    await s.candle.unsubscribe().catch(() => {});
    if (s.bbo !== null) await s.bbo.unsubscribe().catch(() => {});
    subscrito.delete(chave);
    estado.delete(chave);
    dizer({ veredicto: "desubscrito", par: chave });
  }

  for (const { instrumento, relogio } of desejado) {
    const chave = `${instrumento}-${relogio}`;
    if (subscrito.has(chave)) continue;
    const intervalo = intervaloDoVenue(relogio);
    if (intervalo === null) {
      dizer({ veredicto: "relogio_fora_do_venue", par: chave, relogio, aceitos: INTERVALOS_DO_VENUE });
      continue;
    }
    const velas = lerHistorico(instrumento, relogio);
    const e: Estado = { velas, escritoEm: 0, porEscrever: false };
    estado.set(chave, e);
    const candle = await cliente.candle({ coin: instrumento, interval: intervalo }, (d: unknown) => {
      encaixarVela(e, d as Vela);
    });
    let bbo: any | null = null;
    if (!SEM_PRECOS) {
      bbo = await cliente.bbo({ coin: instrumento }, (d: any) => {
        precos.set(instrumento, { quando_ms: Date.now(), bbo: d?.bbo });
        precosPorEscrever = true;
      });
    }
    subscrito.set(chave, { candle, bbo });
    dizer({ veredicto: "subscrito", par: chave, historico: velas.length, precos: !SEM_PRECOS });
  }
}

// ---------------------------------------------------------------- os preços vivos

const precos = new Map<string, { quando_ms: number; bbo: unknown }>();
let precosPorEscrever = false;

function escreverPrecos(): void {
  if (!precosPorEscrever) return;
  const corpo: Record<string, unknown> = {};
  for (const [instrumento, v] of precos) corpo[instrumento] = v;
  const temporario = `${CAMINHO_DOS_PRECOS}.a-escrever`;
  writeFileSync(
    temporario,
    JSON.stringify(
      { gerado_em_ms: Date.now(), nota: "o melhor bid/ask de cada par, por stream (canal bbo)", precos: corpo },
      null,
      1,
    ) + "\n",
  );
  renameSync(temporario, CAMINHO_DOS_PRECOS);
  precosPorEscrever = false;
}

// ---------------------------------------------------------------- o relógio do feed

async function main(): Promise<void> {
  dizer({ arranque: "ligado", corrida: DIR_DA_CORRIDA, ambiente: IS_TESTNET ? "teste" : "real", precos: !SEM_PRECOS });
  await garantirSubscricoes();

  let ultimaLeituraDaOperacao = Date.now();
  setInterval(() => {
    if (Date.now() - ultimaLeituraDaOperacao >= RELER_A_OPERACAO_MS) {
      ultimaLeituraDaOperacao = Date.now();
      void garantirSubscricoes().catch((e) => dizer({ veredicto: "erro_a_subscribar", erro: String(e) }));
    }
    for (const [chave, e] of estado) {
      if (!e.porEscrever) continue;
      if (Date.now() - e.escritoEm < ESCRITA_NO_MAXIMO_A_CADA_MS) continue;
      const [instrumento, relogio] = chave.split("-");
      escreverVelas(instrumento!, relogio!, e);
    }
    escreverPrecos();
  }, 500);

  // O feed não termina sozinho: morre com quem o lançou (o operador), como o conector.
  await new Promise(() => {});
}

void main();
