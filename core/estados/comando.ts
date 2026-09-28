// O comando: o que o vigia ou a web manda a mesa.
//
// A forma e deliberadamente pobre (contracts/interface.md §1): verbo, autor, pedido_id e - so em
// nova_sessao - o motivo. NAO tem ficha, instrumento, saldo, alavancagem, lado, preco nem credencial.
//
// Um comando que traga um campo a mais e RECUSADO, e nao ignorado. Aceitar um campo a mais seria a
// porta a alargar-se sozinha: no dia seguinte alguem mandaria `lado` por aqui, e a mesa passaria a
// poder ser comandada a partir da web em nome de uma estrategia - que e exactamente o que a
// constituicao nao permite.

import { motivoConhecido } from "../livro-de-motivos.ts";

export const CAMPOS_DO_COMANDO = ["verbo", "autor", "pedido_id", "motivo"] as const;

export interface Comando {
  verbo: string;
  autor: string;
  pedido_id: string;
  motivo?: string;
}

export interface ComandoAceite {
  ok: true;
  comando: Comando;
}

export interface ComandoRecusado {
  ok: false;
  motivo: string;
  detalhe: string;
}

export type Validacao = ComandoAceite | ComandoRecusado;

export function validarComando(cru: unknown): Validacao {
  if (typeof cru !== "object" || cru === null || Array.isArray(cru)) {
    return { ok: false, motivo: "verbo_desconhecido", detalhe: "comando nao e um objecto" };
  }
  const campos = Object.keys(cru as Record<string, unknown>);
  const aMais = campos.filter((c) => !CAMPOS_DO_COMANDO.includes(c as (typeof CAMPOS_DO_COMANDO)[number]));
  if (aMais.length > 0) {
    return {
      ok: false,
      motivo: "comando_com_campo_a_mais",
      detalhe: `campos que um comando nao tem: ${aMais.join(", ")}. A mesa nao recebe ordens pela porta dos verbos.`,
    };
  }
  const c = cru as Record<string, unknown>;
  if (typeof c.verbo !== "string" || typeof c.autor !== "string" || typeof c.pedido_id !== "string") {
    return {
      ok: false,
      motivo: "comando_incompleto",
      detalhe: "verbo, autor e pedido_id sao obrigatorios em qualquer comando.",
    };
  }
  if (c.motivo !== undefined && typeof c.motivo !== "string") {
    return { ok: false, motivo: "comando_com_tipo_invalido", detalhe: "motivo tem de ser texto." };
  }
  if (c.verbo === "nova_sessao" && typeof c.motivo !== "string") {
    return {
      ok: false,
      motivo: "comando_incompleto",
      detalhe: "nova_sessao exige motivo: a razao de abrir sessao nova e do dono, e fica registrada.",
    };
  }
  const comando: Comando = {
    verbo: c.verbo,
    autor: c.autor,
    pedido_id: c.pedido_id,
  };
  if (typeof c.motivo === "string") comando.motivo = c.motivo;
  return { ok: true, comando };
}

/** Um motivo usado numa recusa tem de existir no livro: motivo inventado nao passa. */
export function motivoDeComandoConhecido(motivo: string): boolean {
  return motivoConhecido(motivo);
}
