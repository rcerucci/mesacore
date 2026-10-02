// A autoridade sobre o ficheiro de conta. O script de configuracao e a web NAO decidem: eles gravam,
// e este ficheiro julga — chave a chave, com motivo nomeado, e RECUSANDO o que nao estiver decidido.
//
// Porque existe: ate hoje nada validava um ficheiro de conta de ponta a ponta. O arranque faz
// `JSON.parse` (core/servidor.ts:109) e segue; um `null` onde se esperava um numero so aparecia
// como comportamento estranho mais tarde, ja com a mesa a operar. Aqui, `null` e RECUSA nomeada.
//
// Uso:  bun tools/verificar-config/conferir-config.ts <ficheiro.json> [--json]
// Saida: uma linha por achado (chave, motivo, porque) + um veredicto. exit=1 se houver achados.

import { readFileSync } from "node:fs";

type Achado = { chave: string; motivo: string; porque: string };
type Campo = {
  chave: string;                 // caminho dentro do ficheiro ("conta.identificador")
  tipo: "texto" | "decimal" | "decimal_textual" | "inteiro" | "lista" | "enum" | "objeto";
  obrigatorio?: boolean;         // ausente = achado
  opcional?: boolean;            // pode faltar, mas se vier tem de ser valido
  conjunto?: string[];           // para enum
  banda?: [number, number];      // para decimal/inteiro, inclusivo
  minimo?: number;               // para lista (comprimento minimo)
  nota?: string;
};

// O esqueleto e do CORE (config/README.md + docs/inventario-de-chaves.md sao a fonte).
// As TRES chaves retiradas pela emenda do dono (28 set) NAO estao aqui de proposito:
// idade_maxima_do_dado_ms, invalidos_seguidos_para_inibir, ordem_de_atendimento[].
// O `risco_maximo_por_ordem_pct` SAIU desta lista a 02/10/2026: o D-015 fechou que o travão de risco por ordem
// e' da MESA e que o tecto e' grandeza da CONTA — quem o declara quer que ele morda, e quem nao o declara esta'
// a dizer que aceita a exposicao (ausencia legitima, e por isso a chave e' OPCIONAL).
const CAMPOS: Campo[] = [
  { chave: "conta.corretora", tipo: "texto", obrigatorio: true },
  { chave: "conta.identificador", tipo: "texto", obrigatorio: true, nota: "o que distingue duas contas do mesmo venue" },
  // A lista de instrumentos NAO se declara aqui: o venue responde por pedido (a sonda le
  // meta.universe e publica-a no manifesto). Se estiver declarada, funciona como RESTRICAO — as
  // fichas tem de caber nela. Ausente e o normal.
  { chave: "conta.instrumentos", tipo: "lista", opcional: true, minimo: 1 },
  { chave: "conta.perda_maxima_pct", tipo: "decimal", obrigatorio: true, banda: [0, 100] },
  { chave: "conta.perda_maxima_janela", tipo: "enum", obrigatorio: true, conjunto: ["corrida_da_mesa", "dia_de_calendario"] },
  { chave: "conta.margem_total_maxima_pct", tipo: "decimal", obrigatorio: true, banda: [0, 100] },
  // O TECTO DE RISCO POR ORDEM (RN-M4.12, D-015). `decimal_textual`, e nao `decimal`: os outros decimais
  // deste ficheiro toleram um numero de JSON (convertem-no), mas o limite que vai comparar-se com a exposicao
  // da ordem viaja em TEXTO (D4) — um numero de virgula flutuante num limite de risco e' o defeito seguinte,
  // e o ciclo GRITA com ele em vez de o ler. Aqui apanha-se mais cedo, com o nome da chave.
  { chave: "conta.risco_maximo_por_ordem_pct", tipo: "decimal_textual", opcional: true, banda: [0, 100], nota: "sem ela nao ha' travão por ordem — a ausencia e' uma decisao do dono, e fica dita no registo" },
  { chave: "conta.contencao", tipo: "enum", obrigatorio: true, conjunto: ["recusar", "espera"] },
  { chave: "conta.arranque_apos_cb", tipo: "enum", obrigatorio: true, conjunto: ["exige_decisao"] },
  { chave: "conta.eventos_que_avisam", tipo: "lista", obrigatorio: true, minimo: 1 },
  { chave: "conta.conectores", tipo: "lista", obrigatorio: true, minimo: 1 },
  { chave: "conta.credencial", tipo: "texto", obrigatorio: true, nota: "o NOME da credencial — o valor nunca entra aqui (RN-E14)" },
  { chave: "conta.retencao_ledger.dias_integral", tipo: "inteiro", obrigatorio: true, banda: [0, 36500] },
  { chave: "conta.retencao_ledger.depois", tipo: "texto", obrigatorio: true },
];

