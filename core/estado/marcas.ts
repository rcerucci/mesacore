// As marcas: o que sobrevive ao processo morrer.
//
// Sao TRES familias (data-model.md §4) e mais uma lista:
//   sessao           - instante, equity de partida, autor, motivo e a CONFIGURACAO EM VIGOR
//   inibicao_cb      - o circuit breaker disparou; so nova_sessao sai daqui
//   desconhecido[]   - desfecho sem confirmacao, por instrumento; so reconciliacao sai daqui
//   pedidos[]        - pedido do dono que nao foi cumprido nem esquecido (o stop pendente)
//
// O que este ficheiro NAO tem, e e o ponto mais importante dele: NENHUMA posicao. A posse de uma
// posicao le-se da CORRETORA, pela marca que a ordem levou (FR-022, RN-T16.1). A diferenca entre
// "lembrar-se do que aconteceu" e "achar que sabe o que tem" e o que separa uma mesa que se
// reinstala de uma que se engana. O porteiro do estado reprova se um campo de posicao aparecer aqui.
//
// Escrita ATOMICA (temporario + rename): um ficheiro de marcas meio escrito seria uma mesa que nao
// sabe se esta inibida - e essa e a unica coisa que a inibicao existe para garantir.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CAMINHO_DAS_MARCAS = join(import.meta.dir, ".marcas.json");
const CAMINHO_TEMPORARIO = CAMINHO_DAS_MARCAS + ".tmp";

export interface ConfiguracaoEmVigor {
  ficha: string;
  versao_do_setup: string;
  versao_do_mandato: string;
}

export interface Sessao {
  instante_ms: number;
  equity_de_partida: string;
  autor: string;
  motivo: string;
  configuracao_em_vigor: ConfiguracaoEmVigor;
}

export interface Inibicao {
  motivo: string;
  instante_ms: number;
  perda_medida: string;
}

export interface Desconhecido {
  instrumento: string;
  motivo: string;
  instante_ms: number;
  referencia_do_cliente: string;
}

export interface PedidoPendente {
  verbo: string;
  instante_ms: number;
  motivo: string;
}

export interface Marcas {
  sessao: Sessao | null;
  inibicao_cb: Inibicao | null;
  desconhecido: Desconhecido[];
  pedidos: PedidoPendente[];
}

export function marcasVazias(): Marcas {
  return { sessao: null, inibicao_cb: null, desconhecido: [], pedidos: [] };
}

export function lerMarcas(caminho: string = CAMINHO_DAS_MARCAS): Marcas {
  if (!existsSync(caminho)) return marcasVazias();
  const cru = JSON.parse(readFileSync(caminho, "utf8")) as Partial<Marcas>;
  return {
    sessao: cru.sessao ?? null,
    inibicao_cb: cru.inibicao_cb ?? null,
    desconhecido: cru.desconhecido ?? [],
    pedidos: cru.pedidos ?? [],
  };
}

/** Grava de forma atomica: escreve o temporario, depois troca. Um leitor nunca ve meio ficheiro. */
export function gravarMarcas(m: Marcas, caminho: string = CAMINHO_DAS_MARCAS): void {
  writeFileSync(CAMINHO_TEMPORARIO, JSON.stringify(m, null, 2) + "\n");
  renameSync(CAMINHO_TEMPORARIO, caminho);
}

/** Os nomes das marcas presentes AGORA - e o que o `reset` declara que nao tocou (FR-005). */
export function marcasPresentes(m: Marcas): string[] {
  const nomes: string[] = [];
  if (m.sessao) nomes.push("sessao");
  if (m.inibicao_cb) nomes.push("inibicao_cb");
  if (m.desconhecido.length > 0) nomes.push("desconhecido");
  if (m.pedidos.length > 0) nomes.push("pedidos");
  return nomes;
}

export function haInibicao(m: Marcas): boolean {
  return m.inibicao_cb !== null;
}

export function desconhecidoDe(m: Marcas, instrumento: string): Desconhecido | null {
  return m.desconhecido.find((d) => d.instrumento === instrumento) ?? null;
}

export function marcarDesconhecido(
  m: Marcas,
  entrada: Omit<Desconhecido, "instante_ms"> & { instante_ms?: number },
): Marcas {
  const semDuplicado = m.desconhecido.filter((d) => d.instrumento !== entrada.instrumento);
  return {
    ...m,
    desconhecido: [
      ...semDuplicado,
      { ...entrada, instante_ms: entrada.instante_ms ?? Date.now() },
    ],
  };
}

/** Só se sai do desconhecido por reconciliacao que decida - nunca por reset (FR-029). */
export function limparDesconhecido(m: Marcas, instrumento: string): Marcas {
  return { ...m, desconhecido: m.desconhecido.filter((d) => d.instrumento !== instrumento) };
}

export function marcarInibicao(m: Marcas, inibicao: Inibicao): Marcas {
  return { ...m, inibicao_cb: inibicao };
}

export function gravarSessao(m: Marcas, sessao: Sessao): Marcas {
  return { ...m, sessao, inibicao_cb: null };
}

export function arquivarPedido(m: Marcas, pedido: PedidoPendente): Marcas {
  return { ...m, pedidos: [...m.pedidos, pedido] };
}

/**
 * O `reset` NAO escreve nada (FR-005): devolve as marcas como estao. Existe como funcao para que a
 * intencao fique explicita no codigo - um reset que "nao faz nada" tem de ser uma linha de codigo
 * visivel, e nao uma ausencia.
 */
export function reset(m: Marcas): Marcas {
  return m;
}
