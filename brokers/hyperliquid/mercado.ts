#!/usr/bin/env bun
// A PORTA DO MERCADO — o que o venue publica sobre o PREÇO: as velas e o livro.
//
// PORQUE EXISTE, E PORQUE AGORA. O dono, ao ver a bateria: «o mais grave e' o setup nao ter dados de mercado,
// features precisam deles para calculo; baixa historico para estudo tambem deve ter uma porta.» Medido (e esta'
// em `docs/ONDE_ESTAMOS.md`): o setup nao tem fonte nenhuma de barras — o unico sítio que chamava
// `candleSnapshot` era a SONDA, uma vez, para medir o relogio de fecho de barra do venue. Sem isto, um setup de
// cruzamento de medias nao tem o que cruzar.
//
// AS DUAS METADES, como no resto da costura:
//   * a PORTA (`PortaDeMercado`) — o que a casa pede: velas de um intervalo desde um instante, e o livro;
//   * o ADAPTADOR (ao vivo, sobre o SDK) — quem fala com o venue. Nenhuma linha desta casa importa o core, e
//     nenhuma le a credencial: o mercado e' PUBLICO (o `info` do venue nao pede chave) — o que aqui se le nao
//     move dinheiro nenhum.
//
// O QUE ESTA PORTA NAO FAZ, e diz-se: nao normaliza para uma forma do CONTRATO (nao ha esquema de velas no
// contrato — e' um item por fazer, e inventa-lo aqui seria a casa a definir a forma do mundo). Devolve o que o
// venue publicou, e a forma crua viaja com a leitura (`fonte`, `intervalo`, `quantas`).
//
// O FORMATO — e porquê (pergunta do dono: «e' necessario considerar o formato mais viavel ao plugin para ele
// realizar calculos», e «um plugin pode ser ts, python, etc.»). O formato e' **JSONL**: um objecto JSON por
// linha, com os NOMES DE CAMPO DO PROPRIO VENUE e os numeros como TEXTO (o venue publica-os assim, e texto nao
// perde precisao nenhuma quando o plugin calcula — a regra D4 da casa, que proibe virgula flutuante em
// dinheiro). Ao lado vai um DESCRITOR (JSON) com o instrumento, o intervalo, a janela, quantas velas e quando
// se escreveu, para o plugin nao ter de ler o ficheiro para saber o que tem dentro. Porque assim:
//   * qualquer linguagem le JSON na sua biblioteca de base (TS `JSON.parse`, Python `json.loads`) — sem
//     dependencias, e sem um formato que so uma lingua sabe ler;
//   * uma linha por vela e' APPENDAVEL: o colector acrescenta a vela nova a cada volta, sem reescrever o
//     historico nem obrigar o plugin a recarregar tudo;
//   * uma linha truncada (escrita a meio) e' detectavel linha a linha, e nao corrompe o ficheiro inteiro;
//   * os nomes sao os do venue (`t`,`T`,`o`,`h`,`l`,`c`,`v`,`n`) — nao se renomeia nada, logo nao se perde nem
//     se inventa informacao.
//
// Uso (estudo, e leitura de features):
//   bun run brokers/hyperliquid/mercado.ts --intervalos
//   bun run brokers/hyperliquid/mercado.ts --velas BTC --intervalo 1h --dias 7
//   bun run brokers/hyperliquid/mercado.ts --velas BTC --intervalo 1h --dias 30 --para /caminho/btc-1h.csv
//   bun run brokers/hyperliquid/mercado.ts --livro BTC [--ficha @config/contas/hl-teste-plugin.json]

import { readFileSync, writeFileSync } from "node:fs";
import { ouAusente } from "../../contracts/esqueleto/texto.ts";

// ---------------------------------------------------------------------------------------------------------
// Os INTERVALOS: medidos na fonte do SDK instalado (`node_modules/@nktkas/hyperliquid/.../candleSnapshot.d.ts`,
// `PicklistSchema<["1m","3m","5m","15m","30m","1h","2h","4h","8h","12h","1d","3d","1w","1M"]>`), e nao de
// memoria. Um intervalo fora destes o venue recusa — e o recusa vem dele.
export const INTERVALOS_DO_VENUE = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M",
] as const;
export type Intervalo = (typeof INTERVALOS_DO_VENUE)[number];

