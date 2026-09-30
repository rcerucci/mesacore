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

// ---------------------------------------------------------------------------------------------------------
// Os INTERVALOS: medidos na fonte do SDK instalado (`node_modules/@nktkas/hyperliquid/.../candleSnapshot.d.ts`,
// `PicklistSchema<["1m","3m","5m","15m","30m","1h","2h","4h","8h","12h","1d","3d","1w","1M"]>`), e nao de
// memoria. Um intervalo fora destes o venue recusa — e o recusa vem dele.
export const INTERVALOS_DO_VENUE = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M",
] as const;
export type Intervalo = (typeof INTERVALOS_DO_VENUE)[number];

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

/** O ambiente e a URL: da ficha, quando ela e' dada; por omissao, a TESTE. Nunca le a credencial. */
function ambienteEFonte(): { ambiente: "teste" | "producao"; fonte: string; url: string } {
  const ficha = argumento("--ficha");
  const declarado = argumento("--ambiente");
  if (ficha !== undefined) {
    const caminho = ficha.startsWith("@") ? ficha.slice(1) : ficha;
    const bruto = JSON.parse(readFileSync(caminho, "utf8")) as any;
    const ambiente = (bruto?.conexao?.ambiente ?? "teste") as "teste" | "producao";
    return {
      ambiente: (declarado as "teste" | "producao") ?? ambiente,
      fonte: `ficha ${caminho} (conexao.ambiente)`,
      url: String(bruto?.conexao?.url_da_api ?? "(o SDK decide pelo ambiente)"),
    };
  }
  const ambiente = (declarado ?? "teste") as "teste" | "producao";
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
    const intervalo = (argumento("--intervalo") ?? "1h") as Intervalo;
    if (!(INTERVALOS_DO_VENUE as readonly string[]).includes(intervalo)) {
      console.error(JSON.stringify({ erro: "intervalo_fora_do_conjunto_do_venue", intervalo, aceitos: INTERVALOS_DO_VENUE }));
      process.exit(2);
    }
    const desdeArg = argumento("--desde");
    const dias = Number(argumento("--dias") ?? "7");
    const desde_ms = desdeArg === undefined ? Date.now() - dias * 24 * 3600 * 1000 : Number(desdeArg);
    if (!Number.isFinite(desde_ms)) {
      console.error(JSON.stringify({ erro: "desde_invalido", desdeArg }));
      process.exit(2);
    }
    const velas = (await porta.velas({ instrumento, intervalo, desde_ms })) as any[];
    const quantas = Array.isArray(velas) ? velas.length : 0;
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
      const ficheiro = `${pasta.replace(/\/$/, "")}/${nome}.jsonl`;
      const descritor = `${pasta.replace(/\/$/, "")}/${nome}.descritor.json`;
      let ja: any[] = [];
      let janela = { desde_ms, quantas: 0 };
      if (actualizar) {
        try {
          const bruto = JSON.parse(readFileSync(descritor, "utf8")) as any;
          if (bruto?.instrumento === instrumento && bruto?.intervalo === intervalo) {
            janela = { desde_ms: bruto.desde_ms ?? desde_ms, quantas: bruto.quantas ?? 0 };
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
      const ultimaJa = ja.length > 0 ? Number(ja[ja.length - 1]?.t ?? 0) : 0;
      const novas = (velas as any[]).filter((v) => Number(v?.t ?? 0) > ultimaJa);
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
            ate_ms: todas.length > 0 ? Number(todas[todas.length - 1]?.T ?? 0) : null,
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
  const niveis = { bids: Array.isArray(l?.levels?.[0]) ? l.levels[0].length : 0, asks: Array.isArray(l?.levels?.[1]) ? l.levels[1].length : 0 };
  console.log(JSON.stringify({ ambiente, fonte, instrumento, niveis, melhor: { bid: l?.levels?.[0]?.[0] ?? null, ask: l?.levels?.[1]?.[0] ?? null }, bruto: l }, null, 1));
}

// Só corre quando chamado como programa (importar daqui nao dispara nada).
if (import.meta.main) await main();
