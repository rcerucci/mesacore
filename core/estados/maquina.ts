// O interprete da tabela de transicoes.
//
// Este ficheiro NAO decide nada: procura na tabela (dado, R1), aplica a primeira linha que casa
// com o contexto, e devolve resposta. Se nenhuma linha casar, GRITA - nao ha caminho silencioso.
//
// As duas regras que o desenho do documento de estados enuncia, e que aqui se cumprem por
// construcao e nao por cuidado:
//   - um estado sem saida declarada e lacuna  -> o conferidor da tabela reprova (tabela.ts)
//   - um evento que nao muda nada e ruido     -> nao ha linha de "aceite que nao muda nada"
//   - um evento sem estado onde caiba e lacuna -> nao ha par (estado, verbo) sem linha

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { motivoConhecido } from "../livro-de-motivos.ts";

export type Estado = "parada" | "em_operacao" | "pausada" | "encerrando";
export type Verbo = "start" | "pause" | "stop" | "reset" | "nova_sessao";
export type Resultado = "aceite" | "recusado";

export interface Linha {
  de: Estado;
  verbo: Verbo;
  guarda: string;
  para?: Estado;
  recusa?: string;
  nota: string;
}

export interface Tabela {
  nota: string;
  estados: Estado[];
  verbos: Verbo[];
  guardas: Record<string, string>;
  linhas: Linha[];
}

/** O que a mesa sabe sobre o contexto quando o verbo chega. Tudo booleano, tudo observavel. */
export interface Contexto {
  inibicao_cb?: boolean;
  portas_do_arranque?: { passam: boolean; porta?: string; motivo?: string };
  liquidacao_em_curso?: boolean;
  posicao_viva?: boolean;
}

export interface Resposta {
  verbo: Verbo | string;
  resultado: Resultado;
  estado_anterior: Estado;
  estado_novo: Estado;
  motivo: string | null;
  /** Só quando a porta do arranque falhou: qual das seis, e o motivo dela. */
  motivo_da_porta: { porta: string; motivo: string } | null;
  /** Só no reset: a lista explicita do que NAO foi tocado (FR-005). */
  nao_tocado: string[] | null;
  nota: string;
}

let cacheTabela: Tabela | null = null;

export function tabela(): Tabela {
  if (!cacheTabela) {
    cacheTabela = JSON.parse(
      readFileSync(join(import.meta.dir, "transicoes.json"), "utf8"),
    ) as Tabela;
  }
  return cacheTabela;
}

export function estadosDeclarados(): Estado[] {
  return tabela().estados;
}

export function verbosDeclarados(): Verbo[] {
  return tabela().verbos;
}

/** A guarda casa com o contexto? Uma guarda desconhecida GRITA: nao ha guarda implicita. */
export function guardaCasa(guarda: string, contexto: Contexto): boolean {
  switch (guarda) {
    case "sempre":
      return true;
    case "com_inibicao":
      return contexto.inibicao_cb === true;
    case "sem_inibicao":
      return contexto.inibicao_cb !== true;
    case "portas_do_arranque_falham":
      return contexto.portas_do_arranque?.passam === false;
    case "com_liquidacao_em_curso":
      return contexto.liquidacao_em_curso === true;
    case "sem_posicao_viva":
      return contexto.posicao_viva !== true;
    case "com_posicao_viva":
      return contexto.posicao_viva === true;
    default:
      throw new Error(
        `guarda desconhecida: ${guarda}. Uma guarda que o interprete nao sabe ler nao pode ` +
          `passar por omissao - seria uma transicao a acontecer por desconhecimento.`,
      );
  }
}

export function linhaAplicavel(
  estado: Estado,
  verbo: Verbo,
  contexto: Contexto,
): Linha | null {
  for (const linha of tabela().linhas) {
    if (linha.de === estado && linha.verbo === verbo && guardaCasa(linha.guarda, contexto)) {
      return linha;
    }
  }
  return null;
}

/**
 * Aplica um verbo. Devolve sempre uma resposta: aceite com estado novo, ou recusado com motivo.
 * Nunca muda de estado numa recusa (FR-004).
 */
export function aplicar(
  estado: Estado,
  verbo: string,
  contexto: Contexto = {},
  marcasPresentes: string[] = [],
): Resposta {
  const vazio = { motivo_da_porta: null as Resposta["motivo_da_porta"], nao_tocado: null as string[] | null };

  if (!verbosDeclarados().includes(verbo as Verbo)) {
    return {
      ...vazio,
      verbo,
      resultado: "recusado",
      estado_anterior: estado,
      estado_novo: estado,
      motivo: "verbo_desconhecido",
      nota: `os verbos sao ${verbosDeclarados().length}: ${verbosDeclarados().join(", ")}`,
    };
  }

  const linha = linhaAplicavel(estado, verbo as Verbo, contexto);
  if (!linha) {
    // Nao ha caminho silencioso. Se isto acontece, a tabela tem um par sem linha `sempre`,
    // e o conferidor da tabela devia ter reprovado antes de se chegar aqui.
    throw new Error(
      `tabela incompleta: par (${estado}, ${verbo}) sem linha aplicavel. ` +
        `O conferidor de invariantes (tools/verificar-maquina/tabela.ts) tem de reprovar isto.`,
    );
  }

  if (linha.recusa) {
    if (!motivoConhecido(linha.recusa)) {
      throw new Error(
        `motivo de recusa fora do conjunto fechado: ${linha.recusa}. ` +
          `Um motivo inventado nao e um motivo - e o conferidor tem de o apanhar.`,
      );
    }
    const resposta: Resposta = {
      ...vazio,
      verbo,
      resultado: "recusado",
      estado_anterior: estado,
      estado_novo: estado,
      motivo: linha.recusa,
      nota: linha.nota,
    };
    if (linha.recusa === "porta_do_arranque_falhou" && contexto.portas_do_arranque?.porta) {
      resposta.motivo_da_porta = {
        porta: contexto.portas_do_arranque.porta,
        motivo: contexto.portas_do_arranque.motivo ?? "porta recusou sem motivo declarado",
      };
    }
    return resposta;
  }

  const resposta: Resposta = {
    ...vazio,
    verbo,
    resultado: "aceite",
    estado_anterior: estado,
    estado_novo: linha.para ?? estado,
    motivo: null,
    nota: linha.nota,
  };

  // O reset nao apaga marcas: declara o que NAO foi tocado (FR-005). A lista e do que existe
  // agora - um reset que dissesse "nao toquei em nada" sem dizer em que nao tocou nao informa.
  if (verbo === "reset") {
    resposta.nao_tocado = marcasPresentes.length > 0 ? [...marcasPresentes] : [];
  }

  return resposta;
}
