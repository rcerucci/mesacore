// A decisao de reenviar — a referencia do cliente como chave de idempotencia (RN-C4, RN-C6).
//
//   bun run esqueleto/referencia.ts          # corre a bateria de decisoes e mede
//
// Duas ordens iguais por causa de um reenvio sao o defeito mais caro deste sistema: custam dinheiro
// duas vezes e sujam a posicao. A regra tem tres entradas e uma saida:
//
//   o que o registo sabe daquela referencia  x  o venue declara idempotencia?  x  o prazo passou?
//
// A decisao NAO inventa: sem idempotencia declarada pelo venue, a mesa NUNCA reenvia a credo —
// reconcilia primeiro (le o venue e descobre se a ordem la esta).
//
// Esta bateria tem UMA implementacao de proposito: decidir reenviar e trabalho da MESA, nao do
// contrato. O contrato so transporta a referencia e a declaracao de idempotencia.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RAIZ } from "./framing.ts";

export type EstadoNoRegisto = "ausente" | "enviada_sem_desfecho" | "desconhecido" | "aceite" | "parcial" | "recusado";
export type Decisao = "enviar" | "enviar_seguro" | "aguardar" | "reconciliar_antes_de_enviar" | "nao_enviar";

export interface Pergunta {
  referencia_do_cliente: string;
  estado_no_registo: EstadoNoRegisto;
  idempotencia_do_venue: boolean;
  passou_do_prazo: boolean;
}

export interface Resposta {
  decisao: Decisao;
  motivo: string | null;
}

export function decidir(p: Pergunta): Resposta {
  // 1. A referencia ja tem desfecho: reenviar criaria uma SEGUNDA ordem com o mesmo proposito.
  if (p.estado_no_registo === "aceite" || p.estado_no_registo === "parcial" || p.estado_no_registo === "recusado") {
    return { decisao: "nao_enviar", motivo: "referencia_ja_tem_desfecho" };
  }

  // 2. Primeira vez: nada foi enviado ainda.
  if (p.estado_no_registo === "ausente") return { decisao: "enviar", motivo: null };

  // 3. Enviada e ainda dentro do prazo: esperar e a unica coisa honesta a fazer.
  if (p.estado_no_registo === "enviada_sem_desfecho" && !p.passou_do_prazo) {
    return { decisao: "aguardar", motivo: "prazo_de_resposta_em_curso" };
  }

  // 4. Sem desfecho (e ja fora do prazo, ou desfecho desconhecido): aqui decide a idempotencia.
  //    Com ela, reenviar com a MESMA referencia nao cria segunda ordem. Sem ela, reenviar e uma
  //    aposta — e aposta nao e decisao: reconcilia-se primeiro.
  if (p.idempotencia_do_venue) {
    return { decisao: "enviar_seguro", motivo: "venue_declara_idempotencia_pela_referencia" };
  }
  return { decisao: "reconciliar_antes_de_enviar", motivo: "venue_sem_idempotencia_declarada" };
}

// ---------------------------------------------------------------- bateria

interface Caso {
  nome: string;
  entrada: Pergunta;
  decisao_esperada: Decisao;
  motivo_esperado: string | null;
}

function bateria(): number {
  // A bateria da decisao vive num ficheiro `*.decisoes.json` (e nao `*.casos.json`): os casos de
  // MENSAGEM correm nas duas linguagens, as decisoes da mesa correm so aqui. O nome do ficheiro e
  // que separa as duas familias — um `*.casos.json` a mais entraria na bateria do contrato.
  const ficheiro = join(RAIZ, "casos", "referencia.decisoes.json");
  const conteudo = JSON.parse(readFileSync(ficheiro, "utf8")) as { casos: Caso[] };
  let divergentes = 0;

  for (const caso of conteudo.casos) {
    const obtido = decidir(caso.entrada);
    const ok = obtido.decisao === caso.decisao_esperada && obtido.motivo === caso.motivo_esperado;
    if (!ok) divergentes += 1;
    console.log(
      `${ok ? "ok  " : "FALHA"} ${caso.nome.padEnd(52)} ${obtido.decisao}` +
        `${obtido.motivo ? ` (${obtido.motivo})` : ""}`,
    );
  }

  // A regra que nao pode ter excepcao: sem idempotencia declarada, NUNCA "enviar" a credo.
  const aCredo = conteudo.casos.filter((caso) => {
    const d = decidir({ ...caso.entrada, idempotencia_do_venue: false });
    return d.decisao === "enviar" && caso.entrada.estado_no_registo !== "ausente";
  });
  if (aCredo.length > 0) {
    console.log(`FALHA reenvio a credo em ${aCredo.length} casos sem idempotencia declarada`);
    divergentes += aCredo.length;
  } else {
    console.log("ok   nenhum reenvio a credo quando o venue nao declara idempotencia");
  }

  console.log(`referencia: ${conteudo.casos.length} casos · ${divergentes} divergentes`);
  return divergentes;
}

if (import.meta.main) {
  process.exit(bateria() === 0 ? 0 : 1);
}
