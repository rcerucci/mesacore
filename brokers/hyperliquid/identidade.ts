// A PORTA DE IDENTIDADE do conector Hyperliquid: o agente que ASSINA tem de estar registado NA CONTA.
//
// O QUE ELA RESPONDE, e so isto: a chave que o processo carregou (por referencia) e' de um agente que o venue
// declara, hoje, como autorizado a assinar POR ESTA CONTA? Nao responde mais nada: nao decide se se opera,
// nao julga risco, nao mede nada do mercado (RN-C5/RN-C15). E uma COMPARACAO, e e pura — recebe o endereco do
// agente que assina, a conta da ficha e a resposta CRUA do venue (`extraAgents`), e devolve um veredicto.
//
// PORQUE E UMA PORTA SEPARADA DA `chave`: a porta `chave` prova que a credencial se LE (a referencia resolve,
// o valor esta la); esta prova que ela e' DESTA conta. Sao duas perguntas diferentes, e a segunda so se pode
// responder com o venue a falar: e por isso ela e a ULTIMA do arranque (FR-023/RN-E13, RN-H15).
//
// FAIL-CLOSED, e sem excepcao: o que nao se pode comparar RECUSA. Um `extraAgents` que nao se le, um agente
// que a conta nao lista, um `validUntil` ausente ou a null, um prazo ja passado — tudo RECUSA, com motivo do
// conjunto FECHADO do contrato. O desconhecido NUNCA vira «sim»: assinar com um agente que a conta nao
// registou e' exactamente o que nao se faz as cegas.
//
// MEDIDO contra o venue (29 set 2026, so leitura, sem chave): `extraAgents` da conta de teste devolveu
// `[{address: "0x7b3a...ca81", name: "...", validUntil: 1798477732304}]` — o endereco em hexadecimal
// MINUSCULO com `0x`, e o prazo em MILISSEGUNDOS desde a epoch. A comparacao do endereco e' insensivel a
// caixa (o venue escreve minusculo, mas quem o declara pode nao escrever) — o que NAO se aceita e' um
// endereco que nao seja hexadecimal de 20 bytes: esse nao e' um endereco, e RECUSA.

/** O endereco de 20 bytes, em hexadecimal com `0x`. O venue escreve-o minusculo; compara-se sem caixa. */
const ENDERECO = /^0x[0-9a-fA-F]{40}$/;

export type VeredictoDaIdentidade = { ok: true; porque: string } | { ok: false; motivo: string; porque: string };

/**
 * O agente que assina pertence a conta que a ficha nomeia?
 *
 * @param agente o endereco do agente que VAI ASSINAR (na porta ao vivo, derivado da chave carregada por
 *   referencia — o VALOR da chave nunca chega aqui, so o endereco publico que dela sai)
 * @param conta a conta da ficha (uma so, RN-H15)
 * @param agentes a resposta CRUA do venue ao `extraAgents` (o que ele publica, nao o que nos queriamos)
 * @param instante_ms o instante do relogio do CHAMADOR que data a comparacao do prazo
 */
export function conferirIdentidade(args: {
  agente: unknown;
  conta: string;
  agentes: unknown;
  instante_ms: number;
}): VeredictoDaIdentidade {
  const agente = typeof args.agente === "string" ? args.agente : undefined;
  if (agente === undefined || !ENDERECO.test(agente)) {
    return {
      ok: false,
      motivo: "formato_invalido",
      porque: `o endereco do agente que assina (${JSON.stringify(args.agente)}) nao e' um endereco de 20 bytes em hexadecimal: sem ele nao ha o que comparar com os agentes da conta`,
    };
  }

  // O que o venue publica para esta conta: uma LISTA. Nao uma lista -> nao se sabe -> recusa.
  const lista = Array.isArray(args.agentes) ? args.agentes : undefined;
  if (lista === undefined) {
    return {
      ok: false,
      motivo: "campo_obrigatorio_ausente",
      porque:
        "o venue nao devolveu a lista de agentes desta conta (`extraAgents`): sem a lista nao se sabe se o agente " +
        "que assina esta autorizado, e o desconhecido nao vira «sim» (FR-023)",
    };
  }

  const procurado = agente.toLowerCase();
  const registados = lista
    .map((e) => (typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {}))
    .map((e) => (typeof e.address === "string" ? e : undefined))
    .filter((e): e is Record<string, unknown> => e !== undefined);
  const nosso = registados.find((e) => String(e.address).toLowerCase() === procurado);

  if (nosso === undefined) {
    return {
      ok: false,
      motivo: "capacidade_nao_declarada",
      porque:
        `o agente que assina (${agente}) NAO esta registado na conta ${args.conta}: o venue publica ` +
        `${registados.length} agente(s) para esta conta e nenhum e' este` +
        (registados.length ? ` (${registados.map((e) => String(e.address)).join(", ")})` : "") +
        " — assinar por uma conta que nao registou este agente nao se faz, e nao se envia nada",
    };
  }

  // O PRAZO. O venue escreve-o em milissegundos desde a epoch; ausente ou a null nao se adivinha.
  const validade = nosso.validUntil;
  if (validade === undefined) {
    return {
      ok: false,
      motivo: "campo_obrigatorio_ausente",
      porque: `o agente ${agente} esta na conta ${args.conta} mas o venue nao declarou o prazo (validUntil): um prazo que nao se le nao vira «sem prazo»`,
    };
  }
  if (validade === null) {
    return {
      ok: false,
      motivo: "valor_nulo_nao_permitido",
      porque: `o prazo do agente ${agente} veio a null: ausencia nao se escreve com null (D4), e sem prazo legivel nao se assina`,
    };
  }
  if (typeof validade !== "number" || !Number.isFinite(validade)) {
    return {
      ok: false,
      motivo: "tipo_invalido",
      porque: `o prazo do agente ${agente} veio como ${JSON.stringify(validade)}, que nao e' um instante em milissegundos`,
    };
  }
  if (!Number.isFinite(args.instante_ms)) {
    return {
      ok: false,
      motivo: "formato_invalido",
      porque: `o instante do chamador (${JSON.stringify(args.instante_ms)}) nao e' um instante em milissegundos: sem relogio nao se compara um prazo`,
    };
  }
  if (validade <= args.instante_ms) {
    return {
      ok: false,
      motivo: "prazo_excedido",
      porque:
        `o agente ${agente} esta registado na conta ${args.conta} mas o prazo dele (${validade} ms) ja passou ` +
        `no instante declarado ${args.instante_ms} ms: uma credencial fora de prazo recusa-se, nao se envia com ela`,
    };
  }

  return {
    ok: true,
    porque:
      `o agente que assina (${agente}) esta REGISTADO na conta ${args.conta} e dentro do prazo ` +
      `(${validade} ms > ${args.instante_ms} ms): a credencial que o processo carregou por referencia e' desta conta`,
  };
}
