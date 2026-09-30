// A sonda do venue e o manifesto do conector (FR-001 a FR-005).
//
// Este ficheiro NAO fala com o venue: recebe a resposta do venue como DADO e devolve o manifesto do contrato
// — ou uma recusa NOMEADA. E por isso que ele corre offline, e e por isso que os casos dele sao casos.
//
// O que ele nunca faz: inventar um numero do venue, preencher um campo por omissao, ou usar um motivo que nao
// esteja no conjunto fechado do contrato (contracts/vocabulario.json e _defs/forma.schema.json).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "..", "..");

function lerJson(caminho: string): any {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

/**
 * O que o venue responde. Tudo o que o manifesto afirma tem de vir daqui.
 *
 * As chaves de `meta.universe` e dos escaloes sao as do VENUE, tal como ele as escreve (`isDelisted`,
 * `fundingIntervalHours`, `marginTiers[].lowerBound`): a sonda e a leitura crua, e quem traduz para a
 * lingua do contrato e `construirManifesto`. Traduzir na leitura seria esconder o que o venue disse.
 */
export type Sonda = {
  venue: { nome: string; ambiente: "teste" | "producao" };
  versao_do_conector: string;
  /**
   * O universo do venue. OPCIONAL de proposito: se a leitura do `meta` falhar, a sonda NAO pode escrever
   * uma lista vazia — uma lista vazia diria «o instrumento nao existe no venue» quando a verdade e «nao se
   * leu». Sem `meta`, o manifesto recusa com `campo_obrigatorio_ausente` e nomeia `meta.universe`.
   */
  meta?: {
    universe: {
      name: string;
      szDecimals: number;
      maxLeverage: number;
      /** `isDelisted` do venue: a chave so aparece quando e verdadeira (medido: 54 de 212 instrumentos). */
      isDelisted?: boolean;
      /** `fundingIntervalHours` da leitura `predictedFundings()[coin][HlPerp]`. */
      fundingIntervalHours?: number;
      /** `marginTiers` da tabela de margem do instrumento (`lowerBound` textual, como o venue o da). */
      marginTiers?: { lowerBound: string; maxLeverage: number }[];
    }[];
  };
  instrumentos_pedidos: string[];
  minimo_de_valor_por_ordem?: string;
  /** Aditivo na 1.4.0: o TECTO, e so quando o venue o declara. Sonda que nao o traga nao produz tecto. */
  maximo_de_valor_por_ordem?: string;
  modos_de_margem?: string[];
  tipos_de_ordem?: string[];
  parcial_suportada?: string[];
  desvio_maximo?: string;
  reduce_only_suportado?: boolean;
  stop_anexo?: boolean;
  ajusta_alavancagem?: boolean;
  profundidade_de_livro?: number;
  funding_publicado?: boolean;
  relogio_de_fecho_de_barra?: string;
  idempotencia?: boolean;
  marca_de_posse?: string;
  marca_liga_ordem_a_posicao?: boolean;
  estado_do_mercado?: boolean;
  /**
   * AS TRES OBRIGACOES DO CONECTOR (contrato 1.7.0). Sao factos que a sonda MEDE, e nao promessas: a mesa
   * depende deles em tres regras suas, e por isso a porta do manifesto do arranque recusa o arranque quando
   * qualquer uma vem ausente ou `false`.
   */
  /** (1) o estado da ligacao reporta-se PELO PROTOCOLO — medido: o venue responde o proprio estado. */
  ligacao_por_protocolo?: boolean;
  /** (2) o conector RELE o preco ao enviar — medido: a marca do activo esta publicada, e e ela a regua. */
  releitura_de_preco_ao_enviar?: boolean;
  /** (3) o conector devolve a RESOLUCAO — medido: o venue publica os numeros da execucao. */
  devolve_a_resolucao?: boolean;
};

export type Recusa = { ok: false; motivo: string; porque: string };
export type Feito = { ok: true; manifesto: Record<string, unknown> };
export type Resultado = Feito | Recusa;

/** A versao do contrato vem de UMA so casa — a mesma que os dois runners leem. Nunca escrita aqui. */
export function versaoDoContrato(): string {
  return lerJson(join(RAIZ, "contracts", "versao.json")).contrato;
}

/** Os nomes permitidos, lidos do proprio contrato: um motivo inventado aqui nao passa. */
function conjunto(familia: "formas_de_marca" | "tipos_de_ordem" | "politicas_de_parcial"): string[] {
  return lerJson(join(RAIZ, "contracts", "vocabulario.json"))[familia];
}

function recusa(motivo: string, porque: string): Recusa {
  return { ok: false, motivo, porque };
}

/**
 * 10^-casas escrito como DECIMAL TEXTUAL do contrato. O contrato proibe expoente ("1e-5" nao e decimal
 * valido, e recusado por tipo) — e o passo do venue tem de ser dito na lingua do contrato, nao na nossa.
 */
function dezElevadoA(casas: number): string {
  if (casas <= 0) return "1";
  return "0." + "0".repeat(casas - 1) + "1";
}

/**
 * Constroi o manifesto a partir da sonda. Nenhum numero do venue entra por omissao: o que a sonda nao
 * declarar e RECUSA (campo_obrigatorio_ausente), e o que ela declarar fora do conjunto fechado do contrato e
 * RECUSA (valor_fora_do_conjunto). Um campo que falta nunca fica com o valor "de sempre".
 */
export function construirManifesto(sonda: Sonda): Resultado {
  // ---- 0. O MANDATO: os instrumentos que o dono nomeou existem, e estao VIVOS? ----------------------
  //
  // Esta passagem vem PRIMEIRO, e de proposito. Numa sonda real as outras grandezas ainda nao estao todas
  // medidas (o minimo de valor por ordem, por exemplo, so a bateria de conformidade o mede), e uma recusa
  // por campo em falta deixaria passar o problema mais grave sem o nomear: o mandato a pedir um instrumento
  // que o venue deu por ENCERRADO (`isDelisted`, medido: 54 de 212). Aqui NAO se le a unidade — le-se so o
  // que decide se o mandato pode existir.
  const universoDoMandato = sonda?.meta?.universe;
  if (Array.isArray(universoDoMandato)) {
    for (const simbolo of sonda?.instrumentos_pedidos ?? []) {
      const cru = universoDoMandato.find((u) => u.name === simbolo);
      if (cru?.isDelisted === true) {
        return recusa(
          "instrumento_deslistado_no_venue",
          `o instrumento ${simbolo} esta DESLISTADO no venue (isDelisted) — o mandato nao pode nomea-lo`,
        );
      }
    }
  }

  // O que a sonda tem de trazer, sem o que nao ha manifesto nenhum.
  const obrigatorios: [string, unknown][] = [
    ["meta.universe", sonda?.meta?.universe],
    ["instrumentos_pedidos", sonda?.instrumentos_pedidos],
    ["minimo_de_valor_por_ordem", sonda?.minimo_de_valor_por_ordem],
    ["modos_de_margem", sonda?.modos_de_margem],
    ["tipos_de_ordem", sonda?.tipos_de_ordem],
    ["parcial_suportada", sonda?.parcial_suportada],
    ["desvio_maximo", sonda?.desvio_maximo],
    ["relogio_de_fecho_de_barra", sonda?.relogio_de_fecho_de_barra],
    ["marca_de_posse", sonda?.marca_de_posse],
  ];
  for (const [nome, valor] of obrigatorios) {
    if (valor === undefined || valor === null) {
      return recusa("campo_obrigatorio_ausente", `a sonda do venue nao trouxe ${nome} — sem ele nao ha manifesto`);
    }
  }

  // A profundidade do livro: o esquema do contrato exige um inteiro >= 0, e uma sonda que a nao trouxesse
  // produzia um manifesto «ok» que o proprio esquema rejeitava — um buraco fail-OPEN. Fecha-se aqui: sem
  // profundidade declarada nao ha manifesto.
  if (sonda.profundidade_de_livro === undefined || sonda.profundidade_de_livro === null) {
    return recusa(
      "campo_obrigatorio_ausente",
      "a sonda do venue nao trouxe profundidade_de_livro — sem ela o esquema do manifesto rejeitava o manifesto, " +
        "e o setup nao sabia o que nao ve",
    );
  }
  if (typeof sonda.profundidade_de_livro !== "number" || !Number.isInteger(sonda.profundidade_de_livro) || sonda.profundidade_de_livro < 0) {
    return recusa(
      "tipo_invalido",
      `a profundidade_de_livro tem de ser um inteiro nao negativo, e a sonda trouxe ${JSON.stringify(sonda.profundidade_de_livro)}`,
    );
  }

  // As capacidades booleanas: ausentes NAO viram `true` por omissao (fail-closed).
  const capacidades: [string, unknown][] = [
    ["ajusta_alavancagem", sonda.ajusta_alavancagem],
    ["reduce_only_suportado", sonda.reduce_only_suportado],
    ["stop_anexo", sonda.stop_anexo],
    ["funding_publicado", sonda.funding_publicado],
    ["idempotencia", sonda.idempotencia],
    ["marca_liga_ordem_a_posicao", sonda.marca_liga_ordem_a_posicao],
    ["estado_do_mercado", sonda.estado_do_mercado],
    // As TRES OBRIGACOES (contrato 1.7.0, D-002): a mesa nao arranca sem as tres, e por isso uma que a
    // sonda nao tenha conseguido medir RECUSA aqui — e nao sai um manifesto a dizer que sim.
    ["ligacao_por_protocolo", sonda.ligacao_por_protocolo],
    ["releitura_de_preco_ao_enviar", sonda.releitura_de_preco_ao_enviar],
    ["devolve_a_resolucao", sonda.devolve_a_resolucao],
  ];
  for (const [nome, valor] of capacidades) {
    if (valor !== true && valor !== false) {
      return recusa(
        "capacidade_nao_declarada",
        `o venue nao declarou ${nome}: a mesa recusa a boleta em vez de a mandar a um venue que pode ignora-la`,
      );
    }
  }

  // Os instrumentos: cada um com a SUA unidade. Sem unidade declarada nao ha resolucao possivel.
  const universo = sonda.meta?.universe;
  if (!Array.isArray(universo)) {
    // Cinto e suspensorios: o laco dos obrigatorios ja recusou acima, e esta guarda impede que uma leitura
    // falhada vire «o instrumento nao existe no venue» por outra porta.
    return recusa(
      "campo_obrigatorio_ausente",
      "a sonda do venue nao trouxe meta.universe — sem ele nao se sabe que instrumentos existem",
    );
  }
  const instrumentos = [];
  for (const simbolo of sonda.instrumentos_pedidos) {
    const cru = universo.find((u) => u.name === simbolo);
    if (!cru) {
      return recusa(
        "valor_fora_do_conjunto",
        `o instrumento ${simbolo} nao existe no venue`,
      );
    }
    // O deslistado NAO se confere aqui: a passagem 0 ja recusou o mandato que nomeia um instrumento que o
    // venue deu por encerrado, e essa recusa sai ANTES de qualquer leitura de unidade. Este laco so chega
    // aos instrumentos vivos.
    if (typeof cru.szDecimals !== "number" || typeof cru.maxLeverage !== "number") {
      return recusa(
        "campo_obrigatorio_ausente",
        `o venue nao declarou szDecimals/alavancagem maxima para ${simbolo}`,
      );
    }
    // O que o venue declarar a MAIS entra porque ele o declarou — nunca por omissao nossa:
    //   - `deslistado` quando o venue escreve a chave (o contrato distingue «declarado falso» de «nao dito»);
    //   - `funding_intervalo_horas` quando a cadencia vem inteira e positiva (uma cadencia de 0 horas nao existe);
    //   - `alavancagem_por_escalao` quando o venue publica os escaloes, com o limite INFERIOR que ele da.
    const extra: Record<string, unknown> = {};
    if (typeof cru.isDelisted === "boolean") extra.deslistado = cru.isDelisted;
    if (typeof cru.fundingIntervalHours === "number" && Number.isInteger(cru.fundingIntervalHours) && cru.fundingIntervalHours >= 1) {
      extra.funding_intervalo_horas = cru.fundingIntervalHours;
    }
    if (Array.isArray(cru.marginTiers) && cru.marginTiers.length > 0) {
      extra.alavancagem_por_escalao = cru.marginTiers.map((escalao) => ({
        de: escalao.lowerBound,
        maxima: String(escalao.maxLeverage),
      }));
    }
    instrumentos.push({
      simbolo: cru.name,
      // O passo e do venue, derivado do szDecimals dele: nao e um numero nosso.
      minimo: dezElevadoA(cru.szDecimals),
      passo: dezElevadoA(cru.szDecimals),
      tick: dezElevadoA(Math.max(0, 6 - cru.szDecimals)),
      alavancagem_maxima: String(cru.maxLeverage),
      ...extra,
    });
  }

  // Os conjuntos fechados: um valor que o contrato nao conhece nao entra no manifesto.
  const tipos_aceitos = conjunto("tipos_de_ordem");
  for (const t of sonda.tipos_de_ordem as string[]) {
    if (!tipos_aceitos.includes(t)) {
      return recusa("valor_fora_do_conjunto", `o tipo de ordem ${t} nao existe no contrato`);
    }
  }
  const parciais_aceitas = conjunto("politicas_de_parcial");
  for (const p of sonda.parcial_suportada as string[]) {
    if (!parciais_aceitas.includes(p)) {
      return recusa("valor_fora_do_conjunto", `a politica de parcial ${p} nao existe no contrato`);
    }
  }
  const marcas = conjunto("formas_de_marca");
  if (!marcas.includes(sonda.marca_de_posse as string)) {
    return recusa("valor_fora_do_conjunto", `a forma de marca ${sonda.marca_de_posse} nao existe no contrato`);
  }

  const manifesto = {
    conector: { nome: sonda.venue.nome, versao: sonda.versao_do_conector },
    versao: versaoDoContrato(),
    instrumentos,
    sabe_ajustar_alavancagem: sonda.ajusta_alavancagem,
    modos_de_margem: sonda.modos_de_margem,
    // O nome diz o que o valor E: a sonda mede o MINIMO de valor por ordem do venue (abaixo dele o venue
    // recusa a ordem). Ate a 1.4.0 este valor saia daqui com o nome `teto_de_valor_por_ordem` — o nome
    // mentia, e quem o lia como tecto decidia ao contrario. O tecto, quando existe, vem no campo aditivo
    // abaixo, e so quando o venue o declara.
    minimo_de_valor_por_ordem: sonda.minimo_de_valor_por_ordem,
    ...(sonda.maximo_de_valor_por_ordem !== undefined && sonda.maximo_de_valor_por_ordem !== null
      ? { maximo_de_valor_por_ordem: sonda.maximo_de_valor_por_ordem }
      : {}),
    modelo_de_posicao: "netting",
    tipos_de_ordem: sonda.tipos_de_ordem,
    parcial_suportada: sonda.parcial_suportada,
    desvio_maximo: sonda.desvio_maximo,
    reduce_only_suportado: sonda.reduce_only_suportado,
    stop_anexo: sonda.stop_anexo,
    profundidade_de_livro: sonda.profundidade_de_livro,
    funding: sonda.funding_publicado,
    relogio_de_fecho_de_barra: sonda.relogio_de_fecho_de_barra,
    idempotencia: sonda.idempotencia,
    marca_de_posse: sonda.marca_de_posse,
    marca_liga_ordem_a_posicao: sonda.marca_liga_ordem_a_posicao,
    estado_do_mercado: sonda.estado_do_mercado,
    // As TRES OBRIGACOES (contrato 1.7.0, D-002), declaradas como FACTOS medidos pela sonda:
    ligacao_por_protocolo: sonda.ligacao_por_protocolo,
    releitura_de_preco_ao_enviar: sonda.releitura_de_preco_ao_enviar,
    devolve_a_resolucao: sonda.devolve_a_resolucao,
  };
  return { ok: true, manifesto };
}
