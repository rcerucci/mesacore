#!/usr/bin/env bun
// ESCREVER UMA FICHA — A PORTA ÚNICA DE ESCRITA DO DONO.
//
// PORQUE EXISTE, e porque é assim. `RN-E12`: `/config` é do dono — a mesa lê-o, valida-o e **nunca o escreve**; a
// web edita-o **com validação e assinatura (RN-M2)**. E `RN-M2` diz o que «assinatura» quer dizer nesta casa: o
// valor em vigor **e a sua origem** ficam registados, «para que a divergência entre o que se quis e o que corre
// nunca seja silenciosa». Não é um nome bonito num campo: é um registo.
//
// A ORDEM DAS OPERAÇÕES É O DESENHO, e não se troca:
//
//   1. lê a ficha COMO ELA ESTÁ e guarda a sua impressão (sha256);
//   2. se quem pede trouxe a impressão do que viu, compara-as — **uma página velha não escreve por cima de uma
//      mudança nova** (é o defeito clássico de dois separadores abertos);
//   3. compõe o CANDIDATO (só as chaves que mudam; tudo o resto fica como estava, palavra por palavra);
//   4. **valida o candidato ANTES de tocar no ficheiro**: copia a árvore das fichas para um sítio temporário, põe
//      lá o candidato e corre o MESMO conferidor do portão (`tools/verificar-setup/fichas.py`). Se ele reprovar,
//      NÃO SE ESCREVE NADA — e a razão que ele deu é a resposta. Não há aqui uma segunda conta das regras: quem
//      julga é ele (RN-E9);
//   5. só então escreve, de forma atómica (ficheiro novo + troca de nome), e deixa a LINHA NO REGISTO com o
//      instante, a origem, o antes e o depois.
//
// NÃO ESCREVE FORA DE `fichas/`. O caminho é resolvido dentro de `fichas/` e um caminho que aponte para fora é
// recusado: esta porta existe para fichas, e uma porta que serve para tudo não é uma porta, é um buraco.
//
// Uso (linha de comando — é a mesma porta que a tela usa):
//   bun run tools/escrever-ficha/escrever-ficha.ts --ficha fichas/sigma/BTC-hl-teste-plugin.json \
//       --mudar cabecalho.saldo_pct=12 --mudar cabecalho.enviar=false
//   bun run tools/escrever-ficha/escrever-ficha.ts --ficha … --mudar … --simular          (valida, não escreve)
//   bun run tools/escrever-ficha/escrever-ficha.ts --ficha … --mudar … --visto <sha256>   (guarda contra página velha)
//
// Saída: o que muda, o que o conferidor disse, e o que se fez. Código de saída 0 só quando escreveu (ou quando a
// simulação passou).

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, cpSync } from "node:fs";
import { join, isAbsolute, resolve, basename, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";

export const RAIZ = join(import.meta.dir, "..", "..");
const PASTA_DAS_FICHAS = join(RAIZ, "fichas");
/** A OUTRA família que esta porta cria: as contas. A lista é fechada em código (`pastasQueSeCriam`). */
const PASTA_DAS_CONTAS = join(RAIZ, "config", "contas");
const CONFERIDOR = join(RAIZ, "tools", "verificar-setup", "fichas.py");
/** O conferidor das CONTAS — outro programa, porque outra família de documento. */
const CONFERIR_CONFIG = join(RAIZ, "tools", "verificar-config", "conferir-config.ts");
/** O registo vive FORA do repositório: `RN-E12` diz que em `/config` há três famílias de ficheiro, e só três —
 *  um histórico dentro de `config/` seria uma quarta, e a regra não é uma sugestão. */
export const REGISTO = join(homedir(), ".config", "mesacore", "historico-de-fichas.jsonl");

export type Mudanca = string | number | boolean;
export type Mudancas = Record<string, Mudanca>;
export type Diferenca = { chave: string; de: unknown; para: unknown };
export type Veredicto = { correu: boolean; codigo: number | null; saida: string; estaFichaAprovou: boolean | null };

const sha = (texto: string) => createHash("sha256").update(texto).digest("hex");

/**
 * AS CHAVES QUE TÊM BANDA DECLARADA NA PRÓPRIA FICHA, e porquê isto vive aqui.
 *
 * O conferidor confere a FORMA (tipo, bandas presentes, identidade) e não o valor contra a banda — quem confere o
 * valor é a MESA, no momento da boleta (`core/ciclo/banda.ts`). Mas escrever `saldo_pct` fora da banda da própria
 * ficha deixa no disco uma ficha que a mesa vai RECUSAR em tempo de execução: o par fica a olhar, sem operar, e o
 * dono não vê nada a acontecer. Uma porta de escrita que aceita isso não é uma porta, é uma armadilha — por isso o
 * candidato é conferido também contra a banda que ele mesmo declara, e a recusa diz os números.
 */
const CHAVES_COM_BANDA = ["saldo_pct", "alavancagem", "stop_pct", "tp_pct"];
function foraDaBanda(cabecalho: Record<string, any> | undefined, chave: string, valorNovo: unknown): string | null {
  const curto = chave.replace(/^cabecalho\./, "");
  if (!CHAVES_COM_BANDA.includes(curto)) return null;
  const banda = cabecalho?.["bandas"]?.[curto];
  if (banda === null || typeof banda !== "object") return null; // sem banda declarada, o conferidor é quem fala
  const v = Number(valorNovo);
  const min = Number(banda["minimo"]), max = Number(banda["maximo"]);
  if (!Number.isFinite(v)) return `«${chave}» não é um número (a banda é ${banda["minimo"]}–${banda["maximo"]})`;
  if (Number.isFinite(min) && v < min) return `«${chave}» = ${valorNovo} fica ABAIXO da banda da própria ficha (${banda["minimo"]}–${banda["maximo"]}) — a mesa recusaria em tempo de execução`;
  if (Number.isFinite(max) && v > max) return `«${chave}» = ${valorNovo} fica ACIMA da banda da própria ficha (${banda["minimo"]}–${banda["maximo"]}) — a mesa recusaria em tempo de execução`;
  return null;
}

/** O caminho de uma ficha, resolvido DENTRO de `fichas/` — e recusado se apontar para fora. */
export function caminhoDaFicha(pedido: string): { caminho: string; relativo: string } | { recusa: string } {
  const bruto = isAbsolute(pedido) ? pedido : join(RAIZ, pedido);
  const caminho = resolve(bruto);
  if (caminho !== PASTA_DAS_FICHAS && !caminho.startsWith(PASTA_DAS_FICHAS + sep)) {
    return { recusa: `«${pedido}» não está dentro de fichas/ — esta porta só escreve fichas` };
  }
  if (!existsSync(caminho)) return { recusa: `não existe a ficha «${pedido}»` };
  return { caminho, relativo: caminho.slice(PASTA_DAS_FICHAS.length + 1) };
}

export function lerFicha(caminho: string) {
  const texto = readFileSync(caminho, "utf8");
  return { texto, hash: sha(texto), cru: JSON.parse(texto) as Record<string, any> };
}

/** O valor de um caminho pontuado (`cabecalho.bandas.saldo_pct.maximo`) — sem inventar o que não existe. */
export function valorEm(o: Record<string, any>, chave: string): unknown {
  let atual: any = o;
  for (const parte of chave.split(".")) {
    if (atual === null || typeof atual !== "object" || !(parte in atual)) return undefined;
    atual = atual[parte];
  }
  return atual;
}

/**
 * Põe um valor num caminho pontuado, **criando só o que falta no fim**. Uma chave que não existe no documento
 * não é criada a meio de uma ramificação nova sem que o dono saiba: quem compõe o candidato manda chaves que já
 * existem (a tela só edita o que está lá), e uma chave desconhecida é recusada mais à frente pelo conferidor.
 */
export function porValor(o: Record<string, any>, chave: string, valor: unknown): void {
  const partes = chave.split(".");
  let atual: any = o;
  for (const parte of partes.slice(0, -1)) {
    if (atual[parte] === undefined) atual[parte] = {};
    atual = atual[parte];
  }
  atual[partes[partes.length - 1]] = valor;
}

/** O que muda, chave a chave — sobre folhas (números, textos, booleanos), e sem tocar no que fica igual. */
export function diferencas(antes: Record<string, any>, depois: Record<string, any>, prefixo = ""): Diferenca[] {
  const chaves = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})]);
  const saida: Diferenca[] = [];
  for (const k of [...chaves].sort()) {
    const caminho = prefixo === "" ? k : `${prefixo}.${k}`;
    const a = antes?.[k], b = depois?.[k];
    const ambosObjetos = a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b);
    if (ambosObjetos) { saida.push(...diferencas(a, b, caminho)); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) saida.push({ chave: caminho, de: a, para: b });
  }
  return saida;
}

