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
// Uso:  bun run tools/painel/servidor.ts --porta 8788 --endereco 192.168.15.24 [--pasta web/painel] [--intervalo 60] [--intervalo-vivo 2]
//
// E ELE GERA O FIO. Antes isto era só a outra metade: o `servir.sh` corria dois laços `while` a regenerar o fio e
// este processo servia-o, e a tela dependia de os dois coexistirem — um `servidor.ts` sozinho servia uma pasta sem
// nunca a renovar. Agora é UM processo: serve, aceita a escrita, e gera o fio que serve (o `--para` do retrato é
// sempre dentro de `--pasta`). O `servir.sh` passou a ser o lançador (o que a unit do host corre).

import { join, resolve, extname } from "node:path";
import { existsSync, statSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { escrever, criar, type Mudancas } from "../escrever-ficha/escrever-ficha.ts";

const argv = process.argv.slice(2);
const pega = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORTA = Number(pega("--porta") ?? "8788");
const ENDERECO = pega("--endereco") ?? "127.0.0.1";
const PASTA = resolve(pega("--pasta") ?? join(import.meta.dir, "..", "..", "web", "painel"));
// AS INSTALACOES: repetivel (`--corrida a --corrida b`), como no retrato. Servem para gerar o fio e refaze-lo A
// SEGUIR a uma escrita — sem nenhuma, o retrato descobre as corridas vivas, que e' o mesmo criterio do ciclo.
const CORRIDAS: string[] = [];
const RAIZ_DAS_CORRIDAS = pega("--raiz-das-corridas") ?? null;
for (let i = 0; i < argv.length; i++) if (argv[i] === "--corrida" && argv[i + 1] !== undefined) CORRIDAS.push(argv[i + 1]!);
// A ORIGEM desta tela. `let` porque a porta EFECTIVA so' se sabe depois de o servidor ligar (`--porta 0` pede ao
// sistema uma porta livre, e o `Origin` do browser traz essa, nao o zero que se pediu). Fica corrigida logo abaixo.
let ORIGEM = `http://${ENDERECO}:${PORTA}`;
// O RELOGIO DO FIO: este servidor E' o gerador. Antes disso o `servir.sh` corria dois lacos `while` em segundo
// plano e o servidor era so' a outra metade — a tela dependia de os dois coexistirem, e um `servidor.ts` sozinho
// servia uma pasta sem nunca renovar o fio. Agora ha' UM processo: a tela, a porta de escrita e os dois relogios
// (o retrato completo, ao minuto, e o `agora`, aos dois segundos) vivem aqui. `--intervalo 0` desliga (as provas
// usam-no para não pisar um fio de bancada). O `PARA` do fio e' SEMPRE dentro de `PASTA` — o que ele gera e' o
// que ele serve, e e' isso que impede uma segunda pasta de aparecer a responder.
const INTERVALO = Number(pega("--intervalo") ?? "60");
const INTERVALO_VIVO = Number(pega("--intervalo-vivo") ?? "2");
const ARGS_DAS_CORRIDAS: string[] = [];
for (const c of CORRIDAS) ARGS_DAS_CORRIDAS.push("--corrida", c);
if (RAIZ_DAS_CORRIDAS !== null) ARGS_DAS_CORRIDAS.push("--raiz-das-corridas", RAIZ_DAS_CORRIDAS);

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

/* ============================ A FILA DOS VERBOS (o ciclo de vida da observação) ============================
 * O QUE ESTA PORTA É: um CADERNO DE PEDIDOS. A tela escreve aqui «iniciar» ou «parar» a observação de uma conta,
 * e quem os executa é a CAMADA DE OPERAÇÃO — uma sessão com contexto para lançar e matar processos. Esta porta
 * NÃO executa nada: não há aqui um `spawn`, nem um `kill`, nem uma shell. É a mesma fronteira do porto das
 * fichas, e pelo mesmo motivo: o painel não ganha uma segunda via de execução.
 *
 * VIVE FORA DO REPOSITÓRIO (`~/.config/mesacore/`) porque é estado de OPERAÇÃO, não configuração do produto — e
 * porque o repositório tem famílias de ficheiro contadas. O `pedido` guarda o comando que o executa, para quem
 * consumir a fila não ter de adivinhar o que «iniciar» queria dizer.
 */
const FILA_DOS_VERBOS = join(homedir(), ".config", "mesacore", "pedidos-de-verbo.jsonl");
const VERBOS_CONHECIDOS = new Set(["iniciar", "parar"]);
const CONTA_BOA = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

type Pedido = { id: string; instante_ms: number; verbo: string; conta: string; dir: string | null; comando: string; origem: string };

function lerOsPedidos(): Pedido[] {
  try {
    return readFileSync(FILA_DOS_VERBOS, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Pedido);
  } catch { return []; }
}
function gravarOsPedidos(pedidos: Pedido[]): void {
  mkdirSync(join(homedir(), ".config", "mesacore"), { recursive: true });
  writeFileSync(FILA_DOS_VERBOS, pedidos.map((p) => JSON.stringify(p)).join("\n") + (pedidos.length > 0 ? "\n" : ""));
}
/** O comando que executa o verbo — escrito no próprio pedido, para a fila ser legível por quem a consome. */
function comandoDoVerbo(verbo: string, conta: string, dir: string | null): string {
  if (verbo === "iniciar") return `bash tools/operar-em-observacao.sh ${conta}`;
  return `kill $(cat ${dir ?? "<dir>/operacao-em-observacao.pid"}/operacao-em-observacao.pid)`;
}

/* ========================= A PASTA DAS CREDENCIAIS (fora do repositorio) =========================
 * Um valor por ficheiro, modo 600 — o padrao da casa (RN-E14). A pasta pode ser apontada por `CREDENCIAIS_DIR`:
 * e' assim que a bancada da credencial corre sem tocar nas credenciais do dono (o escritor honra a mesma variavel).
 */
const DIR_DAS_CREDENCIAIS = process.env.CREDENCIAIS_DIR ?? join(homedir(), ".config", "mesacore", "credenciais");

/**
 * A REFERENCIA que a conta declara para a sua credencial (`conexao.credencial.valor_em = ficheiro:<caminho>`).
 * Sai daqui SO' o CAMINHO — o valor nunca se abre (o ficheiro pode nem existir; e' isso que a porta resolve).
 * `null` quando a conta nao declara nada: quem chama cai no nome por omissao (`<pasta>/<conta>.key`).
 */
function lerReferenciaDaCredencial(conta: string): string | null {
  const caminho = join(import.meta.dir, "..", "..", "config", "contas", `${conta}.json`);
  try {
    const c = JSON.parse(readFileSync(caminho, "utf8")) as Record<string, any>;
    const ref = c?.conexao?.credencial?.valor_em;
    if (typeof ref === "string" && ref.startsWith("ficheiro:")) {
      return ref.slice("ficheiro:".length).replace(/^~(?=\/)/, homedir());
    }
  } catch { /* conta ausente ou ilegivel: cai no nome por omissao */ }
  return null;
}

/* ================================ OS DOIS RELOGIOS DO FIO ================================
 * O servidor GERA o fio que serve. Dois relogios, porque sao duas coisas com ritmos proprios (ver o README):
 * o retrato COMPLETO (com as velas e a serie) ao minuto, e o `agora` leve (`--sem-serie`) aos dois segundos.
 * O `--para` e' sempre dentro de `PASTA`: o que ele gera e' exactamente o que ele serve.
 */
const RETRATO = join(import.meta.dir, "retrato.ts");
// Com NOME: um nome diz o que é, e evita o ternário com o literal na ponta (que a catraca dos fallbacks conta,
// com razão — o literal por omissão é a forma do defeito que ela procura).
const FIO_COMPLETO = "painel.json";
const FIO_VIVO = "vivo.json";
const filhos = new Set<Bun.Subprocess>();

/** Corre o retrato uma vez (assincrono, para nao bloquear a tela) e devolve se correu bem. */
async function gerarFio(semSerie: boolean): Promise<boolean> {
  const para = join(PASTA, semSerie ? FIO_VIVO : FIO_COMPLETO);
  const args = ["run", RETRATO, ...ARGS_DAS_CORRIDAS, "--para", para];
  if (semSerie) args.push("--sem-serie");
  const p = Bun.spawn(["bun", ...args], { stdout: "ignore", stderr: "pipe" });
  filhos.add(p);
  try {
    const codigo = await p.exited;
    if (codigo !== 0) {
      const erro = await new Response(p.stderr as ReadableStream<Uint8Array>).text();
      console.log(`retrato: falhou nesta volta (${codigo}) — o anterior fica na tela · ${erro.trim().split("\n").pop() ?? ""}`);
      return false;
    }
    return true;
  } finally {
    filhos.delete(p);
  }
}

let cicloCompleto: ReturnType<typeof setInterval> | null = null;
let cicloVivo: ReturnType<typeof setInterval> | null = null;
let aGerarCompleto = false;
let aGerarVivo = false;

async function voltaCompleta(): Promise<void> {
  if (aGerarCompleto) return;
  aGerarCompleto = true;
  try { await gerarFio(false); } finally { aGerarCompleto = false; }
}
async function voltaViva(): Promise<void> {
  if (aGerarVivo) return;
  aGerarVivo = true;
  try { await gerarFio(true); } finally { aGerarVivo = false; }
}

/** Comeca os dois relogios: uma volta imediata (a tela nao abre vazia) e o intervalo. */
function comecarOsCiclos(): void {
  if (INTERVALO > 0) {
    void voltaCompleta();
    cicloCompleto = setInterval(() => void voltaCompleta(), INTERVALO * 1000);
  }
  if (INTERVALO_VIVO > 0) {
    void voltaViva();
    cicloVivo = setInterval(() => void voltaViva(), INTERVALO_VIVO * 1000);
  }
}

/** Os filhos do retrato morrem com o servidor — nunca fica um `bun` orfao a ler ficheiros. */
function parar(): void {
  if (cicloCompleto !== null) clearInterval(cicloCompleto);
  if (cicloVivo !== null) clearInterval(cicloVivo);
  for (const p of filhos) { try { p.kill(); } catch { /* ja' morreu */ } }
}
for (const sinal of ["SIGTERM", "SIGINT"] as const) process.on(sinal, () => { parar(); process.exit(0); });

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
      const { ficha, mudancas, conteudo, visto, simular, criar: eCriar } = corpo;
      // CRIAR E ESCREVER PASSAM PELA MESMA PORTA e pelo mesmo escritor — muda só o que os guarda: escrever exige
      // a impressão do que se viu; criar exige que o ficheiro NÃO exista (criar não é sobrepor).
      if (eCriar === true) {
        if (typeof ficha !== "string" || conteudo === null || typeof conteudo !== "object" || Array.isArray(conteudo)) {
          return responder({ ok: false, porque: "para criar é preciso o caminho do documento e o conteúdo (um objecto JSON)" }, 400);
        }
        const r = criar(ficha, conteudo as Record<string, unknown>, {
          simular: simular === true,
          origem: simular === true ? "vista de configuração (criação simulada)" : "vista de configuração (criação)",
        });
        if (r.ok === true && r.escrito === true) await voltaCompleta();
        console.log(`documento ${r.ok ? (r.escrito ? "CRIADO" : "criação simulada") : "RECUSADO (criação)"} · ${ficha}` + (r.ok ? "" : ` · ${r.porque}`));
        return responder(r, r.ok ? 200 : 409);
      }
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
      // a mostrar o valor antigo, porque quem renova o retrato é o ciclo de 60 s. Uma escrita refaz o retrato de
      // imediato (a volta COMPLETA, aqui mesmo), para o ecrã confirmar o que ficou escrito (o `carregar()` da tela
      // corre a seguir).
      if (r.ok === true && r.escrito === true) await voltaCompleta();
      console.log(
        `ficha ${r.ok ? (r.escrito ? "ESCRITA" : "simulada") : "RECUSADA"} · ${ficha}` +
          (r.ok ? ` · ${(r.diferencas ?? []).map((d) => `${d.chave}: ${JSON.stringify(d.de)}→${JSON.stringify(d.para)}`).join(", ")}` : ` · ${r.porque}`),
      );
      return responder(r, r.ok ? 200 : 409);
    }

    if (url.pathname === "/api/verbo") {
      // A GUARDA É SOBRE A ESCRITA. O `Origin` não viaja num GET da própria página (o browser só o põe em
      // pedidos que MUDAM — e foi isso que se mediu: o GET da fila levava 403 por falta de `Origin`, não por
      // vir de fora). Ler a fila pede o cabeçalho da própria tela; ESCREVER ou CANCELAR pede também a origem.
      const ehEscrita = req.method === "POST" || req.method === "DELETE";
      if (req.headers.get("x-mesacore") !== "1") {
        return responder({ ok: false, porque: "falta o cabeçalho da própria tela" }, 403);
      }
      if (ehEscrita && req.headers.get("origin") !== ORIGEM) {
        return responder({ ok: false, porque: "o pedido não vem desta tela (origem diferente)" }, 403);
      }
      if (req.method === "GET") return responder({ ok: true, pedidos: lerOsPedidos() });

      let corpo: Record<string, unknown>;
      try {
        corpo = (await req.json()) as Record<string, unknown>;
      } catch {
        return responder({ ok: false, porque: "o corpo do pedido está ilegível" }, 400);
      }

      if (req.method === "DELETE") {
        const id = corpo.id;
        if (typeof id !== "string") return responder({ ok: false, porque: "não se disse qual pedido cancelar" }, 400);
        const antes = lerOsPedidos();
        const depois = antes.filter((p) => p.id !== id);
        if (depois.length === antes.length) return responder({ ok: false, porque: `não há pedido com o id ${id}` }, 404);
        gravarOsPedidos(depois);
        console.log(`verbo CANCELADO · ${id}`);
        return responder({ ok: true, pedidos: depois });
      }
      if (req.method !== "POST") return responder({ ok: false, porque: "esta porta aceita GET, POST e DELETE" }, 405);

      const verbo = corpo.verbo;
      const conta = corpo.conta;
      const dir = corpo.dir;
      if (typeof verbo !== "string" || !VERBOS_CONHECIDOS.has(verbo)) {
        return responder({ ok: false, porque: `verbo desconhecido («${String(verbo)}»): os que existem são ${[...VERBOS_CONHECIDOS].join(", ")}` }, 400);
      }
      if (typeof conta !== "string" || !CONTA_BOA.test(conta)) {
        return responder({ ok: false, porque: "a conta não tem forma de nome de conta" }, 400);
      }
      if (dir !== null && dir !== undefined && (typeof dir !== "string" || !dir.startsWith("/"))) {
        return responder({ ok: false, porque: "a pasta da corrida tem de ser um caminho absoluto" }, 400);
      }
      const pastaDaCorrida = typeof dir === "string" ? dir : null;
      const pedido: Pedido = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        instante_ms: Date.now(),
        verbo,
        conta,
        dir: pastaDaCorrida,
        comando: comandoDoVerbo(verbo, conta, pastaDaCorrida),
        origem: "painel",
      };
      // PEDIR DUAS VEZES A MESMA COISA NÃO É PEDIR DUAS VEZES: o pedido novo substitui o anterior daquela
      // conta+verbo (a fila não cresce com repetições do mesmo gesto).
      const todos = [...lerOsPedidos().filter((p) => !(p.verbo === verbo && p.conta === conta)), pedido];
      gravarOsPedidos(todos);
      console.log(`verbo PEDIDO · ${verbo} ${conta} · ${pedido.comando}`);
      return responder({ ok: true, pedido, pedidos: todos });
    }

    /* ============================ A CREDENCIAL (o valor vive fora, e a tela so' mostra a FORMA) ============
     * O QUE ESTA PORTA E': a MESMA porta de escrita que ja' existe (`tools/guardar-credencial.sh`), estendida com
     * um modo que le' o valor pelo STDIN. A tela cola o VALOR de uma chave e ele fica gravado no padrao da casa —
     * um ficheiro por valor, FORA do repositorio, modo 600 — e a conta continua a apontar-lhe por REFERENCIA.
     *
     * AS GUARDAS, e o que NAO passa:
     *   - origem + cabecalho proprio (as MESMAS da porta das fichas): outra pagina na LAN nao grava em nome de quem
     *     tem o painel aberto;
     *   - o VALOR NUNCA entra no fio, num log, num argumento de comando ou no historico: ele vai pelo stdin do
     *     processo, e a resposta ao browser leva so' a FORMA (comprimento + primeiros) e a IMPRESSAO (sha256);
     *   - o ficheiro tem de viver na pasta das credenciais (o guarda esta' no escritor E aqui);
     *   - escrita atomica, e o registo (instante, ficheiro, origem, impressao) faz-se no ESCRITOR, fora do repo.
     */
    if (url.pathname === "/api/credencial") {
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
      const { conta, valor, ficheiro } = corpo;
      if (typeof conta !== "string" || !CONTA_BOA.test(conta)) {
        return responder({ ok: false, porque: "a conta não tem forma de nome de conta" }, 400);
      }
      if (typeof valor !== "string" || valor === "") {
        return responder({ ok: false, porque: "não veio valor nenhum para gravar" }, 400);
      }
      // O CAMINHO: o que o dono indicou (se dentro da pasta) ou a REFERENCIA que a conta ja' declara.
      let caminho: string;
      if (typeof ficheiro === "string" && ficheiro !== "") {
        caminho = ficheiro;
      } else {
        const declarado = lerReferenciaDaCredencial(conta);
        caminho = declarado ?? join(DIR_DAS_CREDENCIAIS, `${conta}.key`);
      }
      if (caminho !== DIR_DAS_CREDENCIAIS && !caminho.startsWith(DIR_DAS_CREDENCIAIS + "/")) {
        return responder({ ok: false, porque: `o ficheiro da credencial tem de viver em ${DIR_DAS_CREDENCIAIS}` }, 400);
      }
      const escritor = join(import.meta.dir, "..", "guardar-credencial.sh");
      const p = Bun.spawn(["bash", escritor, "gravar-de-stdin", caminho, "--origem", "vista de configuração"], {
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
        env: { ...process.env, CREDENCIAIS_DIR: DIR_DAS_CREDENCIAIS },
      });
      p.stdin.write(valor);              // O VALOR VAI PELO STDIN — nunca num argumento (nao fica no `ps`)
      p.stdin.end();
      const codigo = await p.exited;
      const saida = (await new Response(p.stdout as ReadableStream<Uint8Array>).text()) + (await new Response(p.stderr as ReadableStream<Uint8Array>).text());
      // A FORMA e a IMPRESSAO vem do ESCRITOR; o servidor nao recalcula nada (uma conta, um dono). E NUNCA se
      // registam o valor: o `/api/credencial` so' imprime o caminho e o veredicto.
      const forma = /forma: (\d+) caracteres, a comecar por «([^»]*)»/.exec(saida);
      const impressao = /impressao: ([0-9a-f]{64})/.exec(saida)?.[1] ?? null;
      console.log(`credencial ${codigo === 0 ? "GRAVADA" : "RECUSADA"} · ${caminho} · conta ${conta}`);
      return responder(
        { ok: codigo === 0, ficheiro: caminho, forma: forma ? { comprimento: Number(forma[1]), primeiros: forma[2] } : null, impressao, porque: codigo === 0 ? null : saida.trim() },
        codigo === 0 ? 200 : 409,
      );
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

// A PORTA EFECTIVA (o `--porta 0` pede uma livre): a origem da tela tem de ser ESTA, senao o guarda do `Origin`
// recusava todos os pedidos da propria pagina.
ORIGEM = `http://${ENDERECO}:${servidor.port}`;

console.log(`painel: tela em http://${ENDERECO}:${servidor.port}/index.html  (escrita pela vista, validada antes de aplicar)`);
console.log(`painel: o fio é gerado AQUI — retrato a cada ${INTERVALO}s · agora a cada ${INTERVALO_VIVO}s · para ${PASTA}/painel.json`);
comecarOsCiclos();
