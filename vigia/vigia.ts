#!/usr/bin/env bun
// O VIGIA: a camada de operacao (RN-E21).
//
// Ele e quem ARRANCA a mesa (FR-005): o core nao arranca processos. E e ele que corre as SEIS PORTAS antes
// de pedir `start`, porque e ele que tem as cinco pecas que as portas pedem - a configuracao do dono, o
// manifesto que o conector mandou, as marcas, o registo de operacao (o dele) e o conferidor de inventario.
//
// O que ele NAO faz. Nao decide risco, nao escolhe estado, nao interpreta marcas: isso e da mesa, e a
// resposta que sai daqui e a resposta QUE A MESA DEU. O vigia acrescenta-lhe so o que ele sabe e a mesa nao
// (qual das seis portas recusou, ate onde se chegou a olhar) - e guarda a transicao no registro dele.
//
// Uma linha entra, uma linha sai - a mesma forma da mesa, para a web e o vigia falarem a mesma lingua.
//
// Uso:
//   echo '<comando>' | bun run vigia/vigia.ts --config f.json --manifesto m.json [--uma-linha]
//        [--marcas f] [--registo f.json] [--portas f.json] [--registo-retomavel true|false]
//        [--inventario auto|falso] [--posicao-viva true|false]

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { validar, versaoVigente } from "../contracts/esqueleto/framing.ts";
import { TRADUCAO } from "../core/servidor.ts";
import { arrancar } from "../core/ciclo/arranque.ts";
import { lerMarcas } from "../core/estado/marcas.ts";
import { motivoConhecido } from "../core/livro-de-motivos.ts";
import { inventarioASerio } from "../tools/verificar-maquina/inventario-do-arranque.ts";
import { acrescentar, anotarLeitura, anotarProcesso, lerRegisto, type PerguntaRegistada, type TransicaoDoVigia } from "./registro.ts";

const RAIZ = join(import.meta.dir, "..");

/**
 * O MAPA nome -> duble. Isto e um DUBLE, e esta dito (RN-E17): o conector a serio e um recorte proprio.
 *
 * Os nomes que a configuracao declara (`conta.conectores`) resolvem-se AQUI, e nao vem do dono o comando:
 * que software corre e assunto do host, nao da configuracao da conta. No recorte do plugin, este mapa passa
 * a vir do registo de plugins; hoje resolve os dublês de `contracts/mocks/`.
 */
const DUBLE: Record<string, string[]> = {
  mock_conector: ["uv", "run", "python", join(RAIZ, "contracts", "mocks", "conector", "main.py")],
};

/** Quanto se espera por um conector antes de o dar por NAO de pe. */
const JANELA_DE_PROVA_MS = 400;

/**
 * ARRANCA OS CONECTORES que a configuracao nomeia (RN-E21, FR-005) e diz quais estao de pe.
 *
 * A prontidao e «continua vivo depois da janela». Nao e uma prova de ligacao - o protocolo do conector
 * (RN-E20) e que a da, e esse dia muda esta sonda. Enquanto nao houver protocolo, o que se mede e a PORTA:
 * quem nao subiu nao esta de pe, e a mesa recusa o arranque dizendo QUAL.
 */