/** Os dois ambientes do venue, com nome: o `--ambiente` e' conferido contra esta lista, e nao contra um `as`. */
const AMBIENTES = ["teste", "producao"] as const;

/**
 * O AMBIENTE QUANDO NINGUEM O DECLARA: a TESTE.
 *
 * A omissao vai para a testnet de proposito — e' a direccao que nao pode mexer em dinheiro — e por isso tem
 * nome proprio, em vez de viver como um literal dentro de um `??` (onde nao se lia como uma decisao).
 */
const AMBIENTE_POR_OMISSAO: "teste" | "producao" = "teste";

/** O numero de dias por omissao das velas, com nome: um literal dentro de um `??` nao se le como decisao. */
const DIAS_POR_OMISSAO = 7;

/** O intervalo por omissao — conferido contra `INTERVALOS_DO_VENUE` antes de ser usado, logo nao adivinha nada. */
const INTERVALO_POR_OMISSAO = "1h";

/**
 * O TEMPO DE UMA VELA, exigido.
 *
 * Era `Number(v?.t ?? 0)`, em tres sitios: uma vela sem `t` virava a vela do instante ZERO — ou seja, mais
 * antiga do que todas — e saia DESCARTADA na deduplicacao, em silencio. O ficheiro que o setup le ficava com um
 * buraco, e um buraco no meio das barras e' um cruzamento de medias que nunca aconteceu. O venue publica `t`
 * (abertura) e `T` (fecho) em todos os candles; uma vela sem eles nao e' uma vela.
 */
function tempoDaVela(v: unknown, campo: "t" | "T", onde: string): number {
  const valor = (v as Record<string, unknown> | null)?.[campo];
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new Error(
      `${onde}: uma vela veio sem \`${campo}\` (${JSON.stringify(v)?.slice(0, 140)}): sem o tempo da barra nao se ` +
        "sabe onde ela entra no ficheiro, e uma barra no lugar errado e' um sinal no lugar errado",
    );
  }
  return valor;
}

/** A PORTA do mercado: o que a casa pede, sem saber qual e' o venue. */
export type PortaDeMercado = {
  /** As velas de um instrumento, de `desde_ms` ate' agora (ou ate' `ate_ms`), no intervalo pedido. */
  velas(p: { instrumento: string; intervalo: Intervalo; desde_ms: number; ate_ms?: number }): Promise<unknown>;
  /** O livro (as profundidades que o venue publica). */
  livro(p: { instrumento: string }): Promise<unknown>;
};

/** O cliente do venue, na forma ESTRUTURAL que esta porta consome (o SDK oficial encaixa aqui). */
export type ClienteDeMercado = {
  candleSnapshot(p: { coin: string; interval: string; startTime: number; endTime?: number }): Promise<unknown>;
  l2Book(p: { coin: string }): Promise<unknown>;
};

export function portaDoCliente(cliente: ClienteDeMercado): PortaDeMercado {
  return {
    velas: ({ instrumento, intervalo, desde_ms, ate_ms }) =>
      cliente.candleSnapshot({
        coin: instrumento,
        interval: intervalo,
        startTime: desde_ms,
        ...(ate_ms === undefined ? {} : { endTime: ate_ms }),
      }),
    livro: ({ instrumento }) => cliente.l2Book({ coin: instrumento }),
  };
}

/** A porta AO VIVO: o SDK do venue, so' de leitura e sem chave (o `info` e' publico). */
export async function portaAoVivo(ambiente: "teste" | "producao"): Promise<PortaDeMercado> {
  const modulo = await import("@nktkas/hyperliquid");
  const transporte = new modulo.HttpTransport({ isTestnet: ambiente !== "producao" });
  const info = new modulo.InfoClient({ transport: transporte });
  return portaDoCliente(info as unknown as ClienteDeMercado);
}

// ---------------------------------------------------------------------------------------------------------
// O CLI — a ferramenta de ESTUDO: baixar historico, e ver o livro.

const argv = process.argv.slice(2);
const argumento = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i < 0 ? undefined : argv[i + 1];
};