const CAMPOS_DO_RISCO: Campo[] = [
  { chave: "risco.versao_do_mandato", tipo: "texto", obrigatorio: true, nota: "sem ela, `nova_sessao` recusa" },
  { chave: "risco.saldo_pct", tipo: "decimal", obrigatorio: true, banda: [0, 100] },
  { chave: "risco.alavancagem", tipo: "inteiro", obrigatorio: true, banda: [1, 1000] },
  { chave: "risco.distancia_minima_liquidacao_pct", tipo: "decimal", opcional: true, banda: [0, 100] },
  { chave: "risco.stop_pct", tipo: "decimal", obrigatorio: true, banda: [0, 100] },
  { chave: "risco.tp_pct", tipo: "decimal", obrigatorio: true, banda: [0, 100] },
  { chave: "risco.parcial", tipo: "texto", obrigatorio: true },
  { chave: "risco.desvio_maximo", tipo: "decimal", obrigatorio: true, banda: [0, 100] },
  { chave: "risco.destino_do_resto", tipo: "texto", obrigatorio: true },
  { chave: "risco.prazo_da_passiva_ms", tipo: "inteiro", obrigatorio: true, banda: [1, 86_400_000] },
];

const CAMPOS_DO_SETUP: Campo[] = [
  { chave: "setup.versao_do_setup", tipo: "texto", obrigatorio: true },
  { chave: "setup.prazo_de_resposta_ms", tipo: "inteiro", obrigatorio: true, banda: [1, 86_400_000] },
];

const CONHECIDOS = new Set([
  "conta", "fichas", "_como_usar",
  // `conexao` e o bloco do PLUGIN (venue, ambiente, URL e a referencia da credencial). O core nao o le —
  // e reconhecido aqui para o aviso de deriva nao disparar sobre algo legitimo.
  "conexao", "ficha_do_instrumento", "plugin", "tipo", "versao_do_questionario",
  ...[...CAMPOS].map((c) => c.chave.split(".")[0]),
]);

function ler(obj: any, caminho: string): { existe: boolean; valor: any } {
  let atual = obj;
  for (const parte of caminho.split(".")) {
    if (atual === null || typeof atual !== "object" || !(parte in atual)) return { existe: false, valor: undefined };
    atual = atual[parte];
  }
  return { existe: true, valor: atual };
}

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/; // a mesma forma do contrato: textual, sem expoente

