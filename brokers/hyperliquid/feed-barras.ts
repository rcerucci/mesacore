// AS BARRAS DO FEED — o NÚCLEO PURO: encaixar a barra, agregar do `bbo`, ler e escrever o ficheiro.
//
// PORQUE ESTE FICHEIRO EXISTE, E NÃO VIVE DENTRO DO `feed.ts`
// ---------------------------------------------------------
// O `feed.ts` LIGA-SE AO VENUE ao carregar (cria o `SubscriptionClient` e chama o `main()` no fim do módulo): quem
// o importasse para o medir abria uma ligação a sério e punha o feed a correr. Uma bancada que só quer medir as
// três regras da barra não pode arrastar a rede atrás — e um ajudante partilhado vive em módulo SEM EFEITOS AO
// CARREGAR (a mesma razão por que a fusão das fichas vive em `fundir.ts` e não em `arranque.ts`).
//
// Aqui está o que se pode medir SEM REDE: o encaixe da barra do venue, a agregação da barra em curso a partir do
// livro, a leitura do histórico e a escrita ATÓMICA. O que fica no `feed.ts` é o que precisa do venue: as
// subscrições (`candle`, `bbo`), o relógio do processo e o `dizer` no canal de diagnóstico.
//
// Nada aqui decide nem conhece a mesa: escreve os ficheiros que os consumidores já leem, e mais nada.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

/** A barra, na forma crua do venue (os nomes são os dele: `t`, `T`, `o`, `h`, `l`, `c`, `v`, `n`). */
export type Vela = {
  t: number;
  T?: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v?: string;
  n?: number;
  i?: string;
  s?: string;
  /** Marcado quando a barra foi AGREGADA por nós a partir do `bbo` (e não mandada pelo venue). */
  agregada_do_bbo?: boolean;
};

/** O estado de um par: o HISTÓRICO e a barra em curso na MESMA lista — a última linha é a que se está a formar. */
export type Estado = {
  velas: Vela[];
  escritoEm: number;
  porEscrever: boolean;
};

/**
 * Os passos que se alinham por simples divisão do dia — só estes se agregam (ver `agregarDoBbo`).
 */
export const PASSO_EM_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
};

/** O caminho do ficheiro das velas, a partir da PASTA DO MERCADO (que é do chamador, não do módulo). */
export function caminhoDasVelas(pastaDoMercado: string, instrumento: string, relogio: string): string {
  return join(pastaDoMercado, `velas-${instrumento}-${relogio}.jsonl`);
}