/**
 * O ambiente e a URL: da ficha, quando ela e' dada; sem `--ficha` nem `--ambiente`, a TESTE. Nunca le a
 * credencial.
 *
 * O QUE MUDOU, E PORQUE. Era `bruto?.conexao?.ambiente ?? "teste"`, e o `--ambiente` era um `as` sem
 * conferencia. Duas maneiras de acabar na testnet sem ninguem o decidir: uma ficha de PRODUCAO que nao
 * declarasse o campo (ou que o declarasse com uma gralha) lia-se como teste, e um `--ambiente producaoo`
 * atravessava o `as` e valia teste. O ambiente decide ONDE se le e ONDE se opera: um valor por omissao aqui
 * nao e' uma comodidade, e' uma decisao tomada por quem nao a declarou.
 */
function ambienteEFonte(): { ambiente: "teste" | "producao"; fonte: string; url: string } {
  const ficha = argumento("--ficha");
  const declarado = argumento("--ambiente");
  if (declarado !== undefined && declarado !== "teste" && declarado !== "producao") {
    console.error(JSON.stringify({ erro: "ambiente_fora_do_conjunto", ambiente: declarado, aceitos: AMBIENTES }));
    process.exit(2);
  }
  if (ficha !== undefined) {
    const caminho = ficha.startsWith("@") ? ficha.slice(1) : ficha;
    const bruto = JSON.parse(readFileSync(caminho, "utf8")) as any;
    const daFicha = bruto?.conexao?.ambiente;
    if (daFicha !== "teste" && daFicha !== "producao") {
      console.error(
        JSON.stringify({
          erro: "a ficha nao declara `conexao.ambiente`",
          ficha: caminho,
          veio: daFicha,
          aceitos: AMBIENTES,
          porque: "o ambiente decide onde se le e onde se opera; nao se adivinha por omissao",
        }),
      );
      process.exit(2);
    }
    return {
      ambiente: declarado === undefined ? (daFicha as "teste" | "producao") : (declarado as "teste" | "producao"),
      fonte: declarado === undefined ? `ficha ${caminho} (conexao.ambiente)` : `--ambiente (sobre a ficha ${caminho})`,
      url: ouAusente(typeof bruto?.conexao?.url_da_api === "string" ? bruto.conexao.url_da_api : null, "(o SDK decide pelo ambiente)"),
    };
  }
  // Sem `--ficha` E sem `--ambiente` a ferramenta vai para a TESTE — e di-lo. A omissao e' a direccao que nao
  // pode mexer em dinheiro, e por isso tem nome proprio em vez de um literal solto no meio de um `??`.
  const ambiente = declarado === undefined ? AMBIENTE_POR_OMISSAO : (declarado as "teste" | "producao");
  return { ambiente, fonte: "por omissao (sem `--ficha`: `--ambiente`)", url: "(o SDK decide pelo ambiente)" };
}

