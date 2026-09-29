// A conferencia contra o manifesto — antes de enviar (T028, T034).
//
//   bun run esqueleto/conferir.ts --bateria     # corre a bateria de conformidade e mede
//
// A mesa so envia o que o venue DECLAROU saber fazer (RN-C7). Sem declaracao nao ha capacidade, e
// a resposta e recusar — nunca adaptar a boleta para caber (isso seria a mesa a decidir em lugar do
// dono). Este e o portao que transforma "o venue deve suportar isto" em "o venue declarou que
// suporta isto".
//
// Duas notas de desenho, que a implementacao obrigou a decidir:
//
//   - A alavancagem da BOLETA confere contra a maxima unica do instrumento: a boleta nao tem
//     nocional (nao ha unidades), por isso nao se sabe em que escalao cai. Depois de resolvida, a
//     RESOLUCAO confere outra vez, agora contra o escalao do valor real.
//   - Um setup sem stop e uma boleta valida: o venue nao precisar de `stop_anexo` para receber uma
//     ordem sem stop. Isso nao se recusa.
//
// EMENDA 1.4.0 (medida contra o venue; ver specs/004-conector-hyperliquid/relatorios/emenda-1.4.0.txt):
//   - o campo que aqui se chamava `teto_de_valor_por_ordem` carregava o MINIMO do venue e era usado como
//     tecto — passava a recusar o que devia passar e a deixar passar o que devia recusar. Agora ha os
//     dois, com o nome certo: `minimo_de_valor_por_ordem` (piso: abaixo RECUSA, igual PASSA) e
//     `maximo_de_valor_por_ordem` (tecto, so quando o venue o declara);
//   - o escalao de valor passou a declarar o limite INFERIOR (`de`, primeiro a zero) — e o valor que
//     escalao nenhum cubra RECUSA, em vez de cair na maxima unica por omissao;
//   - um instrumento `deslistado` no manifesto nao se opera: recusa nomeada.
//
// As decisoes deste ficheiro sao LIMIARES (piso, tecto, escalao), e um limiar decide-se exactamente:
// comparar decimais textuais com virgula flutuante deixa um valor IGUAL ao limite cair para o lado
// errado. Toda a comparacao aqui e feita em BigInt, sobre o texto.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RAIZ } from "./framing.ts";

export interface Resultado {
  veredicto: "aceite" | "recusado";
  motivo: string | null;
  avisos: string[];
}

export interface Alvo {
  tipo: "boleta" | "resolucao";
  carga: any;
  instrumento?: string;
}