/** O histórico, lido UMA vez por par: o stream só traz a barra viva, o passado é do ficheiro. */
export function lerHistorico(caminho: string): Vela[] {
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
export function escreverVelas(
  pastaDoMercado: string,
  instrumento: string,
  relogio: string,
  e: Estado,
  agoraMs: number,
): void {
  mkdirSync(pastaDoMercado, { recursive: true });
  const caminho = caminhoDasVelas(pastaDoMercado, instrumento, relogio);
  const temporario = `${caminho}.a-escrever`;
  writeFileSync(temporario, e.velas.map((v) => JSON.stringify(v)).join("\n") + "\n");
  renameSync(temporario, caminho);
  e.escritoEm = agoraMs;
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
 *
 * E a lista VAZIA (histórico novo, o ficheiro do par ainda não existe): a barra do venue ACRESCENTA — não há com
 * o que comparar, e é ela o primeiro dado. Medido pela bancada (`casos/correr-feed.ts`), que o apanhou ao montar o
 * controle: sem este ramo, a PRIMEIRA barra de um par novo era deitada fora em silêncio — até um período inteiro
 * (1h, 4h) sem nada no ficheiro, e sem uma linha a dizê-lo.
 *
 * O `dizer` entra como parâmetro porque o buraco é um ACONTECIMENTO do processo (vai para o canal de diagnóstico
 * do `feed.ts`), e este módulo não escreve em canais que não são dele.
 */
export function encaixarVela(e: Estado, v: Vela, chave: string, relogio: string, dizer: (o: Record<string, unknown>) => void): void {
  const ultima = e.velas[e.velas.length - 1];
  if (ultima === undefined) {
    e.velas.push(v);
  } else if (v.t > ultima.t) {
    const passo = PASSO_EM_MS[relogio];
    if (passo !== undefined && v.t - ultima.t > passo) {
      // O STREAM NÃO TEM MEMÓRIA: o que passou enquanto ninguém ouvia, perdeu-se — e o feed NÃO o inventa.
      // Nomeia-se o buraco; quem o preenche é o puxão do histórico (o venue tem a série), nunca uma suposição nossa.
      dizer({ veredicto: "buraco_no_historico", par: chave, de: ultima.t, ate: v.t, faltam: Math.round((v.t - ultima.t) / passo) - 1 });
    }
    e.velas.push(v);
  } else if (v.t === ultima.t) {
    // A barra do venue substitui a nossa agregada: o que é do venue manda, e a agregação sai de cena sozinha.
    e.velas[e.velas.length - 1] = v;
  } else {
    return;
  }
  e.porEscrever = true;
}

/** O preço limpo: o mid de dois `px` do venue, sem o lixo do ponto flutuante (`2664.1000000000004`). */
export function precoLimpo(x: number): string {
  return String(Number(x.toFixed(10)));
}

/**
 * A BARRA EM CURSO, AGREGADA DO `bbo` — a decisão (1) do dono, tomada a 02/10/2026.
 *
 * O canal `candle` manda a barra quando ela muda (medido: de minuto a minuto no 1m), mas entre mudanças o gráfico
 * ficaria parado — e num mercado fino pode passar muito tempo sem um trade. O `bbo` empurra o melhor bid/ask a
 * ~0,5 s: é dele que sai o preço vivo que faz a barra respirar.
 *
 * ISTO É AGREGADO POR NÓS, e vai declarado: a barra leva `agregada_do_bbo: true`, e o `o`/`h`/`l`/`c` são o
 * primeiro e os extremos do MID (`(bid+ask)/2`) desde o início do período. O `v`/`n` (volume e trades) NÃO se
 * inventam: ficam a zero, porque o livro não os diz — inventá-los seria fingir uma medida que não foi feita.
 *
 * Quando o venue manda a barra do mesmo período, ela SUBSTITUI a agregada (ver `encaixarVela`): o que é do venue
 * manda, e a nossa agregação sai de cena sozinha.
 *
 * Não se agrega em relógios que não se alinhem por divisão do dia (`1d`, `3d`, `1w`, `1M`): a esses, a barra fica
 * como o venue a mandou. Fail-closed: melhor parada do que errada.
 *
 * O instante entra como parâmetro (`agoraMs`): o período da barra é uma decisão do relógio, e uma bancada que não
 * o puder fixar mede a hora a que corre, não a regra.
 */
export function agregarDoBbo(e: Estado, relogio: string, mid: number, agoraMs: number): void {
  const passo = PASSO_EM_MS[relogio];
  if (passo === undefined) return;
  const inicio = Math.floor(agoraMs / passo) * passo;
  const ultima = e.velas[e.velas.length - 1];
  const p = precoLimpo(mid);
  if (ultima === undefined || ultima.t < inicio) {
    // A barra do período ainda não existe: cria-se, com o mid como abertura.
    e.velas.push({ t: inicio, o: p, h: p, l: p, c: p, v: "0", n: 0, agregada_do_bbo: true });
  } else if (ultima.t === inicio) {
    ultima.h = precoLimpo(Math.max(Number(ultima.h), mid));
    ultima.l = precoLimpo(Math.min(Number(ultima.l), mid));
    ultima.c = p;
    ultima.agregada_do_bbo = true;
  }
  // `ultima.t > inicio` não acontece (o venue não manda do futuro); se acontecesse, não se mexia.
  e.porEscrever = true;
}

/** O estado novo de um par, com o histórico que já existe no disco. */
export function estadoDoPar(pastaDoMercado: string, instrumento: string, relogio: string): Estado {
  return { velas: lerHistorico(caminhoDasVelas(pastaDoMercado, instrumento, relogio)), escritoEm: 0, porEscrever: false };
}