function julgar(campo: Campo, obj: any, achados: Achado[]): void {
  const { existe, valor } = ler(obj, campo.chave);
  if (!existe) {
    if (campo.obrigatorio) {
      achados.push({
        chave: campo.chave,
        motivo: "campo_obrigatorio_ausente",
        porque: campo.nota ? `falta declarar (${campo.nota})` : "falta declarar",
      });
    }
    return;
  }
  if (valor === null) {
    achados.push({
      chave: campo.chave,
      motivo: "valor_nulo_nao_permitido",
      porque: campo.nota ? `a decisao e do dono e nao foi tomada (${campo.nota})` : "a decisao e do dono e nao foi tomada",
    });
    return;
  }
  switch (campo.tipo) {
    case "texto":
      if (typeof valor !== "string" || valor.trim() === "") achados.push({ chave: campo.chave, motivo: "formato_invalido", porque: "tem de ser texto nao vazio" });
      break;
    case "lista":
      if (!Array.isArray(valor)) achados.push({ chave: campo.chave, motivo: "tipo_invalido", porque: "tem de ser lista" });
      else if (campo.minimo !== undefined && valor.length < campo.minimo) achados.push({ chave: campo.chave, motivo: "campo_obrigatorio_ausente", porque: `lista com menos de ${campo.minimo} elemento(s)` });
      break;
    case "enum":
      if (typeof valor !== "string" || !campo.conjunto?.includes(valor)) achados.push({ chave: campo.chave, motivo: "valor_fora_do_conjunto", porque: `valores aceites: ${campo.conjunto?.join(", ")}` });
      break;
    case "decimal": {
      const t = typeof valor === "number" ? String(valor) : valor;
      if (typeof t !== "string" || !DECIMAL.test(t)) { achados.push({ chave: campo.chave, motivo: "formato_invalido", porque: "decimal textual, sem expoente e sem null" }); break; }
      const n = Number(t);
      if (campo.banda && (n < campo.banda[0] || n > campo.banda[1])) achados.push({ chave: campo.chave, motivo: "valor_fora_da_banda", porque: `tem de estar entre ${campo.banda[0]} e ${campo.banda[1]}, e veio ${t} ` });
      break;
    }
    case "decimal_textual": {
      // SEM tolerancia ao numero de JSON: o limite viaja em texto (D4) e um `2.5` escrito sem aspas nao se
      // converte — recusa-se com o nome da chave, em vez de o deixar entrar para o ciclo a gritar.
      if (typeof valor !== "string" || !DECIMAL.test(valor)) { achados.push({ chave: campo.chave, motivo: "formato_invalido", porque: "decimal TEXTUAL entre aspas, sem expoente e sem null (D4)" }); break; }
      const n = Number(valor);
      if (campo.banda && (n < campo.banda[0] || n > campo.banda[1])) achados.push({ chave: campo.chave, motivo: "valor_fora_da_banda", porque: `tem de estar entre ${campo.banda[0]} e ${campo.banda[1]}, e veio ${valor}` });
      break;
    }
    case "inteiro": {
      const t = typeof valor === "number" ? String(valor) : valor;
      if (typeof t !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(t)) { achados.push({ chave: campo.chave, motivo: "formato_invalido", porque: "inteiro, sem casas decimais" }); break; }
      const n = Number(t);
      if (campo.banda && (n < campo.banda[0] || n > campo.banda[1])) achados.push({ chave: campo.chave, motivo: "valor_fora_da_banda", porque: `tem de estar entre ${campo.banda[0]} e ${campo.banda[1]}, e veio ${t}` });
      break;
    }
    case "objeto":
      if (typeof valor !== "object" || Array.isArray(valor)) achados.push({ chave: campo.chave, motivo: "tipo_invalido", porque: "tem de ser objeto" });
      break;
  }
}

/** As bandas do mandato: quem manda no valor e a ficha, mas a banda tem de CONTER o valor. */
function julgarBandas(obj: any, achados: Achado[]): void {
  const bandas = ler(obj, "risco.bandas").valor;
  if (bandas === undefined) return; // a banda e opcional; o que nao pode e existir e nao conter
  if (typeof bandas !== "object" || bandas === null) { achados.push({ chave: "risco.bandas", motivo: "tipo_invalido", porque: "tem de ser objeto" }); return; }
  for (const [campo, limites] of Object.entries<any>(bandas)) {
    if (typeof limites !== "object" || limites === null) { achados.push({ chave: `risco.bandas.${campo}`, motivo: "tipo_invalido", porque: "tem de ser {minimo, maximo}" }); continue; }
    const valor = ler(obj, `risco.${campo}`).valor;
    for (const lado of ["minimo", "maximo"] as const) {
      const limite = limites[lado];
      if (limite === undefined || limite === null) continue;
      if (typeof limite !== "string" || !DECIMAL.test(limite)) { achados.push({ chave: `risco.bandas.${campo}.${lado}`, motivo: "formato_invalido", porque: "decimal textual" }); continue; }
      if (valor === undefined || valor === null) continue; // o valor em falta ja foi apontado no campo
      const v = Number(typeof valor === "number" ? String(valor) : valor);
      const l = Number(limite);
      if (lado === "minimo" && v < l) achados.push({ chave: `risco.${campo}`, motivo: "valor_fora_da_banda", porque: `o valor ${valor} esta abaixo do minimo declarado na banda (${limite})` });
      if (lado === "maximo" && v > l) achados.push({ chave: `risco.${campo}`, motivo: "valor_fora_da_banda", porque: `o valor ${valor} esta acima do maximo declarado na banda (${limite})` });
    }
  }
}

