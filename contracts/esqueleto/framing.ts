// Enquadramento e validacao do envelope — lado TypeScript.
//
// Regras que este ficheiro tem de cumprir, todas do data-model.md:
//   - uma mensagem por linha (UTF-8), sem quebras internas
//   - a versao do contrato confere-se ANTES de qualquer envio, por igualdade exacta (D7)
//   - o contrato e FECHADO (D5) e null nao existe (D4)
//   - a recusa traz um motivo NORMALIZADO, lido de vocabulario.json
//
// A lista de campos proibidos e a PRIORIDADE dos motivos NAO estao aqui: sao lidas de
// vocabulario.json, para que as duas linguagens nao possam divergir por copia.

import Ajv2020 from "ajv/dist/2020";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const RAIZ = join(import.meta.dir, "..");
const ID_DO_ENVELOPE = "https://mesacore.local/contracts/envelope.schema.json";

export type Veredicto = "aceite" | "recusado" | "erro_de_execucao";

export interface Decisao {
  veredicto: Veredicto;
  motivo: string | null;
}

function lerJson(caminho: string): any {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

export function versaoVigente(): string {
  return lerJson(join(RAIZ, "versao.json")).contrato;
}

interface Vocabulario {
  motivos: Record<string, unknown>;
  prioridade_dos_motivos: string[];
  campos_em_unidade_de_corretora: string[];
}

export function vocabulario(): Vocabulario {
  return lerJson(join(RAIZ, "vocabulario.json"));
}

function ficheirosDeSchema(): string[] {
  const nomes = readdirSync(RAIZ).filter((n) => n.endsWith(".schema.json"));
  const defs = readdirSync(join(RAIZ, "_defs"))
    .filter((n) => n.endsWith(".schema.json"))
    .map((n) => join("_defs", n));
  return [...nomes, ...defs];
}

let validador: ((dados: unknown) => boolean) | null = null;
let erroDeCompilacao: unknown = null;

/** Compila o envelope. Falha ALTO se faltar um schema: a bateria nao pode passar por omissao. */
function compilar(): (dados: unknown) => boolean {
  if (validador) return validador;
  if (erroDeCompilacao) throw erroDeCompilacao;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    for (const ficheiro of ficheirosDeSchema()) {
      ajv.addSchema(lerJson(join(RAIZ, ficheiro)));
    }
    const schema = ajv.getSchema(ID_DO_ENVELOPE);
    if (!schema) throw new Error(`schema do envelope nao encontrado: ${ID_DO_ENVELOPE}`);
    validador = schema as (dados: unknown) => boolean;
    return validador;
  } catch (erro) {
    // Um instrumento que nao consegue medir tem de DIZER PORQUE. Sem isto, um schema com
    // um erro de sintaxe aparece como 76 casos "indecididos" e ninguem sabe o que se passa.
    erroDeCompilacao = erro;
    console.error(`[framing] nao consegui compilar o contrato: ${(erro as Error).message}`);
    throw erro;
  }
}

const NULA = "valor_nulo_nao_permitido";

/** Traduz o erro do validador para o motivo normalizado. A ordem entre motivos vem do vocabulario. */
function motivoDoErro(erro: any, dados: unknown, voc: Vocabulario): string | null {
  const caminho: string[] = String(erro.instancePath ?? "")
    .split("/")
    .filter((s) => s.length > 0);

  switch (erro.keyword) {
    case "additionalProperties": {
      const campo = erro.params?.additionalProperty;
      return voc.campos_em_unidade_de_corretora.includes(campo)
        ? "campo_em_unidade_de_corretora"
        : "campo_desconhecido";
    }
    case "required": {
      // A boleta sem politica de parcial tem motivo PROPRIO (RN-B6).
      if (erro.params?.missingProperty === "parcial") return "parcial_nao_declarada";
      return "campo_obrigatorio_ausente";
    }
    case "type": {
      const valor = valorNoCaminho(dados, caminho);
      return valor === null ? NULA : "tipo_invalido";
    }
    case "pattern":
      return "formato_invalido";
    case "enum":
      return "valor_fora_do_conjunto";
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      return "valor_fora_da_banda";
    case "const":
      return "valor_fora_do_conjunto";
    default:
      return null;
  }
}

function valorNoCaminho(dados: unknown, caminho: string[]): unknown {
  let atual: any = dados;
  for (const passo of caminho) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = atual[passo];
  }
  return atual;
}

/** Escolhe UM motivo: o primeiro da ordem declarada no vocabulario que apareceu nos erros. */
function escolherMotivo(erros: any[], dados: unknown, voc: Vocabulario): string | null {
  const encontrados = new Set<string>();
  for (const erro of erros) {
    const motivo = motivoDoErro(erro, dados, voc);
    if (motivo) encontrados.add(motivo);
  }
  for (const motivo of voc.prioridade_dos_motivos) {
    if (encontrados.has(motivo)) return motivo;
  }
  return encontrados.size > 0 ? [...encontrados][0]! : null;
}

/**
 * Valida uma mensagem recebida como TEXTO CRU, como ela chega pela fronteira.
 * Nao lanca: devolve sempre uma decisao. Um erro do proprio instrumento de medicao
 * devolve erro_de_execucao — nunca "aceite" por omissao.
 */
export function validar(texto: string): Decisao {
  const voc = vocabulario();

  // 1. enquadramento: uma linha, um objecto
  let linha = texto;
  if (linha.endsWith("\n")) linha = linha.slice(0, -1);
  if (linha.includes("\n") || linha.trim() === "") {
    return { veredicto: "recusado", motivo: "enquadramento_invalido" };
  }
  let dados: unknown;
  try {
    dados = JSON.parse(linha);
  } catch {
    return { veredicto: "recusado", motivo: "enquadramento_invalido" };
  }
  if (dados === null || typeof dados !== "object" || Array.isArray(dados)) {
    return { veredicto: "recusado", motivo: "enquadramento_invalido" };
  }

  // 2. versao do contrato, por igualdade exacta, ANTES de qualquer envio (D7)
  const declarada = (dados as Record<string, unknown>)["contrato"];
  if (declarada !== versaoVigente()) {
    return { veredicto: "recusado", motivo: "versao_do_contrato_divergente" };
  }

  // 3. o envelope contra o schema
  let valida: (d: unknown) => boolean;
  try {
    valida = compilar();
  } catch {
    return { veredicto: "erro_de_execucao", motivo: null };
  }
  if (valida(dados)) return { veredicto: "aceite", motivo: null };

  const erros = (valida as any).errors ?? [];
  const motivo = escolherMotivo(erros, dados, voc);
  if (motivo === null) {
    // Um erro que o vocabulario nao sabe nomear e um buraco do proprio contrato.
    return { veredicto: "erro_de_execucao", motivo: null };
  }
  return { veredicto: "recusado", motivo };
}