/** Compara dois decimais TEXTUAIS sem virgula flutuante: -1, 0 ou 1. */
export function compararDecimais(a: string, b: string): number {
  const casas = (s: string): number => (s.indexOf(".") < 0 ? 0 : s.length - s.indexOf(".") - 1);
  const escalado = (s: string): bigint => {
    const i = s.indexOf(".");
    return i < 0 ? BigInt(s) : BigInt(s.slice(0, i) + s.slice(i + 1));
  };
  const escala = Math.max(casas(a), casas(b));
  const x = escalado(a) * 10n ** BigInt(escala - casas(a));
  const y = escalado(b) * 10n ** BigInt(escala - casas(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A alavancagem maxima que o manifesto declara PARA ESTE VALOR.
 *
 * O escalao de um valor e o de maior `de` (limite INFERIOR) que nao o excede — a forma como o venue o
 * declara (`marginTiers[].lowerBound`, com o primeiro a `0.0`). Sem escaloes declarados vale a maxima
 * unica. E um nocional que escalao NENHUM cubra devolve `null` (nao coberto): nao ha declaracao para
 * aquele valor, e nao a havendo RECUSA — uma maxima por omissao seria a mesa a decidir em lugar do venue.
 */
export function maximaNoEscalao(unidade: any, nocional: string): string | null {
  const escaloes: any[] = unidade.alavancagem_por_escalao ?? [];
  if (escaloes.length === 0) return String(unidade.alavancagem_maxima);
  let escolhido: any = null;
  for (const escalao of escaloes) {
    if (compararDecimais(String(escalao.de), nocional) <= 0) {
      if (escolhido === null || compararDecimais(String(escalao.de), String(escolhido.de)) > 0) escolhido = escalao;
    }
  }
  if (escolhido === null) return null;
  // O escalao nunca pode declarar MAIS do que a maxima do instrumento.
  return compararDecimais(String(escolhido.maxima), String(unidade.alavancagem_maxima)) < 0
    ? String(escolhido.maxima)
    : String(unidade.alavancagem_maxima);
}

export function conferir(manifesto: any, alvo: Alvo): Resultado {
  const avisos: string[] = [];
  const unidades = new Map<string, any>(
    (manifesto.instrumentos ?? []).map((u: any) => [u.simbolo, u]),
  );

  const instrumento = alvo.instrumento ?? alvo.carga?.instrumento;
  const unidade = instrumento !== undefined ? unidades.get(instrumento) : undefined;
  if (unidade === undefined) {
    return { veredicto: "recusado", motivo: "instrumento_desconhecido_no_manifesto", avisos };
  }

  // O instrumento que o venue lista como DESLISTADO nao se opera: estar no manifesto nao e estar a
  // venda (medido: 54 de 212 instrumentos no venue de teste). Recusa nomeada, antes das capacidades:
  // nao se discute o que a boleta pede para um instrumento que o venue deu por encerrado.
  if (unidade.deslistado === true) {
    return { veredicto: "recusado", motivo: "instrumento_deslistado_no_venue", avisos };
  }

  if (alvo.tipo === "boleta") {
    const boleta = alvo.carga;

    // Capacidades declaradas. Cada uma destas pode faltar — e faltar e recusar.
    if (!(manifesto.tipos_de_ordem ?? []).includes(boleta.tipo)) {
      return { veredicto: "recusado", motivo: "capacidade_nao_declarada", avisos };
    }
    if (!(manifesto.parcial_suportada ?? []).includes(boleta.parcial)) {
      return { veredicto: "recusado", motivo: "capacidade_nao_declarada", avisos };
    }
    if (boleta.reduce_only === true && manifesto.reduce_only_suportado !== true) {
      return { veredicto: "recusado", motivo: "capacidade_nao_declarada", avisos };
    }

    // Bandas declaradas pelo venue.
    if (compararDecimais(String(boleta.desvio_maximo), String(manifesto.desvio_maximo)) > 0) {
      return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
    }
    if (compararDecimais(String(boleta.alavancagem), String(unidade.alavancagem_maxima)) > 0) {
      return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
    }

    // Se o venue nao sabe guardar marca nenhuma, a posse nao e verificavel por ele: a mesa di-lo
    // (FR-027) em vez de fingir que tem marca.
    if (manifesto.marca_de_posse === "nenhuma") {
      avisos.push("marca_de_posse_nao_verificavel_pelo_venue");
    }
    return { veredicto: "aceite", motivo: null, avisos };
  }

  // Resolucao: agora ha valor, e o valor decide o escalao de alavancagem.
  const resolucao = alvo.carga;
  if (resolucao?.nocional === undefined) {
    return { veredicto: "recusado", motivo: "campo_obrigatorio_ausente", avisos };
  }
  const nocional = String(resolucao.nocional);

  // O PISO do venue: abaixo dele o venue RECUSA a ordem. Igual ao piso PASSA — um minimo e um piso,
  // nao um «acima de». (Ate a 1.3.0 este valor viajava no campo chamado `teto_de_valor_por_ordem`, que
  // era usado ao contrario: recusava os nocionais GRANDES e deixava passar os que o venue recusa.)
  if (manifesto.minimo_de_valor_por_ordem === undefined) {
    // Sem o piso declarado nao ha como conferir: e recusa, nunca «passa».
    return { veredicto: "recusado", motivo: "campo_obrigatorio_ausente", avisos };
  }
  if (compararDecimais(nocional, String(manifesto.minimo_de_valor_por_ordem)) < 0) {
    return { veredicto: "recusado", motivo: "valor_abaixo_do_minimo_do_venue", avisos };
  }

  // O TECTO, quando o venue o declara (aditivo na 1.4.0). Ausente = o venue nao declarou tecto nenhum:
  // nao se inventa um, e nao se recusa por um limite que ninguem escreveu.
  if (manifesto.maximo_de_valor_por_ordem !== undefined &&
      compararDecimais(nocional, String(manifesto.maximo_de_valor_por_ordem)) > 0) {
    // Nao se envia: registar a inconformidade e nao mandar e o unico desfecho honesto.
    return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
  }

  if (resolucao.alavancagem_efectiva !== undefined) {
    const efectiva = String(resolucao.alavancagem_efectiva);
    const maxima = maximaNoEscalao(unidade, nocional);
    if (maxima === null) {
      // O manifesto nao declara escalao nenhum para este valor: sem declaracao nao ha capacidade.
      return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
    }
    if (compararDecimais(efectiva, maxima) > 0) {
      return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
    }
  }
  return { veredicto: "aceite", motivo: null, avisos };
}

// ---------------------------------------------------------------- bateria

interface ConformidadeCaso {
  nome: string;
  manifesto: string;
  alvo: Alvo;
  veredicto_esperado: "aceite" | "recusado";
  motivo_esperado: string | null;
  enviadas_esperadas: number;
}

function bateria(): number {
  const ficheiro = join(RAIZ, "casos", "conferencia.conformidade.json");
  const conteudo = JSON.parse(readFileSync(ficheiro, "utf8")) as {
    manifestos: Record<string, any>;
    casos: ConformidadeCaso[];
  };
  let divergentes = 0;

  for (const caso of conteudo.casos) {
    const manifesto = conteudo.manifestos[caso.manifesto];
    if (manifesto === undefined) {
      console.log(`FALHA ${caso.nome}: manifesto "${caso.manifesto}" nao existe na bateria`);
      divergentes += 1;
      continue;
    }
    const resultado = conferir(manifesto, caso.alvo);
    // Uma mensagem recusada nao gera envio nenhum: e o que SC-003 exige, e mede-se aqui.
    const enviadas = resultado.veredicto === "aceite" ? 1 : 0;
    const ok =
      resultado.veredicto === caso.veredicto_esperado &&
      resultado.motivo === caso.motivo_esperado &&
      enviadas === caso.enviadas_esperadas;
    if (!ok) divergentes += 1;
    const avisos = resultado.avisos.length > 0 ? ` avisos=${resultado.avisos.join(",")}` : "";
    console.log(
      `${ok ? "ok  " : "FALHA"} ${caso.nome.padEnd(56)} ${resultado.veredicto}` +
        `${resultado.motivo ? ` ${resultado.motivo}` : ""} enviadas=${enviadas}${avisos}`,
    );
  }

  console.log(`conferencia: ${conteudo.casos.length} casos · ${divergentes} divergentes`);
  return divergentes;
}

if (import.meta.main) {
  if (!process.argv.includes("--bateria")) {
    console.log("uso: bun run esqueleto/conferir.ts --bateria");
    process.exit(2);
  }
  process.exit(bateria() === 0 ? 0 : 1);
}