export function conferir(caminho: string): { ficheiro: string; achados: Achado[]; veredicto: string; fichas: string[] } {
  let bruto: any;
  try { bruto = JSON.parse(readFileSync(caminho, "utf8")); }
  catch (e) { return { ficheiro: caminho, achados: [{ chave: "(ficheiro)", motivo: "formato_invalido", porque: `JSON ilegivel: ${(e as Error).message}` }], veredicto: "recusado", fichas: [] }; }

  const achados: Achado[] = [];
  if (bruto === null || typeof bruto !== "object") achados.push({ chave: "(raiz)", motivo: "tipo_invalido", porque: "o ficheiro tem de ser um objeto" });
  else {
    for (const campo of CAMPOS) julgar(campo, bruto, achados);
    const fichas = ler(bruto, "fichas").valor;
    const nomes = fichas && typeof fichas === "object" ? Object.keys(fichas) : [];
    // Conta sem ficha nenhuma e um estado LEGITIMO: o conector sobe com a conta, e as fichas entram
    // depois, uma a uma, pelo fluxo do plugin de setup (por instrumento). E aviso, nunca recusa.
    if (nomes.length === 0) achados.push({ chave: "fichas", motivo: "campo_desconhecido", porque: "nenhuma ficha declarada ainda — a conta esta configurada, os instrumentos entram pelo fluxo do setup" });
    for (const nome of nomes) {
      const ficha = fichas[nome];
      for (const campo of CAMPOS_DO_RISCO) julgar(campo, ficha, achados);
      for (const campo of CAMPOS_DO_SETUP) julgar(campo, ficha, achados);
      julgarBandas(ficha, achados);
      // se a conta declara uma RESTRICAO de instrumentos, as fichas tem de caber nela
      const instrumentos = ler(bruto, "conta.instrumentos").valor;
      if (Array.isArray(instrumentos) && !instrumentos.includes(nome)) achados.push({ chave: `fichas.${nome}`, motivo: "valor_fora_do_conjunto", porque: `o instrumento nao esta na restricao conta.instrumentos: [${instrumentos.join(", ")}]` });
    }
    // chaves desconhecidas: aviso, nunca recusa (a mesa ignora-as; mas o aviso apanha a deriva)
    for (const k of Object.keys(bruto)) if (!CONHECIDOS.has(k)) achados.push({ chave: k, motivo: "campo_desconhecido", porque: "chave de topo nao reconhecida (aviso — a mesa ignora-a)" });
  }
  const recusas = achados.filter((a) => a.motivo !== "campo_desconhecido");
  return { ficheiro: caminho, achados, veredicto: recusas.length === 0 ? "aprovado" : "recusado", fichas: Object.keys(ler(bruto, "fichas").valor ?? {}) };
}

if (import.meta.main) {
  const caminho = process.argv[2];
  if (!caminho) { console.error("uso: bun tools/verificar-config/conferir-config.ts <ficheiro.json>"); process.exit(2); }
  const r = conferir(caminho);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r));
  } else {
    for (const a of r.achados) console.log(`${a.motivo === "campo_desconhecido" ? "aviso" : "RECUSA"}  ${a.chave}  ${a.motivo}  — ${a.porque}`);
    const recusas = r.achados.filter((a) => a.motivo !== "campo_desconhecido").length;
    const avisos = r.achados.length - recusas;
    console.log(`conferidor: ${r.veredicto} — ${recusas} recusa(s), ${avisos} aviso(s) · fichas: ${r.fichas.join(", ") || "nenhuma (entram pelo fluxo do setup)"}`);
  }
  process.exit(r.veredicto === "aprovado" ? 0 : 1);
}
