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

const decimal = (v: unknown): number => Number(String(v));

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
    if (decimal(boleta.desvio_maximo) > decimal(manifesto.desvio_maximo)) {
      return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
    }
    if (decimal(boleta.alavancagem) > decimal(unidade.alavancagem_maxima)) {
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
  const nocional = decimal(resolucao.nocional);
  if (nocional > decimal(manifesto.teto_de_valor_por_ordem)) {
    // Nao se envia: registar a inconformidade e nao mandar e o unico desfecho honesto.
    return { veredicto: "recusado", motivo: "valor_fora_da_banda", avisos };
  }
  if (resolucao.alavancagem_efectiva !== undefined) {
    const efectiva = decimal(resolucao.alavancagem_efectiva);
    let maxima = decimal(unidade.alavancagem_maxima);
    for (const escalao of unidade.alavancagem_por_escalao ?? []) {
      if (nocional <= decimal(escalao.ate)) {
        maxima = Math.min(maxima, decimal(escalao.maxima));
        break;
      }
    }
    if (efectiva > maxima) {
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
