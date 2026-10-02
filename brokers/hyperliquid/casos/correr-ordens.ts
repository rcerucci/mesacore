// Corre os casos da TRADUCAO DE ORDENS e do CLOID — em DADO, sem rede e sem chave.
// Um caso passa, ou e divergente: nao ha "quase".
//
// O que este corredor mede, e que nao e so "devolveu ok":
//   * o motivo da recusa existe no CONJUNTO FECHADO do contrato (contracts/vocabulario.json) — um motivo
//     inventado no codigo nao passa (a comparacao e contra a fonte, nao contra um literal escrito aqui);
//   * o `cloid` sai na forma do venue (0x + 32 hexadecimais);
//   * o `tif` e do conjunto fechado do venue (Alo, Ioc);
//   * o preco devolvido e, caracter a caracter, o que entrou — prova de que NADA foi ajustado em silencio;
//   * a referencia de cliente NAO aparece crua na accao do venue;
//   * duas chamadas com a mesma boleta dao a MESMA accao (prova de que nao ha relogio nem aleatoriedade dentro);
//   * o `cloid` e o MESMO para a mesma referencia (idempotencia do reenvio) e DIFERENTE para outra.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { traduzirOrdem, TIFS_DO_VENUE, type Pedido } from "../ordens.ts";
import { derivarCloid, DERIVACAO_DO_CLOID, FORMA_DO_CLOID } from "../cloid.ts";
import { versaoVigente } from "../../../contracts/esqueleto/framing.ts";
import { entradas, itens } from "./blocos.ts";

/** As repeticoes por omissao da checagem de cloid (mesma referencia, mesmo cloid) — o caso pode declarar outras. */
const REPETICOES_POR_OMISSAO = 2;

const RAIZ = join(import.meta.dir, "..", "..", "..");
const ficheiro = process.argv[2] ?? join(import.meta.dir, "ordens.casos.json");

function lerJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

const casos = lerJson(ficheiro);
// A VERSAO DO CONTRATO NAO SE ESCREVE NO FICHEIRO DE CASOS: LE-SE de `contracts/versao.json` e entra no
// manifesto base AQUI. Escrita a mao (era `"versao": "1.3.0"`), envelheceria em silencio na emenda seguinte
// — e um manifesto que declara a versao errada e um manifesto que a mesa recusa.
casos.manifesto_base.versao = versaoVigente();
const vocabulario = lerJson(join(RAIZ, "contracts", "vocabulario.json"));

const PADRAO_DECIMAL_POSITIVO = /^(0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(\.[0-9]+)?)$/;

/** Funde um caso sobre a base, devolvendo SEMPRE objecto novo (nunca se altera o dado partilhado). */
function fundir(base: any, mudanca: any): any {
  const saida = base === undefined || base === null ? {} : { ...base };
  for (const [k, v] of entradas(mudanca, "fundir/mudanca")) saida[k] = v;
  return saida;
}

