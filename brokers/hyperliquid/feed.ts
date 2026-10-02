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

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import { INTERVALOS_DO_VENUE, type Intervalo } from "./mercado.ts";
import {
  agregarDoBbo,
  encaixarVela,
  escreverVelas,
  estadoDoPar,
  precoLimpo,
  type Estado,
  type Vela,
} from "./feed-barras.ts";

const argv = process.argv.slice(2);
const argumento = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
};

const RAIZ = join(import.meta.dir, "..", "..");
/**
 * A corrida: quem não declara `--corrida` está a servir a corrida de risco por omissão — e a ausência fica dita
 * (`fonte_da_corrida` no arranque), pelo mesmo motivo do ambiente: registo de corrida lê-se depois, e «não foi
 * declarado» não pode parecer «foi declarado».
 */
const CORRIDA_NO_ARGUMENTO = argumento("--corrida");
const CORRIDA_POR_OMISSAO = `${process.env["HOME"]}/.hermes/profiles/appbuilder/cache/scratch/corrida-de-risco`;
const DIR_DA_CORRIDA = CORRIDA_NO_ARGUMENTO === undefined ? CORRIDA_POR_OMISSAO : CORRIDA_NO_ARGUMENTO;
const FONTE_DA_CORRIDA = CORRIDA_NO_ARGUMENTO === undefined ? "ausente: a corrida de risco por omissao" : "--corrida";
const PASTA_DO_MERCADO = join(DIR_DA_CORRIDA, "mercado");
const CAMINHO_DA_OPERACAO = join(DIR_DA_CORRIDA, "operacao.json");
const CAMINHO_DOS_PRECOS = join(PASTA_DO_MERCADO, "precos-vivos.json");
const SEM_PRECOS = argv.includes("--sem-precos");
/**
 * Os dois ambientes do venue, com nome — a MESMA lista do `mercado.ts`. O `--ambiente` confere-se contra ela
 * (não contra um `as`), e o que não pertencer é recusado com nome. Por omissão: o de TESTE, que é onde o sistema
 * corre hoje; `producao` só quando o dono o disser.
 */
const AMBIENTES = ["teste", "producao"] as const;
const AMBIENTE_NO_ARGUMENTO = argumento("--ambiente");
if (AMBIENTE_NO_ARGUMENTO !== undefined && !(AMBIENTES as readonly string[]).includes(AMBIENTE_NO_ARGUMENTO)) {
  process.stderr.write(JSON.stringify({ etapa: "feed", erro: "ambiente_fora_do_conjunto", ambiente: AMBIENTE_NO_ARGUMENTO, aceitos: AMBIENTES }) + "\n");
  process.exit(2);
}
/**
 * E A AUSÊNCIA TEM NOME — o mesmo cuidado do `mercado.ts`: quem não declara `--ambiente` está a declarar o de
 * TESTE, e isso fica **dito** (`FONTE_DO_AMBIENTE`) em vez de se presumir por um valor por omissão. A catraca
 * dos fallbacks exige zero no produto, e tem razão: um `?? "teste"` esconderia «não foi declarado» de «foi
 * declarado teste» — e são coisas diferentes quando se lê o registo de uma corrida.
 */
const AMBIENTE_DECLARADO: string = AMBIENTE_NO_ARGUMENTO === undefined ? "teste" : AMBIENTE_NO_ARGUMENTO;
const FONTE_DO_AMBIENTE =
  AMBIENTE_NO_ARGUMENTO === undefined ? "ausente: o ambiente de TESTE, por decisao de quem nao o declarou" : "--ambiente";
const IS_TESTNET = AMBIENTE_DECLARADO !== "producao";

/** A lista de pares relê-se da operação: é assim que uma ficha ligada a quente entra (sem reiniciar o feed). */
const RELER_A_OPERACAO_MS = 5_000;
/** O tecto de escrita por par: o stream pode mandar 10×/s e o disco não precisa de saber disso. */
const ESCRITA_NO_MAXIMO_A_CADA_MS = 1_000;

function dizer(o: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ instante_ms: Date.now(), etapa: "feed", ...o }) + "\n");
}

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
// (o encaixe da barra, a agregação do `bbo`, a leitura do histórico e a escrita atómica vivem no
// `feed-barras.ts` — o NÚCLEO PURO, medivel sem rede; aqui fica o que precisa do venue)

const estado = new Map<string, Estado>();

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
    const e: Estado = estadoDoPar(PASTA_DO_MERCADO, instrumento, relogio);
    estado.set(chave, e);
    const candle = await cliente.candle({ coin: instrumento, interval: intervalo }, (d: unknown) => {
      encaixarVela(e, d as Vela, chave, relogio, dizer);
    });
    let bbo: any | null = null;
    if (!SEM_PRECOS) {
      bbo = await cliente.bbo({ coin: instrumento }, (d: any) => {
        precos.set(instrumento, { quando_ms: Date.now(), bbo: d?.bbo });
        precosPorEscrever = true;
        // O MID é o preço vivo: faz a barra em curso respirar (ver `agregarDoBbo`).
        const bid = Number(d?.bbo?.[0]?.px);
        const ask = Number(d?.bbo?.[1]?.px);
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
          const mid = (bid + ask) / 2;
          precos.set(instrumento, { quando_ms: Date.now(), bbo: d?.bbo, mid: Number(precoLimpo(mid)) });
          agregarDoBbo(e, relogio, mid, Date.now());
        }
      });
    }
    subscrito.set(chave, { candle, bbo });
    dizer({ veredicto: "subscrito", par: chave, historico: e.velas.length, precos: !SEM_PRECOS });
  }
}

// ---------------------------------------------------------------- os preços vivos

const precos = new Map<string, { quando_ms: number; bbo: unknown; mid?: number }>();
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
  dizer({
    arranque: "ligado",
    corrida: DIR_DA_CORRIDA,
    fonte_da_corrida: FONTE_DA_CORRIDA,
    ambiente: AMBIENTE_DECLARADO,
    fonte_do_ambiente: FONTE_DO_AMBIENTE,
    precos: !SEM_PRECOS,
  });
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
      escreverVelas(PASTA_DO_MERCADO, instrumento!, relogio!, e, Date.now());
    }
    escreverPrecos();
  }, 500);

  // O feed não termina sozinho: morre com quem o lançou (o operador), como o conector.
  await new Promise(() => {});
}

void main();
