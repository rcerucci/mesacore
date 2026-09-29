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
import { acrescentar, lerRegisto, type TransicaoDoVigia } from "./registro.ts";

const RAIZ = join(import.meta.dir, "..");

export interface Opcoes {
  caminhoDaConfig: string;
  caminhoDoManifesto: string;
  caminhoDasMarcas: string;
  caminhoDoRegisto: string;
  caminhoDasPortas: string;
  registoRetomavel: boolean;
  inventario: "auto" | "falso";
  posicaoViva?: boolean;
}

export function lerArgumentos(argv: string[]): Opcoes {
  const o: Partial<Opcoes> = {
    caminhoDasMarcas: join(RAIZ, "core", "estado", ".marcas.json"),
    caminhoDoRegisto: join(RAIZ, "vigia", ".vigia.json"),
    caminhoDasPortas: join(RAIZ, "vigia", ".arranque.json"),
    inventario: "auto",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") o.caminhoDaConfig = argv[++i];
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

  constructor(opcoes: Opcoes) {
    const args = [
      "run",
      join(RAIZ, "core", "servidor.ts"),
      "--marcas", opcoes.caminhoDasMarcas,
      "--portas", opcoes.caminhoDasPortas,
    ];
    if (opcoes.posicaoViva !== undefined) args.push("--posicao-viva", String(opcoes.posicaoViva));
    this.proc = spawn("bun", args, { stdio: ["pipe", "pipe", "inherit"] });
    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (pedaco: string) => {
      this.buffer += pedaco;
      let corte = this.buffer.indexOf("\n");
      while (corte >= 0) {
        const linha = this.buffer.slice(0, corte);
        this.buffer = this.buffer.slice(corte + 1);
        const quem = this.espera;
        this.espera = null;
        quem?.(linha);
        corte = this.buffer.indexOf("\n");
      }
    });
  }

  enviar(linha: string): Promise<string> {
    return new Promise((resolver) => {
      this.espera = resolver;
      this.proc.stdin!.write(linha + "\n");
    });
  }

  fechar() {
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

/** As seis portas, corridas AQUI (e nao na mesa): e o vigia que tem as cinco pecas que elas pedem. */
export function correrAsPortas(opcoes: Opcoes) {
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
    portaDoInventario,
  });
  return {
    passam: r.arrancou,
    porta: r.porta,
    motivo: r.motivo,
    porque: r.porque,
    conferidas: r.portas_conferidas,
  };
}

/** Só o que se chegou a olhar vai para a mesa: um desfecho sem a lista seria uma afirmacao sem prova. */
function gravarDesfecho(opcoes: Opcoes, d: ReturnType<typeof correrAsPortas>) {
  const temporario = opcoes.caminhoDasPortas + ".tmp";
  writeFileSync(temporario, JSON.stringify({ passam: d.passam, porta: d.porta, motivo: d.motivo }) + "\n");
  renameSync(temporario, opcoes.caminhoDasPortas);
}

export async function atender(linha: string, mesa: MesaFilha, opcoes: Opcoes): Promise<string> {
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
  if (envelope.tipo !== "comando") return respostaDoVigia(envelope.id, "sem_pedido", "comando_com_tipo_invalido");

  const carga = envelope.carga ?? {};
  const pedidoId = typeof carga.pedido_id === "string" ? carga.pedido_id : "sem_pedido";
  const verbo = typeof carga.verbo === "string" ? carga.verbo : "(sem verbo)";

  let desfecho: ReturnType<typeof correrAsPortas> | null = null;
  if (verbo === "start") {
    desfecho = correrAsPortas(opcoes);
    gravarDesfecho(opcoes, desfecho);
  }

  const linhaDaMesa = await mesa.enviar(linha);
  let c: Record<string, unknown> = {};
  try { c = (JSON.parse(linhaDaMesa) as { carga?: Record<string, unknown> }).carga ?? {}; } catch { /* fica vazio */ }
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
    portas_conferidas: desfecho?.conferidas ?? [],
  };
  acrescentar(opcoes.caminhoDoRegisto, t);
  return linhaDaMesa;
}

/** Nao responde a mesa: responde o VIGIA, quando nem chegou a valer a pena incomodar a mesa. */
function respostaDoVigia(id: unknown, pedidoId: string, motivo: string): string {
  const motivoFinal = motivoConhecido(motivo) ? motivo : "comando_com_tipo_invalido";
  return JSON.stringify({
    contrato: versaoVigente(),
    tipo: "resposta_de_comando",
    id: typeof id === "string" ? id : "sem_id",
    carga: {
      pedido_id: pedidoId,
      aceito: false,
      motivo: motivoFinal,
      transicao: { de: "parada", para: "parada" },
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
  if (opcoes.registoRetomavel === undefined) opcoes.registoRetomavel = registoFoiRetomado(opcoes.caminhoDoRegistro);
  const mesa = new MesaFilha(opcoes);
  const rl = createInterface({ input: process.stdin });
  for await (const linha of rl) {
    if (linha.trim() === "") continue;
    process.stdout.write((await atender(linha, mesa, opcoes)) + "\n");
    if (umaLinha) break;
  }
  mesa.fechar();
}

if (import.meta.main) await main();