function porCaminho(obj: any, caminho: string): unknown {
  return caminho.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

/** Apaga um caminho pontuado — para o caso que mede a AUSENCIA de um campo (nunca um valor neutro). */
function apagar(obj: any, caminho: string): void {
  const partes = caminho.split(".");
  let alvo = obj;
  for (const k of partes.slice(0, -1)) {
    if (alvo?.[k] === undefined || alvo[k] === null) return;
    alvo = alvo[k];
  }
  const ultimo = partes[partes.length - 1];
  if (alvo !== undefined && alvo !== null && ultimo !== undefined) delete alvo[ultimo];
}

function pedidoDoCaso(c: any): Pedido {
  const pedido: any = {
    conta: c.conta !== undefined ? c.conta : casos.conta_de_teste,
    boleta: fundir(casos.boleta_base, c.boleta),
    manifesto: fundir(casos.manifesto_base, c.manifesto),
    saldo: c.saldo !== undefined ? c.saldo : casos.pedido_base?.saldo,
    preco: c.preco !== undefined ? c.preco : casos.pedido_base?.preco,
  };
  // A VIRADA (1.10.0): a POSICAO VIVA entra no pedido como o saldo e o preco — e' do VENUE, e o caso declara-a.
  // Sem ela, quem recusa e' a traducao (`reversao_sem_posicao_a_reverter`), que e' o caso 2 daqui.
  if (c.posicao_a_reverter !== undefined) pedido.posicao_a_reverter = c.posicao_a_reverter;
  if (c.lado_da_posicao !== undefined) pedido.lado_da_posicao = c.lado_da_posicao;
  for (const caminho of itens(c.sem, "sem") as string[]) apagar(pedido, caminho);
  return pedido as Pedido;
}

/** O motivo existe no conjunto fechado do CONTRATO? (a fonte e o ficheiro, nao um literal daqui) */
function motivoValido(motivo: string): boolean {
  return Object.prototype.hasOwnProperty.call(vocabulario.motivos, motivo);
}

let total = 0;
let ok = 0;
let divergentes = 0;

function registar(caso: string, esperadoOk: boolean, problemas: string[]): void {
  total++;
  const linha = {
    caso,
    implementacao: "hyperliquid",
    veredicto: problemas.length === 0 ? "ok" : "divergente",
    esperado_ok: esperadoOk,
    ...(problemas.length ? { problemas } : {}),
  };
  console.log(JSON.stringify(linha));
  if (problemas.length === 0) ok++;
  else divergentes++;
}

// ---- as traducoes ---------------------------------------------------------------------------------------------
for (const c of casos.casos) {
  const pedido = pedidoDoCaso(c);
  const r = traduzirOrdem(pedido);
  const problemas: string[] = [];

  if (r.ok !== !!c.esperadoOk) {
    problemas.push(`ok=${r.ok}, esperado=${!!c.esperadoOk}${r.ok ? "" : " (" + r.motivo + ": " + r.porque + ")"}`);
  } else if (!r.ok) {
    if (c.motivo_esperado && r.motivo !== c.motivo_esperado) {
      problemas.push(`motivo=${r.motivo}, esperado=${c.motivo_esperado}`);
    }
    if (!motivoValido(r.motivo)) {
      problemas.push(`motivo ${r.motivo} nao existe no conjunto fechado do contrato`);
    }
  } else {
    const a = r.accao as any;
    if (!FORMA_DO_CLOID.test(String(a.cloid))) problemas.push(`o cloid saiu fora da forma do venue: ${a.cloid}`);
    if (!(TIFS_DO_VENUE as readonly string[]).includes(String(a.tif))) {
      problemas.push(`o tif ${JSON.stringify(a.tif)} nao e do conjunto fechado do venue (${TIFS_DO_VENUE.join(", ")})`);
    }
    for (const campo of ["quantidade", "nocional", "preco"] as const) {
      if (!PADRAO_DECIMAL_POSITIVO.test(String(a[campo]))) {
        problemas.push(`${campo}=${JSON.stringify(a[campo])} nao e decimal textual positivo do contrato`);
      }
    }
    // NADA se ajusta em silencio. No `limite` o preco devolvido e', caracter a caracter, o que entrou
    // (FR-009 — o preco e' o ponto da ordem). No `mercado` o venue nao tem ordem de mercado nativa: sai um
    // Ioc com um preco que CRUZA, derivado do `desvio_maximo` DECLARADO na boleta e da referencia RELIDA do
    // venue — e aqui prova-se que ele ficou POR DENTRO da banda e do lado agressivo, e nunca fora dela.
    if (a.tipo === "limite") {
      if (a.preco !== pedido.preco) {
        problemas.push(`o preco de uma ordem de LIMITE foi ajustado em silencio: entrou ${JSON.stringify(pedido.preco)} e saiu ${JSON.stringify(a.preco)}`);
      }
    } else {
      if (a.preco_de_referencia !== pedido.preco) {
        problemas.push(`a referencia declarada na accao (${JSON.stringify(a.preco_de_referencia)}) nao e' o preco relido do venue (${JSON.stringify(pedido.preco)})`);
      }
      if (a.desvio_maximo !== pedido.boleta?.desvio_maximo) {
        problemas.push(`o desvio declarado na accao (${JSON.stringify(a.desvio_maximo)}) nao e' o da boleta (${JSON.stringify(pedido.boleta?.desvio_maximo)})`);
      }
      const desvioDeclarado = pedido.boleta?.desvio_maximo;
      if (typeof desvioDeclarado !== "string" || desvioDeclarado === "") {
        throw new Error("a boleta do caso nao declara `desvio_maximo`: e o numero que a conferencia da banda compara, e sem ele nao ha banda a conferir");
      }
      const desvio = desvioDeclarado;
      const escala = (s: string) => { const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };
      const valor = (s: string) => { const i = s.indexOf("."); return BigInt(i < 0 ? s : s.slice(0, i) + s.slice(i + 1)); };
      const eP = escala(String(a.preco)), eR = escala(String(a.preco_de_referencia)), eD = escala(desvio);
      const precoE = valor(String(a.preco)), refE = valor(String(a.preco_de_referencia));
      // limite superior da banda (compra) / inferior (venda), tambem em inteiros escalados
      const alvoE = refE * (100n * 10n ** BigInt(eD) + (a.lado === "buy" ? 1n : -1n) * valor(desvio));
      const alvoDen = 100n * 10n ** BigInt(eD) * 10n ** BigInt(eR);
      const comparar = (x: bigint, ex: number, y: bigint, ey: number) => {
        const n = ex > ey ? ex : ey;
        return (x * 10n ** BigInt(n - ex)) - (y * 10n ** BigInt(n - ey));
      };
      const dentroDaBanda = a.lado === "buy"
        ? precoE * alvoDen <= alvoE * 10n ** BigInt(eP)
        : precoE * alvoDen >= alvoE * 10n ** BigInt(eP);
      if (!dentroDaBanda) {
        problemas.push(`o preco do Ioc de mercado saiu FORA da banda declarada (${desvio}% sobre ${a.preco_de_referencia}): saiu ${a.preco}`);
      }
      const agressivo = a.lado === "buy"
        ? comparar(precoE, eP, refE, eR) > 0n
        : comparar(precoE, eP, refE, eR) < 0n;
      if (!agressivo) {
        problemas.push(`o Ioc de mercado saiu com preco ${a.preco}, que nao e' do lado agressivo da referencia ${a.preco_de_referencia} — nao cruzaria`);
      }
    }
    // A referencia de cliente NAO vai crua para o venue (FR-011): a accao leva o cloid, nao a referencia.
    if (Object.values(a).includes(pedido.boleta?.referencia_do_cliente)) {
      problemas.push("a referencia_do_cliente aparece CRUA na accao do venue");
    }
    // Determinismo: a mesma boleta da a MESMA accao (nao ha instante nem aleatoriedade escondidos).
    const segunda = traduzirOrdem(pedidoDoCaso(c));
    if (!segunda.ok || JSON.stringify(segunda.accao) !== JSON.stringify(a)) {
      problemas.push("duas chamadas com a mesma boleta deram accoes diferentes");
    }
    for (const [caminho, esperado] of entradas(c.conferir, "conferir")) {
      const veio = porCaminho(a, caminho as string);
      if (veio !== esperado) problemas.push(`${caminho}=${JSON.stringify(veio)}, esperado=${JSON.stringify(esperado)}`);
    }
  }

  registar(c.caso, !!c.esperadoOk, problemas);
}

// ---- o cloid: a mesma referencia da sempre o mesmo; outra referencia (ou outro instrumento) da outro -----------
for (const ch of itens(casos.checagens_de_cloid, "checagens_de_cloid") as any[]) {
  const problemas: string[] = [];
  const conta = ch.conta !== undefined ? ch.conta : casos.conta_de_teste;
  const repeticoes = ch.repeticoes === undefined ? REPETICOES_POR_OMISSAO : ch.repeticoes;
  const cloids: string[] = [];
  for (let i = 0; i < repeticoes; i++) {
    const r = derivarCloid(conta, ch.instrumento, ch.referencia);
    if (!r.ok) {
      problemas.push(`a derivacao recusou uma referencia valida: ${r.motivo} (${r.porque})`);
      break;
    }
    if (!FORMA_DO_CLOID.test(r.cloid)) problemas.push(`o cloid saiu fora da forma do venue: ${r.cloid}`);
    cloids.push(r.cloid);
  }
  if (new Set(cloids).size > 1) {
    problemas.push(`a MESMA referencia deu ${new Set(cloids).size} cloids diferentes: ${[...new Set(cloids)].join(", ")}`);
  }
  const outra = derivarCloid(conta, ch.outro_instrumento ?? ch.instrumento, ch.outra_referencia);
  if (!outra.ok) {
    problemas.push(`a derivacao recusou a outra referencia: ${outra.motivo}`);
  } else if (cloids[0] !== undefined && outra.cloid === cloids[0]) {
    problemas.push(`outra referencia/instrumento deu o MESMO cloid (${outra.cloid}) — a derivacao perdeu um dos tres argumentos`);
  }
  registar(ch.caso, true, problemas);
}

// ---- o cloid recusa o que tem forma invalida (fail-closed) -----------------------------------------------------
for (const ch of itens(casos.checagens_de_recusa_do_cloid, "checagens_de_recusa_do_cloid") as any[]) {
  const problemas: string[] = [];
  const conta = ch.conta !== undefined ? ch.conta : casos.conta_de_teste;
  const r = derivarCloid(conta, ch.instrumento, ch.referencia);
  if (r.ok) {
    problemas.push(`esperava recusa e devolveu o cloid ${r.cloid}`);
  } else {
    if (ch.motivo_esperado && r.motivo !== ch.motivo_esperado) problemas.push(`motivo=${r.motivo}, esperado=${ch.motivo_esperado}`);
    if (!motivoValido(r.motivo)) problemas.push(`motivo ${r.motivo} nao existe no conjunto fechado do contrato`);
  }
  registar(ch.caso, false, problemas);
}

console.error(`cloid: derivacao declarada = ${DERIVACAO_DO_CLOID}`);
console.error(`ordens: ${total} casos · ${ok} ok · ${divergentes} divergentes · ${casos.casos.length} traducoes declaradas`);
process.exit(divergentes === 0 ? 0 : 1);
