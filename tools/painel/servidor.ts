#!/usr/bin/env bun
// O SERVIDOR DO PAINEL — serve a tela E é a única porta por onde a tela pode PEDIR uma escrita.
//
// PORQUE UM SERVIDOR, E NÃO O `http.server` QUE LÁ ESTAVA. O `python3 -m http.server` só serve ficheiros: não
// aceita um pedido. A opção escolhida pelo dono (`RN-E12`: a web edita com validação e assinatura) exige um
// caminho de escrita, e esse caminho tem de ser **um só** — o mesmo `tools/escrever-ficha` que a linha de comando
// usa. Este servidor não sabe escrever fichas: sabe **pedir** que se escrevam, e quem escreve (valida e regista) é
// o escritor. Não há aqui uma segunda via de execução.
//
// TRÊS GUARDAS, e nenhuma delas é enfeite:
//
//   1. **a origem e um cabeçalho próprio.** O pedido tem de vir da própria tela (`Origin` = este servidor) e trazer
//      um cabeçalho que só a nossa página põe (`X-MesaCore: 1`). Um cabeçalho destes não se põe de fora sem um
//      pedido prévio, que este servidor não responde — uma página aberta na rede não escreve fichas em nome de
//      quem tem o painel aberto;
//   2. **a impressão do que se viu.** Quem pede manda o `sha256` da ficha que tinha à frente, e o escritor recusa se
//      não for a do ficheiro em disco: uma página velha não passa por cima de uma mudança nova;
//   3. **a validação antes de aplicar.** O candidato passa pelo conferidor do portão ANTES de tocar no ficheiro; se
//      reprovar, não se escreve nada. Quem decide isso é o escritor, não este ficheiro.
//
// O QUE ELE NÃO FAZ: não decide nada sobre a operação, não toca em ficheiro nenhum que não seja uma ficha (o
// caminho é resolvido dentro de `fichas/`, no escritor), e não aumenta a superfície para fora da LAN — a ligação
// continua amarrada ao endereço da rede de casa.
//
// Uso:  bun run tools/painel/servidor.ts --porta 8788 --endereco 192.168.15.24 [--pasta web/painel]

import { join, resolve, extname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { escrever, type Mudancas } from "../escrever-ficha/escrever-ficha.ts";

const argv = process.argv.slice(2);
const pega = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORTA = Number(pega("--porta") ?? "8788");
const ENDERECO = pega("--endereco") ?? "127.0.0.1";
const PASTA = resolve(pega("--pasta") ?? join(import.meta.dir, "..", "..", "web", "painel"));
const CORRIDA = pega("--corrida") ?? null;
const ORIGEM = `http://${ENDERECO}:${PORTA}`;

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const responder = (corpo: unknown, estado = 200) =>
  new Response(JSON.stringify(corpo, null, 1), { status: estado, headers: { "content-type": "application/json; charset=utf-8" } });

const servidor = Bun.serve({
  hostname: ENDERECO,
  port: PORTA,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/ficha") {
      if (req.method !== "POST") return responder({ ok: false, porque: "esta porta só aceita POST" }, 405);
      if (req.headers.get("origin") !== ORIGEM) {
        return responder({ ok: false, porque: "o pedido não vem desta tela (origem diferente)" }, 403);
      }
      if (req.headers.get("x-mesacore") !== "1") {
        return responder({ ok: false, porque: "falta o cabeçalho da própria tela" }, 403);
      }
      let corpo: Record<string, unknown>;
      try {
        corpo = (await req.json()) as Record<string, unknown>;
      } catch {
        return responder({ ok: false, porque: "o corpo do pedido está ilegível" }, 400);
      }
      const { ficha, mudancas, visto, simular } = corpo;
      if (typeof ficha !== "string" || mudancas === null || typeof mudancas !== "object" || Array.isArray(mudancas)) {
        return responder({ ok: false, porque: "o pedido não diz que ficha, nem o que mudar" }, 400);
      }
      const r = escrever(ficha, mudancas as Mudancas, {
        visto: typeof visto === "string" ? visto : null,
        simular: simular === true,
        origem: simular === true ? "vista de configuração (simulação)" : "vista de configuração",
      });
      // 409 para o que foi RECUSADO por regra (não é erro do servidor: é a regra a dizer não), 200 quando escreveu
      // ou quando a simulação passou. O log leva sempre a linha: as escritas ficam no log do serviço e no registo.
      // O FIO VELHO MOSTRARIA A FICHA VELHA — e isto foi medido, não suposto: depois de escrever, a tela continuava
      // a mostrar o valor antigo, porque quem renova o retrato é o ciclo de 60 s do `servir.sh`. Uma escrita refaz o
      // retrato de imediato, para o ecrã confirmar o que ficou escrito (o `carregar()` da tela corre a seguir).
      if (r.ok === true && r.escrito === true) {
        const args = [join(import.meta.dir, "retrato.ts")];
        if (CORRIDA !== null) args.push("--corrida", CORRIDA);
        const t = spawnSync("bun", ["run", ...args], { encoding: "utf8", timeout: 60000 });
        if (t.status !== 0) console.log(`retrato: não se refez a seguir à escrita (${t.status}) — o ciclo volta a tentar`);
      }
      console.log(
        `ficha ${r.ok ? (r.escrito ? "ESCRITA" : "simulada") : "RECUSADA"} · ${ficha}` +
          (r.ok ? ` · ${(r.diferencas ?? []).map((d) => `${d.chave}: ${JSON.stringify(d.de)}→${JSON.stringify(d.para)}`).join(", ")}` : ` · ${r.porque}`),
      );
      return responder(r, r.ok ? 200 : 409);
    }

    const pedido = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const caminho = resolve(join(PASTA, pedido));
    // SEM SAIR DA PASTA: um `..` no pedido não vai buscar nada de fora da tela.
    if (caminho !== PASTA && !caminho.startsWith(PASTA + "/")) return new Response("fora da tela", { status: 404 });
    if (!existsSync(caminho) || !statSync(caminho).isFile()) return new Response("não está aqui", { status: 404 });
    return new Response(Bun.file(caminho), {
      // `no-store` de propósito: o dono abre isto no telefone e já perdeu tempo com uma página velha em cache.
      headers: { "content-type": TIPOS[extname(caminho)] ?? "application/octet-stream", "cache-control": "no-store" },
    });
  },
});

console.log(`painel: tela em http://${ENDERECO}:${servidor.port}/index.html  (escrita pela vista, validada antes de aplicar)`);