/**
 * O candidato passa pelo conferidor do portão — numa CÓPIA da árvore das fichas, sem tocar na verdadeira.
 * Isto é o coração do «validar antes de escrever»: o veredicto é do conferidor (o mesmo binário que o portão
 * corre), e a árvore temporária garante que uma validação reprovada não deixa nada escrito.
 */
export function conferirCandidato(relativo: string, candidato: Record<string, any>, familia: "fichas" | "config/contas" = "fichas"): Veredicto {
  const temporario = join(tmpdir(), `mesacore-ficha-${process.pid}-${Date.now()}`);
  try {
    if (familia === "fichas") {
      // O CONFERIDOR DAS FICHAS LÊ A PASTA QUE LHE DEREM (com o argumento), e sem ele leria a do repositório —
      // foi esse o defeito de uma primeira versão: o candidato era escrito na cópia e o veredicto saía sobre a
      // árvore VERDADEIRA (três fichas, e nenhuma delas a nova).
      const onde = join(temporario, "fichas");
      cpSync(PASTA_DAS_FICHAS, onde, { recursive: true });
      mkdirSync(dirname(join(onde, relativo)), { recursive: true });
      writeFileSync(join(onde, relativo), JSON.stringify(candidato, null, 1) + "\n", "utf8");
      const r = spawnSync("python3", [CONFERIDOR, onde], { encoding: "utf8", timeout: 30000 });
      const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
      const nome = basename(relativo);
      const reprovada = new RegExp(`REPROVA\\s+\\S*${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(saida);
      const aprovada = new RegExp(`ok\\s+\\S*${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(saida);
      if (r.error !== undefined || r.status === null) {
        return { correu: false, codigo: null, saida: `o conferidor não correu: ${r.error?.message ?? "sem código de saída"}`, estaFichaAprovou: null };
      }
      return { correu: true, codigo: r.status, saida, estaFichaAprovou: reprovada ? false : aprovada ? true : null };
    }
    // AS CONTAS TÊM OUTRO CONFERIDOR (`tools/verificar-config/conferir-config.ts`): o das fichas só confere
    // fichas, e usá-lo aqui daria um «veredicto» que não existe — a pior espécie de aprovação.
    const onde = join(temporario, "config", "contas");
    mkdirSync(onde, { recursive: true });
    if (existsSync(PASTA_DAS_CONTAS)) cpSync(PASTA_DAS_CONTAS, onde, { recursive: true });
    writeFileSync(join(onde, relativo), JSON.stringify(candidato, null, 1) + "\n", "utf8");
    const r = spawnSync("bun", ["run", CONFERIR_CONFIG, join(onde, relativo), "--json"], { encoding: "utf8", timeout: 30000 });
    const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (r.error !== undefined || r.status === null) {
      return { correu: false, codigo: null, saida: `o conferidor da configuração não correu: ${r.error?.message ?? "sem código de saída"}`, estaFichaAprovou: null };
    }
    let aprovada: boolean | null = null;
    try {
      const linha = saida.split("\n").filter((l) => l.trim().startsWith("{")).pop();
      const j = JSON.parse(linha ?? "{}") as { veredicto?: string };
      if (j.veredicto === "aprovado") aprovada = true;
      else if (j.veredicto === "recusado") aprovada = false;
    } catch { /* saída sem JSON: sem veredicto, e é isso que se devolve */ }
    return { correu: true, codigo: r.status, saida, estaFichaAprovou: aprovada };
  } catch (e) {
    return { correu: false, codigo: null, saida: `não se conseguiu validar: ${e instanceof Error ? e.message : String(e)}`, estaFichaAprovou: null };
  } finally {
    rmSync(temporario, { recursive: true, force: true });
  }
}

/** Escreve de forma atómica: o ficheiro novo ao lado, e a troca de nome (ou não há troca, ou há a nova inteira). */
function escreverAtomico(caminho: string, conteudo: string): void {
  const novo = `${caminho}.novo`;
  writeFileSync(novo, conteudo, "utf8");
  renameSync(novo, caminho);
}

function registar(linha: Record<string, unknown>): void {
  mkdirSync(join(homedir(), ".config", "mesacore"), { recursive: true });
  writeFileSync(REGISTO, JSON.stringify(linha) + "\n", { encoding: "utf8", flag: "a" });
}

export type Resultado = {
  ok: boolean;
  porque?: string;
  diferencas?: Diferenca[];
  veredicto?: Veredicto;
  escrito?: boolean;
  hash_antes?: string;
  hash_depois?: string;
};

/**
 * A operação completa. `visto` é a impressão que quem pede tinha do ficheiro: quando vem, tem de bater com o que
 * está em disco — é o que impede uma página aberta há dez minutos de escrever por cima de uma mudança nova.
 */
export function escrever(
  pedidoDaFicha: string,
  mudancas: Mudancas,
  opcoes: { visto?: string | null; simular?: boolean; origem?: string } = {},
): Resultado {
  const alvo = caminhoDaFicha(pedidoDaFicha);
  if ("recusa" in alvo) return { ok: false, porque: alvo.recusa };
  const { caminho, relativo } = alvo;

  let antes: { texto: string; hash: string; cru: Record<string, any> };
  try { antes = lerFicha(caminho); } catch (e) {
    return { ok: false, porque: `a ficha está ilegível (${e instanceof Error ? e.message : String(e)}) — não se escreve por cima do que não se consegue ler` };
  }
  if (opcoes.visto && opcoes.visto !== antes.hash) {
    return {
      ok: false,
      porque: "a ficha mudou desde que a abriste (a impressão que trouxeste não é a do ficheiro) — recarrega e volta a compor a mudança",
      hash_antes: antes.hash,
    };
  }
  if (Object.keys(mudancas).length === 0) return { ok: false, porque: "não há nada para mudar" };

  const candidato = JSON.parse(antes.texto) as Record<string, any>;
  for (const [chave, valor] of Object.entries(mudancas)) porValor(candidato, chave, valor);
  const dif = diferencas(antes.cru, candidato);
  if (dif.length === 0) return { ok: false, porque: "os valores enviados são iguais aos que já estão na ficha" };

  for (const [chave, valor] of Object.entries(mudancas)) {
    const recusa = foraDaBanda(candidato["cabecalho"], chave, valor);
    if (recusa !== null) return { ok: false, porque: recusa, diferencas: dif, hash_antes: antes.hash };
  }

  const veredicto = conferirCandidato(relativo, candidato);
  if (!veredicto.correu || veredicto.estaFichaAprovou !== true) {
    return {
      ok: false,
      porque: veredicto.correu
        ? (veredicto.estaFichaAprovou === false ? "o conferidor REPROVOU o candidato — nada foi escrito" : "o conferidor não deu veredicto sobre esta ficha — nada foi escrito")
        : veredicto.saida,
      diferencas: dif,
      veredicto,
      hash_antes: antes.hash,
    };
  }
  if (opcoes.simular) return { ok: true, diferencas: dif, veredicto, escrito: false, hash_antes: antes.hash };

  const texto = JSON.stringify(candidato, null, 1) + "\n";
  escreverAtomico(caminho, texto);
  registar({
    instante: new Date().toISOString(),
    ficha: `fichas/${relativo}`,
    origem: opcoes.origem ?? "linha de comando",
    de: antes.hash,
    para: sha(texto),
    mudancas: dif,
  });
  return { ok: true, diferencas: dif, veredicto, escrito: true, hash_antes: antes.hash, hash_depois: sha(texto) };
}

/* ================================================================ CRIAR (o que ainda não existe)
 * CRIAR NÃO É SOBREPOR, e é por isso que é OUTRA função: `escrever` exige uma ficha que já exista (precisa de um
 * «antes» para comparar e de uma impressão para conferir). Criar parte de um CANDIDATO, e a guarda que substitui
 * a impressão é outra: **o ficheiro não existir**. Se existir, recusa e manda usar o caminho da edição — uma
 * porta que cria por cima do que existe é uma porta que apaga.
 *
 * DUAS FAMÍLIAS, E SÓ DUAS: as fichas (`fichas/<setup>/<PAR>-<conta>.json`) e as contas
 * (`config/contas/<nome>.json`). A lista é fechada AQUI, em código. Uma porta que cria qualquer coisa não é uma
 * porta, é um buraco — e é a mesma razão pela qual o `escrever` só serve fichas.
 */
export function pastasQueSeCriam(): { pasta: string; familia: "fichas" | "config/contas"; exemplo: string }[] {
  return [
    { pasta: PASTA_DAS_FICHAS, familia: "fichas", exemplo: "fichas/<setup>/<PAR>-<conta>.json" },
    { pasta: PASTA_DAS_CONTAS, familia: "config/contas", exemplo: "config/contas/<nome>.json" },
  ];
}
function caminhoNovo(pedido: string): { caminho: string; relativo: string; familia: "fichas" | "config/contas" } | { recusa: string } {
  const caminho = resolve(isAbsolute(pedido) ? pedido : join(RAIZ, pedido));
  const familia = pastasQueSeCriam().find((f) => caminho === f.pasta || caminho.startsWith(f.pasta + sep));
  if (familia === undefined) {
    return { recusa: `«${pedido}» não está dentro de fichas/ nem de config/contas/ — esta porta só cria estes dois documentos` };
  }
  return { caminho, relativo: caminho.slice(familia.pasta.length + 1), familia: familia.familia };
}

export function criar(
  pedido: string,
  candidato: Record<string, any>,
  opcoes: { simular?: boolean; origem?: string } = {},
): Resultado {
  const alvo = caminhoNovo(pedido);
  if ("recusa" in alvo) return { ok: false, porque: alvo.recusa };
  const { caminho, relativo, familia } = alvo;
  if (existsSync(caminho)) {
    return { ok: false, porque: `já existe «${relativo}» — criar não é sobrepor: para mudar o que existe, use o caminho da edição` };
  }
  if (candidato === null || typeof candidato !== "object" || Array.isArray(candidato)) {
    return { ok: false, porque: "o candidato não tem forma de documento (um objecto JSON)" };
  }
  const veredicto = conferirCandidato(relativo, candidato, familia);
  if (!veredicto.correu || veredicto.estaFichaAprovou !== true) {
    return {
      ok: false,
      porque: veredicto.correu
        ? (veredicto.estaFichaAprovou === false ? "o conferidor REPROVOU o candidato — nada foi criado" : "o conferidor não deu veredicto sobre este candidato — nada foi criado")
        : veredicto.saida,
      veredicto,
    };
  }
  if (opcoes.simular) return { ok: true, veredicto, escrito: false };
  const texto = JSON.stringify(candidato, null, 1) + "\n";
  escreverAtomico(caminho, texto);
  registar({
    instante: new Date().toISOString(),
    ficha: `${familia}/${relativo}`,
    origem: opcoes.origem ?? "linha de comando",
    de: null,
    para: sha(texto),
    criado: true,
    mudancas: [],
  });
  return { ok: true, veredicto, escrito: true, hash_depois: sha(texto) };
}

// ------------------------------------------------------------------ a linha de comando
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const pega = (nome: string): string | undefined => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ficha = pega("--ficha");
  const visto = pega("--visto") ?? null;
  const simular = argv.includes("--simular");
  const mudancas: Mudancas = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--mudar") continue;
    const bruto = argv[i + 1] ?? "";
    const corte = bruto.indexOf("=");
    if (corte <= 0) { console.error(`--mudar espera chave=valor (veio «${bruto}»)`); process.exit(2); }
    const chave = bruto.slice(0, corte);
    const valor = bruto.slice(corte + 1);
    // O TIPO É DECIDIDO PELO QUE LÁ ESTÁ, não pelo que se escreveu: um booleano fica booleano, um número inteiro
    // fica inteiro, e um decimal fica TEXTO — porque é assim que o sistema o lê (D4, e o conferidor exige-o).
    const atual = (() => {
      if (!ficha) return undefined;
      const alvo = caminhoDaFicha(ficha);
      return "recusa" in alvo ? undefined : valorEm(lerFicha(alvo.caminho).cru, chave);
    })();
    mudancas[chave] = valor === "true" || valor === "false" ? valor === "true"
      : typeof atual === "number" ? Number(valor)
      : valor;
  }
  if (!ficha || Object.keys(mudancas).length === 0) {
    console.error("uso: bun run tools/escrever-ficha/escrever-ficha.ts --ficha <caminho> --mudar chave=valor [--mudar …] [--simular] [--visto <sha256>]");
    process.exit(2);
  }
  const r = escrever(ficha, mudancas, { visto, simular, origem: "linha de comando" });
  if (r.diferencas) {
    console.log(`${simular ? "SIMULAÇÃO" : "MUDANÇA"} em ${ficha}`);
    for (const d of r.diferencas) console.log(`  ${d.chave}: ${JSON.stringify(d.de)} -> ${JSON.stringify(d.para)}`);
  }
  if (r.veredicto) {
    console.log(`  conferidor: ${r.veredicto.correu ? `código ${r.veredicto.codigo}` : "não correu"}`);
    console.log(r.veredicto.saida.split("\n").map((l) => `    ${l}`).join("\n"));
  }
  console.log(r.ok ? (r.escrito ? "  escrito (e registado)" : "  validado: nada foi escrito (simulação)") : `  RECUSADO: ${r.porque}`);
  process.exit(r.ok ? 0 : 1);
}