async function main(): Promise<void> {
  if (argv.includes("--intervalos")) {
    console.log(
      JSON.stringify(
        {
          intervalos: INTERVALOS_DO_VENUE,
          quantos: INTERVALOS_DO_VENUE.length,
          fonte: "PicklistSchema do `candleSnapshot` no SDK instalado (@nktkas/hyperliquid) — lido, nao de memoria",
        },
        null,
        1,
      ),
    );
    return;
  }

  const instrumento = argumento("--velas") ?? argumento("--livro");
  if (instrumento === undefined) {
    console.error(
      "uso: --intervalos | --velas <instrumento> --intervalo <i> [--dias N | --desde <ms|ISO>] [--para ficheiro.csv] [--json] | --livro <instrumento> [--ficha @caminho]",
    );
    process.exit(2);
  }

  const { ambiente, fonte, url } = ambienteEFonte();
  const porta = await portaAoVivo(ambiente);

  if (argumento("--velas") !== undefined) {
    const intervaloDeclarado = argumento("--intervalo");
    const intervalo = (intervaloDeclarado === undefined ? INTERVALO_POR_OMISSAO : intervaloDeclarado) as Intervalo;
    if (!(INTERVALOS_DO_VENUE as readonly string[]).includes(intervalo)) {
      console.error(JSON.stringify({ erro: "intervalo_fora_do_conjunto_do_venue", intervalo, aceitos: INTERVALOS_DO_VENUE }));
      process.exit(2);
    }
    const desdeArg = argumento("--desde");
    const diasDeclarados = argumento("--dias");
    const dias = Number(diasDeclarados === undefined ? String(DIAS_POR_OMISSAO) : diasDeclarados);
    const desde_ms = desdeArg === undefined ? Date.now() - dias * 24 * 3600 * 1000 : Number(desdeArg);
    if (!Number.isFinite(desde_ms)) {
      console.error(JSON.stringify({ erro: "desde_invalido", desdeArg }));
      process.exit(2);
    }
    const velas = (await porta.velas({ instrumento, intervalo, desde_ms })) as any[];
    // O VENUE RESPONDE UMA LISTA, ou respondeu outra coisa. `Array.isArray(velas) ? velas.length : 0` contava
    // ZERO velas para uma resposta que nao era lista nenhuma — e zero velas e' um resultado plausivel (um
    // instrumento novo nao tem historico), logo a anomalia passava por resultado.
    if (!Array.isArray(velas)) {
      console.error(JSON.stringify({ erro: "velas_do_venue_nao_sao_lista", veio: typeof velas, instrumento, intervalo }));
      process.exit(2);
    }
    // O VENUE DIZ O NOME EM CADA VELA — e é essa a razão de não haver dicionário nenhum: a ficha nomeia o par
    // como o venue o escreve, e este nome vai TAL E QUAL para a API. Se a vela que voltou traz outro símbolo (ou
    // outro intervalo), o nome que se pediu não é o nome do venue — para-se aqui, em vez de escrever um ficheiro
    // de velas que a mesa e o setup leriam como se fossem deste par. Medido: o venue escreve `s: "SOL"`, `i: "1h"`.
    // (Sem velas não há nada a conferir: um instrumento novo não tem histórico, e isso é um resultado, não anomalia.)
    const deOutroPar = velas.filter((v: any) => v?.s !== instrumento || v?.i !== intervalo);
    if (deOutroPar.length > 0) {
      console.error(
        JSON.stringify({
          erro: "vela_de_outro_par",
          pedido: { instrumento, intervalo },
          veio: { s: (deOutroPar[0] as any)?.s, i: (deOutroPar[0] as any)?.i },
          quantas: deOutroPar.length,
          porque:
            "o nome do instrumento e' o do VENUE e nada traduz nomes: uma vela com outro simbolo nao e' deste par",
        }),
      );
      process.exit(2);
    }
    const quantas = velas.length;
    // A FORMA crua, declarada: as chaves que o venue publicou na primeira vela. Nao se inventa esquema nenhum.
    const chaves = quantas > 0 ? Object.keys(velas[0] as object).sort() : [];
    const resumo = {
      ambiente,
      fonte,
      url,
      instrumento,
      intervalo,
      desde_ms,
      desde: new Date(desde_ms).toISOString(),
      quantas,
      campo_do_tempo: chaves.filter((c) => /^[tT]$/.test(c) || /time/i.test(c)),
      chaves_da_vela: chaves,
      primeira: quantas > 0 ? velas[0] : null,
      ultima: quantas > 0 ? velas[quantas - 1] : null,
    };
    const pasta = argumento("--para-pasta");
    if (pasta !== undefined) {
      // O FICHEIRO QUE O PLUGIN LE: JSONL + descritor, e a actualizacao que o colector chama a cada volta.
      const actualizar = argv.includes("--actualizar");
      const nome = `velas-${instrumento}-${intervalo}`;
      // A pasta pode nao existir: a ferramenta CRIA-A, em vez de rebentar na escrita (medido: foi o que
      // aconteceu na primeira corrida do operador, e o erro saiu como stack trace em vez de resultado).
      (await import("node:fs")).mkdirSync(pasta, { recursive: true });
      const ficheiro = `${pasta.replace(/\/$/, "")}/${nome}.jsonl`;
      const descritor = `${pasta.replace(/\/$/, "")}/${nome}.descritor.json`;
      let ja: any[] = [];
      let janela = { desde_ms, quantas: 0 };
      if (actualizar) {
        try {
          const bruto = JSON.parse(readFileSync(descritor, "utf8")) as any;
          // O DESCRITOR TEM DE TRAZER A JANELA INTEIRA para se poder retomar dele. Era
          // `bruto.desde_ms ?? desde_ms` e `bruto.quantas ?? 0`: um descritor a que faltasse um campo
          // retomava-se com a janela de AGORA e zero velas — o ficheiro era reescrito do zero e o que ja' la'
          // estava perdia-se, sem uma palavra. Sem os tres campos, isto nao e' um descritor: escreve-se de novo.
          if (
            bruto?.instrumento === instrumento && bruto?.intervalo === intervalo &&
            typeof bruto.desde_ms === "number" && Number.isFinite(bruto.desde_ms) &&
            typeof bruto.quantas === "number" && Number.isInteger(bruto.quantas)
          ) {
            janela = { desde_ms: bruto.desde_ms, quantas: bruto.quantas };
            ja = readFileSync(ficheiro, "utf8")
              .split("\n")
              .filter((l) => l.trim() !== "")
              .map((l) => JSON.parse(l));
          }
        } catch {
          // Sem descritor ou sem ficheiro: escreve-se de novo, e diz-se na saida (`ja_tinha: 0`).
        }
      }
      // APPEND, sem duplicar: as velas novas sao as que comecam DEPOIS da ultima que ja' la' esta'.
      const ultimaJa = ja.length > 0 ? tempoDaVela(ja[ja.length - 1], "t", "ficheiro das velas") : 0;
      const novas = velas.filter((v) => tempoDaVela(v, "t", "velas do venue") > ultimaJa);
      const todas = [...ja, ...novas];
      writeFileSync(ficheiro, todas.map((v) => JSON.stringify(v)).join("\n") + "\n");
      writeFileSync(
        descritor,
        JSON.stringify(
          {
            formato: "jsonl — um objecto por vela, campos do venue, numeros em TEXTO",
            instrumento,
            intervalo,
            ambiente,
            url,
            desde_ms: janela.desde_ms,
            ate_ms: todas.length > 0 ? tempoDaVela(todas[todas.length - 1], "T", "ficheiro das velas") : null,
            quantas: todas.length,
            chaves_da_vela: chaves,
            ficheiro: nome + ".jsonl",
            escrito_em_ms: Date.now(),
            fonte_do_campo_do_tempo: "`t` abre, `T` fecha (o venue publica os dois, em ms)",
          },
          null,
          1,
        ) + "\n",
      );
      console.log(
        JSON.stringify(
          { ...resumo, formato: "jsonl", ficheiro, descritor, ja_tinha: ja.length, novas: novas.length, agora_tem: todas.length },
          null,
          1,
        ),
      );
      return;
    }

    const destino = argumento("--para");
    if (destino !== undefined) {
      // O estudo quer o ficheiro: as chaves do venue, na ordem em que ele as publicou, com cabecalho.
      const cabecalho = chaves.join(",");
      const linhas = (velas as any[]).map((v) => chaves.map((c) => String((v as any)[c])).join(","));
      writeFileSync(destino, [cabecalho, ...linhas].join("\n") + "\n");
      console.log(JSON.stringify({ ...resumo, escrito: destino, linhas_escritas: linhas.length }, null, 1));
    } else if (argv.includes("--json")) {
      console.log(JSON.stringify(resumo, null, 1));
    } else {
      console.log(`velas: ${quantas} de ${instrumento} ${intervalo} desde ${resumo.desde} (${ambiente})`);
      console.log(`fonte: ${fonte} · url: ${url}`);
      console.log(`chaves que o venue publicou: ${JSON.stringify(chaves)}`);
      console.log(`primeira: ${JSON.stringify(resumo.primeira)}`);
      console.log(`ultima:   ${JSON.stringify(resumo.ultima)}`);
    }
    return;
  }

  const livro = await porta.livro({ instrumento });
  const l = livro as any;
  // O LIVRO TEM DE TRAZER OS DOIS LADOS. Era `Array.isArray(l?.levels?.[0]) ? length : 0`, e um livro que nao
  // trouxesse os lados virava "0/0 niveis" — que e' um resultado plausivel, e por isso um diagnostico falso
  // para uma leitura que nao se leu. (O manifesto declara 20 niveis por lado; o que aqui chega e' o que o
  // venue publicou.)
  const lados = l?.levels;
  if (!Array.isArray(lados) || !Array.isArray(lados[0]) || !Array.isArray(lados[1])) {
    console.error(JSON.stringify({ erro: "livro_sem_os_dois_lados", instrumento, bruto: l }));
    process.exit(2);
  }
  const niveis = { bids: lados[0].length, asks: lados[1].length };
  const melhor = { bid: lados[0].length > 0 ? lados[0][0] : null, ask: lados[1].length > 0 ? lados[1][0] : null };
  console.log(JSON.stringify({ ambiente, fonte, instrumento, niveis, melhor, bruto: l }, null, 1));
}

// Só corre quando chamado como programa (importar daqui nao dispara nada).
if (import.meta.main) await main();