export async function subirConectores(
  config: any,
  caminhoDoRegisto?: string,
): Promise<{ dePe: string[]; processos: ChildProcess[] }> {
  const nomeados = Array.isArray(config?.conectores) ? config.conectores.map(String) : [];
  const processos: ChildProcess[] = [];
  const vivos: { nome: string; proc: ChildProcess }[] = [];

  for (const nome of nomeados) {
    const comando = DUBLE[nome];
    if (comando === undefined) continue; // nao ha duble declarado com este nome: nao esta de pe
    try {
      // Os canos de saida do conector vao para o lixo, e nao para os canos de quem corre o vigia: um
      // conector vivo a segurar o `stdout` de quem chamou faria a bancada esperar por um processo que nao
      // e dela (medido: foi o que pendurou a primeira corrida). Os diagnosticos do duble perdem-se aqui, e
      // isso esta declarado - o plugin a serio reporta pelo protocolo (RN-E20), nao por texto solto.
      const proc = spawn(comando[0]!, comando.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
      proc.on("error", () => {
        /* subir falhou: a lista de de-pe e que decide, e um processo que nao subiu nao a entra */
      });
      processos.push(proc);
      CONECTORES_LEVANTADOS.push(proc);
      if (caminhoDoRegisto) {
        anotarProcesso(caminhoDoRegisto, { instante_ms: Date.now(), papel: "conector", nome, pid: proc.pid });
      }
      vivos.push({ nome, proc });
    } catch {
      /* idem */
    }
  }

  await new Promise((resolver) => setTimeout(resolver, JANELA_DE_PROVA_MS));
  const dePe = vivos.filter(({ proc }) => proc.exitCode === null && !proc.killed).map(({ nome }) => nome);
  return { dePe, processos };
}

/**
 * O VIGIA LEVA CONSIGO O QUE LEVANTOU.
 *
 * Os conectores nascem com o vigia e saem com ele: quem os arranca e a camada de operacao (RN-E21), e um
 * processo que sobrevive ao dono sem ninguem que o recolha e um orfao a segurar uma ligacao. A MESA nao sai
 * com o vigia (FR-006) - ela continua com a leitura que tem, e reconciliar nao precisa de conector vivo.
 *
 * Quem os deve manter de pe FORA do vigia (um servico do host, por exemplo) e decisao de host, e nao se
 * decide aqui: fica declarado para o recorte em que isso for preciso.
 */
const CONECTORES_LEVANTADOS: ChildProcess[] = [];
process.on("exit", () => {
  for (const p of CONECTORES_LEVANTADOS) {
    try { p.kill(); } catch { /* ja morreu */ }
  }
});

export interface Opcoes {
  caminhoDaConfig: string;
  caminhoDoManifesto: string;
  caminhoDasMarcas: string;
  caminhoDoRegisto: string;
  caminhoDasPortas: string;
  /** O LEDGER da mesa: e onde o vigia LE o estado dela no regresso (T029). */
  caminhoDoLedger: string;
  /** O estado lido no regresso, quando a costura com a mesa ja nao existe (T029). */
  estadoLido?: string;
  /** O RELOGIO: o periodo e a operacao vao para a mesa. Sem eles a mesa so age quando lhe falam - e a
   *  morte do vigia pararia a operacao, que e o contrario da FR-006 (e o que a US2 mede). */
  tickMs?: number;
  caminhoDaOperacao?: string;
  registoRetomavel: boolean;
  inventario: "auto" | "falso";
  posicaoViva?: boolean;
}

export function lerArgumentos(argv: string[]): Opcoes {
  const o: Partial<Opcoes> = {
    caminhoDasMarcas: join(RAIZ, "core", "estado", ".marcas.json"),
    caminhoDoRegisto: join(RAIZ, "vigia", ".vigia.json"),
    caminhoDasPortas: join(RAIZ, "vigia", ".arranque.json"),
    caminhoDoLedger: join(RAIZ, "core", "estado", ".registo.jsonl"),
    inventario: "auto",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") o.caminhoDaConfig = argv[++i];
    else if (a === "--ledger") o.caminhoDoLedger = argv[++i];
    else if (a === "--tick") o.tickMs = Number(argv[++i]);
    else if (a === "--operacao") o.caminhoDaOperacao = argv[++i];
    else if (a === "--manifesto") o.caminhoDoManifesto = argv[++i];
    else if (a === "--marcas") o.caminhoDasMarcas = argv[++i];
    else if (a === "--registo") o.caminhoDoRegisto = argv[++i];
    else if (a === "--portas") o.caminhoDasPortas = argv[++i];
    else if (a === "--registo-retomavel") o.registoRetomavel = argv[++i] === "true";
    else if (a === "--inventario") o.inventario = argv[++i] === "falso" ? "falso" : "auto";
    else if (a === "--posicao-viva") o.posicaoViva = argv[++i] === "true";
  }
  return o as Opcoes;
}

/** A mesa como PROCESSO filho: o vigia arranca-a, fala-lhe uma linha de cada vez e ouve uma de volta. */
class MesaFilha {
  private proc: ChildProcess;
  private buffer = "";
  private espera: ((linha: string) => void) | null = null;
  /**
   * AS LINHAS JA CHEGADAS E AINDA NAO LIDAS.
   *
   * A mesa pode falar DUAS vezes para um comando (em `encerrando`: a resposta e a pergunta). Sem esta fila, a
   * segunda linha chegava quando ninguem a esperava e era DESCARTADA - e o vigia ficava a olhar para a
   * pergunta seguinte como se fosse a resposta do comando anterior. Medido antes de a fila existir: a
   * resposta de um comando a chegar com o `pedido_id` do outro.
   */
  private pendentes: string[] = [];

  constructor(opcoes: Opcoes) {
    const args = [
      "run",
      join(RAIZ, "core", "servidor.ts"),
      "--marcas", opcoes.caminhoDasMarcas,
      "--portas", opcoes.caminhoDasPortas,
      // O LEDGER vem daqui e nao do valor por omissao da mesa: o caminho tem UM dono (o vigia), e assim o
      // que ele le no regresso e exactamente o que a mesa escreveu.
      "--registo", opcoes.caminhoDoLedger,
    ];
    if (opcoes.posicaoViva !== undefined) args.push("--posicao-viva", String(opcoes.posicaoViva));
    // O RELOGIO da mesa: quem o arma e o vigia (a camada de operacao), e a mesa fica com ele depois de o
    // vigia morrer. A configuracao e a mesma que o vigia ja le para as portas - uma so leitura da mesma
    // declaracao.
    if (opcoes.tickMs !== undefined) {
      args.push("--tick", String(opcoes.tickMs), "--operacao", opcoes.caminhoDaOperacao ?? "", "--config", opcoes.caminhoDaConfig);
    }
    this.proc = spawn("bun", args, { stdio: ["pipe", "pipe", "inherit"] });
    // Quem o vigia levantou fica escrito: sem isto, um pid vivo na maquina e uma ligacao que ninguem sabe
    // de quem e - e a bancada da orfandade nao tem por onde matar o que ficou a operar.
    if (opcoes.caminhoDoRegisto) {
      anotarProcesso(opcoes.caminhoDoRegisto, { instante_ms: Date.now(), papel: "mesa", nome: "mesa", pid: this.proc.pid });
    }
    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (pedaco: string) => {
      this.buffer += pedaco;
      let corte = this.buffer.indexOf("\n");
      while (corte >= 0) {
        const linha = this.buffer.slice(0, corte);
        this.buffer = this.buffer.slice(corte + 1);
        const quem = this.espera;
        if (quem) {
          this.espera = null;
          quem(linha);
        } else {
          this.pendentes.push(linha);
        }
        corte = this.buffer.indexOf("\n");
      }
    });
  }

  enviar(linha: string): Promise<string> {
    this.proc.stdin!.write(linha + "\n");
    return this.proxima();
  }

  /** A proxima linha da mesa: da fila, ou a espera dela. Com prazo - uma mesa muda nao pode pendurar isto. */
  proxima(ms = 60000): Promise<string> {
    const jaTem = this.pendentes.shift();
    if (jaTem !== undefined) return Promise.resolve(jaTem);
    return new Promise((resolver, rejeitar) => {
      const relogio = setTimeout(() => {
        this.espera = null;
        rejeitar(new Error(`a mesa nao respondeu em ${ms}ms`));
      }, ms);
      this.espera = (l) => { clearTimeout(relogio); resolver(l); };
    });
  }

  fechar() {
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

/** As sete portas, corridas AQUI (e nao na mesa): e o vigia que tem as pecas que elas pedem. */
export function correrAsPortas(opcoes: Opcoes, conectoresDePe: string[] = []) {
  const bruto = JSON.parse(readFileSync(opcoes.caminhoDoManifesto, "utf8"));
  const manifesto = bruto?.carga ?? bruto; // aceita a mensagem inteira ou so a carga
  const config = JSON.parse(readFileSync(opcoes.caminhoDaConfig, "utf8"));
  const portaDoInventario =
    opcoes.inventario === "falso"
      ? () => ({ ok: false, problemas: ["(bateria) o conferidor do inventario reprovou de proposito"] })
      : inventarioASerio;
  const r = arrancar({
    manifesto,
    config,
    marcas: lerMarcas(opcoes.caminhoDasMarcas),
    registo_retomavel: opcoes.registoRetomavel,
    conectores_de_pe: conectoresDePe,
    portaDoInventario,
  });
  return {
    passam: r.arrancou,
    porta: r.porta,
    motivo: r.motivo,
    porque: r.porque,
    detalhe: r.detalhe,
    conferidas: r.portas_conferidas,
  };
}

/** Só o que se chegou a olhar vai para a mesa: um desfecho sem a lista seria uma afirmacao sem prova. */
function gravarDesfecho(opcoes: Opcoes, d: ReturnType<typeof correrAsPortas>) {
  const temporario = opcoes.caminhoDasPortas + ".tmp";
  writeFileSync(temporario, JSON.stringify({ passam: d.passam, porta: d.porta, motivo: d.motivo }) + "\n");
  renameSync(temporario, opcoes.caminhoDasPortas);
}

export async function atender(linha: string, mesa: MesaFilha | null, opcoes: Opcoes): Promise<string> {
  const decisao = validar(linha);
  if (decisao.veredicto !== "aceite") {
    const motivo = TRADUCAO[decisao.motivo ?? ""] ?? "comando_com_tipo_invalido";
    let id: unknown = null;
    let pedido: string | null = null;
    try {
      const cru = JSON.parse(linha) as { id?: unknown; carga?: { pedido_id?: unknown } };
      id = cru?.id ?? null;
      pedido = typeof cru?.carga?.pedido_id === "string" ? cru.carga.pedido_id : null;
    } catch { /* nem e JSON: o motivo do contrato ja o disse */ }
    return respostaDoVigia(id, pedido ?? "sem_pedido", motivo);
  }
  const envelope = JSON.parse(linha) as { id?: unknown; tipo?: string; carga?: Record<string, unknown> };
  // DOIS tipos atravessam este vigia (T034): o `comando` e a `decisao_do_encerramento`. Todo o resto e
  // recusado - a porta do vigia nao se alarga sozinha.
  const ehDecisao = envelope.tipo === "decisao_do_encerramento";
  if (envelope.tipo !== "comando" && !ehDecisao) {
    return respostaDoVigia(envelope.id, "sem_pedido", "comando_com_tipo_invalido");
  }

  const carga = envelope.carga ?? {};
  const pedidoId = typeof carga.pedido_id === "string" ? carga.pedido_id : "sem_pedido";
  // A decisao nao e um verbo, e o registro diz o que o vigia SERVIL: por isso o campo leva o nome da decisao,
  // e nao um sexto verbo - o contrato tem cinco, e um sexto nao entra nem por omissao nem por extensao.
  const verbo = ehDecisao ? "decisao_do_encerramento" : (typeof carga.verbo === "string" ? carga.verbo : "(sem verbo)");

  let desfecho: ReturnType<typeof correrAsPortas> | null = null;
  let conectores: ChildProcess[] = [];
  if (verbo === "start") {
    // T027: o vigia ARRANCA os conectores que a configuracao nomeia e diz quais estao de pe. Quem decide
    // se isso chega e a mesa (a porta dos conectores); aqui so se levanta o facto.
    const config = JSON.parse(readFileSync(opcoes.caminhoDaConfig, "utf8"));
    const subida = await subirConectores(config, opcoes.caminhoDoRegisto);
    conectores = subida.processos;
    desfecho = correrAsPortas(opcoes, subida.dePe);
    gravarDesfecho(opcoes, desfecho);
    // Um arranque RECUSADO nao deixa conectores de pe: subiram para o arranque, e o arranque nao houve.
    if (!desfecho.passam) for (const p of conectores) p.kill();
  }

  if (mesa === null) {
    // A MESA JA ESTA A OPERAR e a costura morreu com o vigia antigo (T029): o vigia novo nao arranca uma
    // segunda mesa (RN-E7: um so escritor no ledger) e nao inventa uma costura que nao tem.
    const t: TransicaoDoVigia = {
      instante_ms: Date.now(),
      verbo,
      autor: typeof carga.autor === "string" ? carga.autor : "(sem autor)",
      pedido_id: pedidoId,
      aceito: false,
      de: opcoes.estadoLido ?? "(nao se leu)",
      para: opcoes.estadoLido ?? "(nao se leu)",
      motivo: "mesa_ja_em_operacao",
      efeito: null,
      porta: null,
      motivo_da_porta: null,
      detalhe_da_porta: null,
      portas_conferidas: [],
      pergunta: null,
    };
    acrescentar(opcoes.caminhoDoRegisto, t);
    return respostaDoVigia(envelope.id, pedidoId, "mesa_ja_em_operacao", opcoes.estadoLido);
  }

  const linhaDaMesa = await mesa.enviar(linha);
  // EM `encerrando` A MESA FALA DUAS VEZES: a resposta e a pergunta. A segunda linha so se le quando a
  // primeira DIZ que a mesa entrou em `encerrando` - ler por adivinhacao ou por tempo traria a pergunta de
  // outro comando, e uma pergunta trocada e um resumo do encerramento com numeros que nao sao deste momento.
  let linhaDaPergunta: string | undefined;
  try {
    const transicao = (JSON.parse(linhaDaMesa) as { carga?: { transicao?: { para?: string } } }).carga?.transicao;
    // A SEGUNDA LINHA SO VEM DE UM COMANDO QUE ABRE O ENCERRAMENTO. A decisao do dono que escolhe `fechar`
    // tambem deixa a mesa em `encerrando` - mas nao ha pergunta nenhuma atras dela, e esperar por uma
    // pendurava o vigia (medido: 60s de espera, e a resposta ao dono nunca chegava).
    const abreEncerramento = verbo === "stop" && !ehDecisao && transicao?.para === "encerrando";
    if (abreEncerramento) linhaDaPergunta = await mesa.proxima(10000);
  } catch { /* a resposta nao se leu: o registro di-lo abaixo */ }
  const brutoDaMesa = linhaDaPergunta ? linhaDaMesa + "\n" + linhaDaPergunta : linhaDaMesa;
  let c: Record<string, unknown> = {};
  try { c = (JSON.parse(linhaDaMesa ?? "") as { carga?: Record<string, unknown> }).carga ?? {}; } catch { /* fica vazio */ }
  let pergunta: PerguntaRegistada | null = null;
  if (linhaDaPergunta) {
    try {
      const p = JSON.parse(linhaDaPergunta) as { carga?: Record<string, unknown> };
      if (p?.carga) {
        pergunta = {
          pedido_id: typeof p.carga.pedido_id === "string" ? p.carga.pedido_id : null,
          prazo_de_resposta_ms: Number.isInteger(p.carga.prazo_de_resposta_ms) ? (p.carga.prazo_de_resposta_ms as number) : null,
          aviso_de_manter: typeof p.carga.aviso_de_manter === "string" ? p.carga.aviso_de_manter : null,
          opcoes: Array.isArray(p.carga.opcoes) ? (p.carga.opcoes as string[]) : [],
          numeros: (p.carga.numeros as Record<string, string>) ?? null,
        };
      }
    } catch { /* a segunda linha ilegivel nao se inventa; fica `null` e o registro di-lo */ }
  }
  const transicao = (c.transicao ?? {}) as { de?: string; para?: string };

  const t: TransicaoDoVigia = {
    instante_ms: Number.isInteger(c.instante_ms) ? (c.instante_ms as number) : Date.now(),
    verbo,
    autor: typeof carga.autor === "string" ? carga.autor : "(sem autor)",
    pedido_id: pedidoId,
    aceito: c.aceito === true,
    de: transicao.de ?? "(nao se leu)",
    para: transicao.para ?? "(nao se leu)",
    motivo: typeof c.motivo === "string" ? c.motivo : null,
    efeito: typeof c.efeito === "string" ? c.efeito : null,
    porta: desfecho?.porta ?? null,
    motivo_da_porta: desfecho?.motivo ?? null,
    detalhe_da_porta: desfecho?.detalhe ?? null,
    portas_conferidas: desfecho?.conferidas ?? [],
    pergunta,
  };
  acrescentar(opcoes.caminhoDoRegisto, t);
  return brutoDaMesa;
}

/**
 * O ESTADO DA MESA, lido do LEDGER (T029).
 *
 * A mesa nao persiste o estado (R3): o que sobrevive sao as marcas. Mas o que ela ESCREVEU sobrevive - e a
 * ultima transicao do ledger e o estado dela, escrito por ela. Por isso se le daqui, e nunca da memoria do
 * vigia: a memoria dele morreu com ele, que e precisamente o ponto da US2.
 *
 * Tres respostas, e a do meio e a que custa:
 *  - nao havia ledger: nada a retomar, a mesa esta `parada` (um primeiro arranque nao e uma perda);
 *  - havia e leu-se: o estado e o da ultima transicao;
 *  - havia e NAO se leu: `lido: false`. O vigia NAO arranca uma mesa nova por cima de um ledger ilegivel -
 *    podia haver uma a operar, e dois escritores no mesmo ledger e o que a RN-E7 proibe.
 */
export function lerEstadoDoLedger(caminho: string): { estado: string; lido: boolean; de: string } {
  if (!existsSync(caminho)) return { estado: "parada", lido: true, de: `${caminho} (sem ledger: primeiro arranque)` };
  try {
    const linhas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");
    for (let i = linhas.length - 1; i >= 0; i--) {
      const l = JSON.parse(linhas[i]!) as { tipo?: string; para?: string };
      if (l.tipo === "transicao" && typeof l.para === "string") return { estado: l.para, lido: true, de: caminho };
    }
    return { estado: "parada", lido: true, de: `${caminho} (sem transicao: nada a retomar)` };
  } catch {
    return { estado: "(nao se leu)", lido: false, de: `${caminho} (ilegivel)` };
  }
}

/** Nao responde a mesa: responde o VIGIA, quando nem chegou a valer a pena incomodar a mesa.
 *  O estado que se declara e o que se sabe - e quando a mesa esta a operar e a costura nao existe, o que se
 *  sabe e o estado LIDO: dizer `parada->parada` seria uma mentira pequena na propria recusa. */
function respostaDoVigia(id: unknown, pedidoId: string, motivo: string, estado?: string): string {
  const motivoFinal = motivoConhecido(motivo) ? motivo : "comando_com_tipo_invalido";
  return JSON.stringify({
    contrato: versaoVigente(),
    tipo: "resposta_de_comando",
    id: typeof id === "string" ? id : "sem_id",
    carga: {
      pedido_id: pedidoId,
      aceito: false,
      motivo: motivoFinal,
      transicao: { de: estado ?? "parada", para: estado ?? "parada" },
      instante_ms: Date.now(),
    },
  });
}

/** O registo de OPERACAO foi retomado? Tres respostas, e a do meio e a que custa:
 *  - nao havia registo: nada a retomar, e a mesa arranca (um primeiro arranque nao e uma perda);
 *  - havia e leu-se: retomou-se;
 *  - havia e NAO se leu: nao arranca - um registo ilegivel esconde operacao feita, e arrancar por cima
 *    disso e operar sem saber o que ja foi feito (FR-031). */
function registoFoiRetomado(caminho: string): boolean {
  if (!existsSync(caminho)) return true;
  try {
    JSON.parse(readFileSync(caminho, "utf8"));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const umaLinha = process.argv.includes("--uma-linha");
  if (opcoes.registoRetomavel === undefined) opcoes.registoRetomavel = registoFoiRetomado(opcoes.caminhoDoRegisto);

  // T029 - O REGRESSO. Antes de servir seja o que for, o vigia LE o estado da mesa no LEDGER dela; e a
  // leitura fica anotada (nao e transicao: nao obedeceu verbo nenhum).
  const lida = lerEstadoDoLedger(opcoes.caminhoDoLedger);
  anotarLeitura(opcoes.caminhoDoRegisto, {
    instante_ms: Date.now(),
    estado_da_mesa: lida.estado,
    de: lida.de,
    porque: lida.lido
      ? "Leitura no regresso: o estado vem do ledger da mesa, e nao da memoria do vigia."
      : "O ledger existe e nao se leu: o vigia NAO arranca uma mesa nova por cima dele (dois escritores no mesmo ledger).",
  });

  // Com a mesa A OPERAR (ou com o ledger ilegivel), o vigia NAO arranca uma segunda mesa: a costura morreu
  // com o vigia antigo e a mesa orfa continua a escrever no mesmo ledger (RN-E7).
  const semCostura = !lida.lido || lida.estado !== "parada";
  opcoes.estadoLido = lida.estado;
  const mesa = semCostura ? null : new MesaFilha(opcoes);

  const rl = createInterface({ input: process.stdin });
  for await (const linha of rl) {
    if (linha.trim() === "") continue;
    process.stdout.write((await atender(linha, mesa, opcoes)) + "\n");
    if (umaLinha) break;
  }

  // FIM DA ENTRADA: a costura fechou. A MESMA REGRA DA MESA, do outro lado da fronteira: quem tem operacao
  // nas maos NAO sai porque o cano fechou. Sem operacao - a ultima transicao que ele proprio registou e
  // `parada` - recolhe o que levantou e sai; `--uma-linha` (o instrumento da bancada) sai sempre, e diz.
  const ultima = lerRegisto(opcoes.caminhoDoRegisto).transicoes.at(-1) as TransicaoDoVigia | undefined;
  const emOperacao = ["em_operacao", "pausada", "encerrando"].includes(ultima?.para ?? "");
  if (umaLinha || !emOperacao) {
    mesa?.fechar();
    for (const p of CONECTORES_LEVANTADOS) p.kill();
  } else {
    console.error("a costura fechou; o vigia continua a segurar a operacao (a mesa e os conectores)");
  }
}

if (import.meta.main) await main();
