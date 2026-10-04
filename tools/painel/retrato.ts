#!/usr/bin/env bun
// O RETRATO — o fio entre o SISTEMA e a TELA.
//
// ISTO E' UM LEITOR, e e' so' isso. Le o que CADA corrida ja' escreveu (a operacao, o registo, o log do operador,
// as fichas do dono), pergunta a cada SETUP a sua propria serie para desenhar, e junta tudo num ficheiro — o
// `painel.json` — que a tela consome.
//
// E' UM LEITOR DE N INSTALACOES, e isso e' a diferenca entre "o painel do sigma" e "o painel do SISTEMA": uma
// INSTALACAO e' uma corrida (uma conta, um setup, os seus pares). Quem acrescenta a segunda instalacao nao toca
// aqui — passa mais um `--corrida` (ou deixa a descoberta encontra-la viva). A tela nunca muda de forma por haver
// uma ou cinco.
//
// O QUE ELE NAO FAZ, e' a razao de ele existir assim:
//   * NAO decide nada, NAO escreve na operacao, NAO toca em ficha nenhuma. Se estiver parado, a mesa opera igual;
//   * NAO recalcula o que a mesa sabe (RN-E9): bid, ask, equity, posicao, ordens vivas e decisoes SAO os
//     ficheiros do sistema, copiados com o nome do campo que la' esta'. Nao ha uma segunda conta do preco;
//   * NAO conhece o nome de setup nenhum. A serie da sobreposicao sai do COMANDO QUE O PROPRIO SETUP DECLARA no
//     seu `setup.json` (`sobreposicao`), corrido com o instrumento, o relogio e as constantes da FICHA. Um setup
//     novo entra no painel sem se tocar aqui — e' essa a diferenca entre um painel de um setup e um multiplugin;
//   * NAO esconde o que falta. O que nao se conseguiu ler sai como FALTA NOMEADA, com o porque — nunca como zero,
//     nunca como vazio silencioso (RN-D4 pela ponta da tela).
//
// Uso:
//   bun run tools/painel/retrato.ts                              # descobre as instalacoes vivas
//   bun run tools/painel/retrato.ts --corrida <dir> --corrida <dir2>
//   bun run tools/painel/retrato.ts --raiz-das-corridas <dir>     # onde procurar
//   bun run tools/painel/retrato.ts --para <ficheiro.json> [--sem-serie]

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, openSync, fstatSync, readSync, closeSync, statSync } from "node:fs";
import { join, dirname, isAbsolute, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buracosDeHistorico } from "./buracos.ts";
// O QUE TRAVA UM PAR — a NATUREZA do motivo (espera x atencao) decide a palavra «travado» (ver `travado.ts`, e a
// medicao de 04/10/2026 que o obrigou: o par que operava aparecia travado).
import { oQueTrava } from "./travado.ts";
// A POSICAO E A ORDEM QUE A ABRIU — a marca de posse ligada ao desfecho (ver `desfechos.ts`).
import { marcadorDosDesfechos, ordemDaPosicao } from "./desfechos.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const argv = process.argv.slice(2);
const argumento = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
};
/** TODOS os valores de um argumento repetivel (`--corrida a --corrida b` -> `[a, b]`). */
const todosOsArgumentos = (nome: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === nome && argv[i + 1] !== undefined) out.push(argv[i + 1]!);
  return out;
};

// ---------------------------------------------------------------- AS INSTALACOES (N corridas)

/**
 * DE QUE CORRIDA E' A TELA — a pergunta que hoje nao se sabia responder.
 *
 * Uma INSTALACAO = uma corrida = uma pasta com a sua `operacao.json`. Ha' duas maneiras de as escolher:
 *
 *   * EXPLICITA (`--corrida <dir>`, repetivel) — quando se sabe o que se quer olhar;
 *   * DESCOBERTA (por omissao) — as corridas VIVAS sob a raiz: as que teem a `operacao.json` reescrita ha' menos
 *     de `--idade-viva-ms` (por omissao 5 min). O operador escreve a operacao a cada tique; um ficheiro fresco e'
 *     a prova honesta de que aquela corrida esta' a acontecer. Sem nenhuma viva, cai na MAIS RECENTE — e a tela
 *     diz que foi esse o criterio (nunca uma escolha muda).
 *
 * A razao de isto existir: a unit servia a corrida de ontem por omissao fixa, e a tela nao tinha como saber.
 */
const RAIZ_DAS_CORRIDAS =
  argumento("--raiz-das-corridas") ?? join(process.env["HOME"] ?? "", ".hermes", "profiles", "appbuilder", "cache", "scratch");
const IDADE_VIVA_MS = Number(argumento("--idade-viva-ms") ?? 300000);

function idadeDoFicheiroMs(caminho: string): number | null {
  try { return Date.now() - statSync(caminho).mtimeMs; } catch { return null; }
}
/** O INSTANTE em que o ficheiro foi escrito — e' o que a tela mostra como "ha' quanto tempo a operacao foi lida". */
function mtimeMs(caminho: string): number | null {
  try { return statSync(caminho).mtimeMs; } catch { return null; }
}
/**
 * UMA INSTALACAO DECLARA-SE. Uma pasta com `operacao.json` pode ser uma instalação — ou o CORREDOR DE BANCADA de
 * um portão. O que distingue as duas: a instalação publica a SUA CONFIGURAÇÃO ao lado da operação
 * (`operacao.json.config.json`), e o fixture do portão (`tools/verificar-maquina/vigia.ts`) escreve só
 * `operacao.json` — a config dele chama-se `config.json` e vive no mesmo sítio por outro nome.
 *
 * MEDIDO a 03/10/2026, e foi este o defeito: o `provar.sh` corre o `vigia.ts`, que cria um corredor em
 * `mkdtemp($TMPDIR/vigia-orfandade-…)`, e nesta máquina o `TMPDIR` É a própria raiz das corridas. A tela mostrou
 * por segundos uma «instalação» chamada `vigia-orfandade-wInDt8` (equity `—`, 1 par, parada) — um duble, servido
 * como se fosse uma corrida do dono.
 *
 * O critério é o da DECLARAÇÃO, não o do nome: qualquer pasta com a operação E a configuração entra, ainda que se
 * chame `vigia-…`; e qualquer pasta sem a configuração fica de fora, ainda que tenha bom nome. As ignoradas são
 * CONTADAS e ditas no critério da tela (uma exclusão silenciosa seria a mesma mentira, ao contrário).
 */
function corridasComOperacao(): { aceitas: string[]; ignoradas: string[] } {
  if (!existsSync(RAIZ_DAS_CORRIDAS)) return { aceitas: [], ignoradas: [] };
  const aceitas: string[] = [];
  const ignoradas: string[] = [];
  for (const nome of readdirSync(RAIZ_DAS_CORRIDAS)) {
    const d = join(RAIZ_DAS_CORRIDAS, nome);
    try {
      if (!statSync(d).isDirectory() || !existsSync(join(d, "operacao.json"))) continue;
    } catch { continue; /* nao e' pasta: ignora */ }
    if (existsSync(join(d, "operacao.json.config.json"))) aceitas.push(d);
    else ignoradas.push(d);
  }
  return { aceitas, ignoradas };
}
function escolherAsCorridas(): { corridas: string[]; descoberta: string } {
  const explicitas = todosOsArgumentos("--corrida");
  if (explicitas.length > 0) {
    return { corridas: explicitas.map((c) => (isAbsolute(c) ? c : join(RAIZ, c))), descoberta: "explicita (--corrida)" };
  }
  const { aceitas: todas, ignoradas } = corridasComOperacao();
  // O QUE FICOU DE FORA VAI DITO: um corredor de bancada ignorado não desaparece do ecrã — aparece como critério.
  const notaDasIgnoradas = ignoradas.length > 0
    ? ` · ${ignoradas.length} corredor(es) de bancada ignorado(s): sem operacao.json.config.json (${ignoradas.map((d) => d.split("/").pop()).slice(0, 3).join(", ")})`
    : "";
  if (todas.length === 0) return { corridas: [], descoberta: `nenhuma corrida com operacao.json sob ${RAIZ_DAS_CORRIDAS}${notaDasIgnoradas}` };
  const vivas = todas.filter((d) => {
    const i = idadeDoFicheiroMs(join(d, "operacao.json"));
    return i !== null && i <= IDADE_VIVA_MS;
  });
  if (vivas.length > 0) {
    return { corridas: vivas.sort(), descoberta: `descobertas vivas: operacao.json escrito ha' <= ${Math.round(IDADE_VIVA_MS / 1000)} s${notaDasIgnoradas}` };
  }
  todas.sort((a, b) => (idadeDoFicheiroMs(join(a, "operacao.json")) ?? Infinity) - (idadeDoFicheiroMs(join(b, "operacao.json")) ?? Infinity));
  return { corridas: [todas[0]!], descoberta: `nenhuma viva: a mais recente${notaDasIgnoradas}` };
}

const { corridas: CORRIDAS, descoberta: DESCOBERTA_DAS_CORRIDAS } = escolherAsCorridas();
const CONTA = argumento("--conta") ?? null;
const PARA = argumento("--para") ?? join(RAIZ, "web", "painel", "painel.json");
/**
 * O MODO LEVE: o retrato SEM a série (e sem as velas).
 *
 * A SÉRIE é o que PESA (o fio tem 2,7 MB, e 1,67 MB são só as séries) e o que CUSTA (o setup corre uma vez por
 * par — medido: 0,43 s por retrato). E é também o que muda por BARRA, não a cada segundo. Com `--sem-serie` o
 * retrato fica com o «agora» (leitura, posição, proposta, decisão, risco, faltas) e sai em unidades de KB — o que
 * permite renová-lo a cada segundo sem arrastar o gráfico: quem o desenha é o retrato completo, no relógio dele.
 */
const SEM_SERIE = argv.includes("--sem-serie");

/** O que nao se conseguiu ler vai dito, com o nome e o porque — a lista viaja no fio e a tela mostra-a. */
const falhasDoRetrato: { o_que: string; porque: string }[] = [];
const falta = (o_que: string, porque: string) => falhasDoRetrato.push({ o_que, porque });

// ---------------------------------------------------------------- as fontes cruas

function lerJsonl(caminho: string): any[] {
  if (!existsSync(caminho)) return [];
  const linhas: any[] = [];
  for (const l of readFileSync(caminho, "utf8").split("\n")) {
    if (l.trim() === "") continue;
    try {
      linhas.push(JSON.parse(l));
    } catch {
      // Uma linha truncada a meio (o processo morreu a escrever) nao contamina as outras: e' uma linha perdida,
      // e diz-se. E' por isto que o formato do ledger e' uma linha por facto.
      falta(`linha ilegivel em ${caminho.split("/").pop()}`, "nao e' JSON: linha truncada ou escrita a meio");
    }
  }
  return linhas;
}

/**
 * O LOG DO OPERADOR É UM LOG MISTO — por desenho, não por acidente. As linhas do próprio operador são JSON (cada
 * uma com `etapa`); o CONECTOR fala em PROSA pelo `stderr`, e o operador reemite-a INTACTA para não ficar cego ao
 * diagnóstico dele (D-019). Uma linha de prosa não é um defeito de leitura: é a outra metade do log.
 *
 * Aqui separa-se o que TEM CARA de JSON partido (começa por `{` e falha o parse — um truncamento a sério) do que
 * é prosa (o diagnóstico do conector, e o marcador `[<data>] fim` que o lançador escreve ao fechar). Medido a
 * 03/10/2026: a prosa do conector e aquele marcador apareciam como «linha ilegível: truncada», e a tela dizia um
 * defeito que não existia. O eco do operador só PARTE linhas a sério se faltar o buffer — e o buffer está onde
 * tem de estar (`vigia/operador.ts`, `linhasInteiras`).
 */
function lerLogDoOperador(caminho: string): any[] {
  if (!existsSync(caminho)) return [];
  const linhas: any[] = [];
  for (const l of readFileSync(caminho, "utf8").split("\n")) {
    if (l.trim() === "") continue;
    try {
      linhas.push(JSON.parse(l));
    } catch {
      // Só se reporta o que COMEÇA por `{`: é a forma das linhas do operador, logo um `{` que não fecha é uma
      // truncagem a sério. O `[<data>] fim` do lançador é prosa (e um par de parênteses rectos não é um array).
      if (l.trimStart().startsWith("{")) {
        falta(`linha ilegivel em ${caminho.split("/").pop()}`, "nao e' JSON: linha truncada ou escrita a meio");
      }
    }
  }
  return linhas;
}

/** Os desfechos e as marcas de posse, um ficheiro por conta — como o sistema os escreve, ao lado da operacao. */
function ficheirosDe(dirCorrida: string, prefixo: string): string[] {
  if (!existsSync(dirCorrida)) return [];
  return readdirSync(dirCorrida).filter((n) => n.startsWith(prefixo) && n.endsWith(".jsonl"));
}

/** O MAPA DAS MARCAS da corrida — lê os `desfechos-<conta>.jsonl` e entrega as linhas ao módulo puro
 *  (`desfechos.ts`), onde a regra vive e se prova. Aqui só se lê o ficheiro. */
function mapaDasMarcas(dirCorrida: string): Map<number, any> {
  return marcadorDosDesfechos(ficheirosDe(dirCorrida, "desfechos-").map((n) => lerJsonl(join(dirCorrida, n))));
}

// ---------------------------------------------------------------- as fichas do dono e os manifestos dos setups

interface Ficha {
  caminho: string;
  cabecalho: Record<string, any>;
  constantes: Record<string, any>;
}
const fichas: Ficha[] = [];
for (const pasta of existsSync(join(RAIZ, "fichas")) ? readdirSync(join(RAIZ, "fichas")) : []) {
  const dir = join(RAIZ, "fichas", pasta);
  let nomes: string[] = [];
  try {
    nomes = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    continue;
  }
  for (const nome of nomes) {
    try {
      const f = JSON.parse(readFileSync(join(dir, nome), "utf8")) as Ficha;
      f.caminho = `fichas/${pasta}/${nome}`;
      fichas.push(f);
    } catch (e) {
      falta(`ficha ${pasta}/${nome}`, `ilegivel (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

interface Manifesto {
  nome: string;
  versao: string;
  linguagem: string;
  comando: string[];
  sobreposicao?: string[];
  template: Record<string, any>;
  pasta: string;
}
const manifestos = new Map<string, Manifesto>();
for (const pasta of existsSync(join(RAIZ, "setups")) ? readdirSync(join(RAIZ, "setups")) : []) {
  const caminho = join(RAIZ, "setups", pasta, "setup.json");
  if (!existsSync(caminho)) continue;
  try {
    const m = JSON.parse(readFileSync(caminho, "utf8")) as Manifesto;
    m.pasta = `setups/${pasta}`;
    manifestos.set(m.nome, m);
  } catch (e) {
    falta(`manifesto setups/${pasta}/setup.json`, `ilegivel (${e instanceof Error ? e.message : String(e)})`);
  }
}

// ---------------------------------------------------------------- a sobreposicao, pedida AO SETUP

/**
 * A serie da sobreposicao vem do setup, nunca daqui.
 *
 * O comando e' o que o setup DECLARA (`setup.json` -> `sobreposicao`). O ambiente e' o MESMO que o plugin recebe
 * em operacao (as constantes da ficha, o instrumento, o relogio, a pasta do mercado), para nao haver duas
 * maneiras de dizer a mesma coisa — e para o grafico ser, por construcao, o mesmo indicador que decidiu.
 *
 * A FALHA E' UM RESULTADO, nao um erro: sem sobreposicao declarada, a tela diz "este setup nao publica serie" e
 * desenha as velas. Inventar aqui uma media seria a segunda implementacao que RN-E9 proibe.
 */
async function pedirSobreposicao(
  manifesto: Manifesto,
  instrumento: string,
  relogio: string,
  constantes: Record<string, any>,
  pastaDoMercado: string,
  agoraMs: number | null,
): Promise<{ serie: any[] | null; em_curso: any | null; janela: any | null; porque: string | null }> {
  if (manifesto.sobreposicao === undefined || !Array.isArray(manifesto.sobreposicao) || manifesto.sobreposicao.length === 0) {
    return { serie: null, em_curso: null, janela: null, porque: `o setup ${manifesto.nome} nao declara \`sobreposicao\` no seu setup.json: nao ha serie para desenhar` };
  }
  const cmd = manifesto.sobreposicao.map((p) => p.replace(/^\.\//, ""));
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    INSTRUMENTO: instrumento,
    RELOGIO: relogio,
    CONSTANTES: JSON.stringify(constantes),
    PASTA_DE_MERCADO: pastaDoMercado,
  };
  if (agoraMs !== null) env["AGORA_MS"] = String(agoraMs);
  const p = Bun.spawnSync(cmd, { cwd: join(RAIZ, manifesto.pasta), env });
  if (p.exitCode !== 0) {
    const queixa = p.stderr.toString().trim().split("\n").pop() ?? "";
    return { serie: null, em_curso: null, janela: null, porque: `a sobreposicao de ${manifesto.nome} recusou (codigo ${p.exitCode}): ${queixa.slice(0, 300)}` };
  }
  try {
    const d = JSON.parse(p.stdout.toString());
    return { serie: d.serie ?? null, em_curso: d.em_curso ?? null, janela: d.janela ?? null, porque: null };
  } catch (e) {
    return { serie: null, em_curso: null, janela: null, porque: `a sobreposicao de ${manifesto.nome} nao devolveu JSON legivel (${e instanceof Error ? e.message : String(e)})` };
  }
}

/**
 * A ULTIMA VELA — e só ela. É o que faz o gráfico respirar no ciclo leve.
 *
 * O ficheiro das velas tem centenas de KB (o ETH-1m passa das 5000 barras) e o modo leve não os pode pagar: lê-se
 * o RABO do ficheiro (8 KB) e fica-se com a última linha. Medido: 0,07 ms por leitura, contra 661 KB lidos
 * inteiros. É o suficiente para a barra EM CURSO — a tela já tem as outras desenhadas e só precisa de actualizar a
 * última (`series.update` é o caminho leve do lightweight-charts: não repinta 500 velas para mexer numa).
 */
function ultimaVela(instrumento: string, relogio: string, pasta: string): any | null {
  const caminho = join(pasta, `velas-${instrumento}-${relogio}.jsonl`);
  if (!existsSync(caminho)) return null;
  const fd = openSync(caminho, "r");
  try {
    const tamanho = fstatSync(fd).size;
    const inicio = Math.max(0, tamanho - 8192);
    const buf = Buffer.alloc(tamanho - inicio);
    readSync(fd, buf, 0, buf.length, inicio);
    const linhas = buf.toString("utf8").split("\n").filter((l) => l.trim().length > 0);
    const ultima = linhas[linhas.length - 1];
    if (ultima === undefined) return null;
    try {
      return JSON.parse(ultima);
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * As velas do VENUE — o ficheiro que o operador escreve a cada leitura (`velas-<PAR>-<RELOGO>.jsonl`).
 */
function lerVelas(instrumento: string, relogio: string, pasta: string): any[] | null {
  const caminho = join(pasta, `velas-${instrumento}-${relogio}.jsonl`);
  if (!existsSync(caminho)) return null;
  const velas: any[] = [];
  for (const l of readFileSync(caminho, "utf8").split("\n")) {
    if (l.trim() === "") continue;
    try {
      velas.push(JSON.parse(l));
    } catch {
      falta(`vela ilegivel em velas-${instrumento}-${relogio}.jsonl`, "linha truncada: as velas seguintes continuam a valer");
    }
  }
  return velas;
}

/**
 * CRUZAR AS DUAS PONTAS — por TEMPO, nunca por indice.
 *
 * As velas sao do venue; a serie e' do setup. A janela fechada e' declarada PELO SETUP (`janela.fechadas`), que
 * e' o dono da regra "a barra que ainda esta' a formar nao conta": o leitor limita-se a recortar as velas por
 * essa janela. Uma vela sem ponto da serie (ou ao contrario) NAO se esconde: e' uma falta nomeada, e a tela
 * mostra-a. Ja' se desenharam marcas no lado errado por cruzar dois ficheiros por indice.
 */
function cruzar(velas: any[], serie: any[], janela: any) {
  const janelaDe = janela?.fechadas === 0 || janela?.primeira_fechada === undefined
    ? null
    : { de: janela.primeira_fechada, ate: janela.ultima_fechada };
  const escolhidas = janelaDe === null ? [] : velas.filter((v) => v.t >= janelaDe.de && v.t <= janelaDe.ate);
  const pontoPorTempo = new Map<number, any>(serie.map((p) => [p.t, p]));
  const desenhos: any[] = [];
  const semPonto: number[] = [];
  for (const v of escolhidas) {
    const p = pontoPorTempo.get(v.t);
    if (p === undefined) {
      semPonto.push(v.t);
      continue;
    }
    // Os numeros da vela saem em TEXTO, como o venue os publica (D4): quem desenha converte, e o fio nao perde
    // precisao a arredondar dinheiro no caminho.
    desenhos.push({ t: v.t, o: v.o, h: v.h, l: v.l, c: v.c, v: v.v ?? null, ...p });
  }
  const tempoDasVelas = new Set(escolhidas.map((v) => v.t));
  const semVela = serie.filter((p) => !tempoDasVelas.has(p.t)).map((p) => p.t);
  return {
    velas: desenhos.map((d) => ({ t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v })),
    serie: desenhos.map((d) => ({ t: d.t, mid: d.mid, ma: d.ma, atr: d.atr, banda: d.banda, sig: d.sig, extremo: d.extremo, virada: d.virada })),
    janela: janelaDe,
    faltas_do_cruzamento: { velas_sem_ponto_da_serie: semPonto, pontos_sem_vela: semVela },
  };
}

// ---------------------------------------------------------------- o que o setup DISSE na ultima volta

/**
 * AS PALAVRAS DO PROPRIO SETUP, na ultima volta do operador (`setup_falou`, que traz os `diagnostico` do stderr).
 *
 * SAO DUAS COISAS, e separa-las foi uma correccao medida: o setup escreve (a) uma MEDICAO — `ma`, `atr`, `mid`,
 * `sig`, `virada`, com numeros — e (b) um VEREDICTO — "plano, e a barra ... nao virou", que muitas vezes NAO traz
 * numero nenhum. A ultima linha do log costuma ser o veredicto (o diagnostico veio antes, na mesma volta ou
 * noutra), e ler os numeros da ultima linha dava `sig=null` com o setup a ter dito o lado em palavras. Pior: o
 * numero de uma volta antiga apresentado como "agora" e' uma medicao fora de prazo.
 *
 * Por isso o fio leva as duas, cada uma DATADA com a volta em que foi dita — e a tela mostra a volta ao lado do
 * numero. Nada aqui e' deduzido: e' o texto do dono do indicador.
 */
function oQueOSetupDisse(logDoOperador: any[], instrumento: string) {
  const minhas = logDoOperador.filter(
    (l) => l.instrumento === instrumento && l.etapa === "operador" && typeof l.setup_falou === "string",
  );
  const ultima = minhas[minhas.length - 1];
  if (ultima === undefined) return { veredicto: null, medicao: null };

  const comNumeros = [...minhas].reverse().find((l) => /sig=-?\d/.test(l.setup_falou));
  const num = (texto: string, re: RegExp) => {
    const m = re.exec(texto);
    return m === null ? null : Number(m[1]);
  };
  return {
    veredicto: {
      volta: ultima.volta ?? null,
      texto: ultima.setup_falou.replace(/\s+/g, " ").slice(0, 400),
      lado_da_proposta: ultima.lado_da_proposta ?? null,
      proposta_do_setup: ultima.proposta_do_setup === true,
    },
    medicao: comNumeros === undefined ? null : {
      volta: comNumeros.volta ?? null,
      sig: num(comNumeros.setup_falou, /sig=(-?\d+)/),
      virada: num(comNumeros.setup_falou, /virada=(-?\d+)/),
      ma: num(comNumeros.setup_falou, /ma=(-?[\d.]+)/),
      atr: num(comNumeros.setup_falou, /atr=(-?[\d.]+)/),
      mid: num(comNumeros.setup_falou, /mid=(-?[\d.]+)/),
    },
  };
}

/**
 * PORQUE E' QUE A MESA NAO FAZ NADA — a resposta a "um sistema em observacao que nao faz nada tem de dizer qual
 * motivo o trava".
 *
 * A decisao da mesa escreve uma linha por ciclo (`acao` + `motivo`). O que interessa a quem abre a tela nao e' a
 * contagem de 885 linhas de `proposta_sem_lado_a_executar`: e' o VERBO que trava, a sua NATUREZA (espera ou atencao)
 * e HA' QUANTO TEMPO. A regra vive em `travado.ts` — modulo puro, provado por `prova-do-travado.ts` —, e aqui so'
 * se chama.
 */

// ---------------------------------------------------------------- montar UMA instalacao (mesa)

const agora = Date.now();

/**
 * A FONTE DE UM BLOCO, com a sua data. O dono abriu o painel e viu `lido ha' 7,6 h` sem saber de QUE corrida e
 * de QUE ficheiro vinham os numeros — e um numero sem a fonte e sem a hora nao serve para decidir. Aqui cada
 * bloco passa a levar a fonte (o caminho, relativo a corrida ou ao repositorio) e a IDADE do ficheiro em `em_ms`.
 * Quando o ficheiro nao existe, a falta e' DITA (em_ms/idade_ms a null), nunca um zero silencioso.
 */
function fonteDe(caminho: string, relativo: string): { caminho: string; em_ms: number | null; idade_ms: number | null } {
  const em = mtimeMs(caminho);
  return { caminho: relativo, em_ms: em, idade_ms: em === null ? null : Date.now() - em };
}

/**
 * AS PALAVRAS DO ESTADO DA MESA. As transicoes vivem no registo (`tipo: transicao`), com o `para` e o `motivo`;
 * a ULTIMA da corrida e' o estado de agora, e a idade dele responde a "ha' quanto tempo o sistema esta' assim".
 */
function estadoDaMesaDoRegisto(registo: any[]): { estado: string; desde_ms: number | null; porque: string | null; verbo: string | null } {
  let estado = "parada";
  let desde: number | null = null;
  let porque: string | null = null;
  let verbo: string | null = null;
  for (const l of registo) {
    if (l.tipo === "transicao" && l.para) {
      estado = l.para;
      desde = l.instante_ms ?? null;
      porque = l.motivo ?? null;
      verbo = l.verbo ?? null;
    }
  }
  return { estado, desde_ms: desde, porque, verbo };
}

async function montarMesa(dirCorrida: string): Promise<any> {
  const instalacao = basename(dirCorrida);
  const nomear = (o_que: string) => `${instalacao} · ${o_que}`;

  const caminhoOperacao = join(dirCorrida, "operacao.json");
  const operacao: any = existsSync(caminhoOperacao)
    ? JSON.parse(readFileSync(caminhoOperacao, "utf8"))
    : (falta(nomear("operacao.json"), `nao existe em ${dirCorrida}: sem ela nao ha leitura, nem posicao, nem proposta`), null);
  const registo = lerJsonl(join(dirCorrida, "registo.jsonl"));
  const logDoOperador = lerLogDoOperador(join(dirCorrida, "operador.log"));

  const estado = estadoDaMesaDoRegisto(registo);
  const ciclos = registo.filter((l) => l.tipo === "ciclo");
  const mandatos = registo.filter((l) => l.tipo === "mandato");
  const contagem = (xs: any[], chave: (x: any) => string) => {
    const c: Record<string, number> = {};
    for (const x of xs) c[chave(x)] = (c[chave(x)] ?? 0) + 1;
    return c;
  };

  const instrumentosDaOperacao: Record<string, any> = operacao?.instrumentos ?? {};
  const nomesDosInstrumentos = Object.keys(instrumentosDaOperacao).sort();
  const contaDoRetrato: string | null = CONTA ?? operacao?.conta ?? fichas[0]?.cabecalho?.["conta"] ?? null;

  const instrumentos: any[] = [];
  for (const nome of nomesDosInstrumentos) {
    const v = instrumentosDaOperacao[nome]!;
    const leitura = v.leitura ?? null;
    const ficha = fichas.find((f) => f.cabecalho?.["instrumento"] === nome && (contaDoRetrato === null || f.cabecalho?.["conta"] === contaDoRetrato)) ?? null;
    const setup = ficha?.cabecalho?.["setup"] ?? null;
    const manifesto = setup !== null ? manifestos.get(setup) ?? null : null;
    const relogio = v.relogio ?? ficha?.cabecalho?.["relogio"] ?? null;
    const constantes = v.parametros ?? ficha?.constantes ?? {};
    const pastaDoMercado = existsSync(join(dirCorrida, "mercado")) ? join(dirCorrida, "mercado") : join(RAIZ, "tools", "verificar-setup", "barras");

    const sobreposicao = SEM_SERIE
      ? { serie: null, em_curso: null, janela: null, porque: null }
      : manifesto !== null && relogio !== null
        ? await pedirSobreposicao(manifesto, nome, relogio, constantes, pastaDoMercado, leitura?.tempo_do_venue_ms ?? null)
        : { serie: null, em_curso: null, janela: null, porque: `nao ha ficha nem manifesto para ${nome}: nao se sabe que serie pedir` };
    if (sobreposicao.porque !== null) falta(nomear(`sobreposicao de ${nome}`), sobreposicao.porque);

    // AS VELAS (do venue) x A SERIE (do setup): duas pontas, cruzadas por tempo. Sem serie nao ha cruzamento, e
    // as velas ficam sozinhas — o grafico desenha o mercado e di-lo: "este setup nao publica serie".
    // Em modo leve nenhuma das duas se le': a tela ja' as tem do retrato completo, e a falta nao se anuncia (nao
    // falta nada — apenas nao se pediu nada).
    const velas = SEM_SERIE || relogio === null ? null : lerVelas(nome, relogio, pastaDoMercado);
    if (velas === null && relogio !== null && !SEM_SERIE) falta(nomear(`velas de ${nome}-${relogio}`), `nao existe velas-${nome}-${relogio}.jsonl em ${pastaDoMercado}`);
    const cruzamento =
      velas !== null && sobreposicao.serie !== null
        ? cruzar(velas, sobreposicao.serie, sobreposicao.janela)
        : { velas: velas ?? [], serie: [], janela: null, faltas_do_cruzamento: { velas_sem_ponto_da_serie: [], pontos_sem_vela: [] } };
    if (cruzamento.faltas_do_cruzamento.velas_sem_ponto_da_serie.length > 0) {
      falta(
        nomear(`cruzamento de ${nome}`),
        `${cruzamento.faltas_do_cruzamento.velas_sem_ponto_da_serie.length} vela(s) do venue sem ponto na serie do setup (a janela do setup e' menor do que a das velas)`,
      );
    }

    const meusCiclos = ciclos.filter((c) => c.instrumento === nome);
    const ultimoCiclo = meusCiclos[meusCiclos.length - 1] ?? null;

    instrumentos.push({
      instrumento: nome,
      conta: ficha?.cabecalho?.["conta"] ?? null,
      // A FICHA: o que o dono manda. `run` e `enviar` sao os DOIS interruptores — e a tela so' os mostra; quem os
      // muda e' a ficha (o gesto do dono), com registo.
      ficha: ficha === null ? null : {
        caminho: ficha.caminho,
        setup,
        versao_do_setup: manifesto?.versao ?? null,
        linguagem: manifesto?.linguagem ?? null,
        relogio,
        run: ficha.cabecalho?.["run"] ?? null,
        enviar: ficha.cabecalho?.["enviar"] ?? null,
        ao_desligar: ficha.cabecalho?.["ao_desligar"] ?? null,
      },
      risco: v.risco ?? (ficha === null ? null : {
        saldo_pct: ficha.cabecalho?.["saldo_pct"] ?? null,
        alavancagem: ficha.cabecalho?.["alavancagem"] ?? null,
        bandas: ficha.cabecalho?.["bandas"] ?? null,
        prazo_de_resposta_ms: ficha.cabecalho?.["prazo_de_resposta_ms"] ?? null,
      }),
      // A CONFIGURACAO TEM DUAS CARAS, e a tela precisa das duas: o DESCRITOR vem do setup (o template — o que
      // cada item e', a que banda obedece), o VALOR vem da ficha do par. Sem o descritor a tela teria de conhecer
      // os itens por nome, e deixaria de servir o proximo setup (RN-S4).
      template: manifesto?.template ?? null,
      // OS VALORES QUE A MESA RESOLVEU (o `template` da operacao: o descritor de cada item com o valor que a
      // ficha lhe deu — relogio incluido). E' por aqui que a tela mostra a configuracao de um setup que ela NAO
      // conhece: o descritor diz o que cada item e' (tipo, opcoes, banda), o valor vem resolvido da operacao.
      valores_resolvidos: v.template ?? null,
      parametros: constantes,
      leitura,
      // A ORDEM QUE ABRIU A POSICAO — a marca de posse ligada ao desfecho que a enviou (referencia, `oid`, `cloid`,
      // preco medio). E' o que deixa comparar a tela com o UI do venue linha a linha; ver `ordemDaPosicao`.
      ordem_da_posicao: ordemDaPosicao(mapaDasMarcas(dirCorrida), leitura?.posicao),
      // O QUE SE DESENHA, em duas pontas separadas e ditadas: as VELAS (o mercado, do venue) e a SERIE (a leitura
      // do indicador, do setup). A tela desenha-as juntas e nunca as confunde: uma e' o que aconteceu, a outra e'
      // o que o motor viu.
      // AS SERIES SO' EXISTEM NO RETRATO COMPLETO (ver `SEM_SERIE`): em modo leve a tela JA' tem a serie
      // desenhada, e repetir 1,7 MB a cada dois segundos para a deitar fora seria o contrario de leve.
      // NO MODO LEVE VAI A BARRA EM CURSO (uma vela, lida do rabo do ficheiro): sem ela o gráfico ficava com a cara
      // de uma fotografia entre retratos. No retrato completo não se repete — a última vela já lá está, dentro de
      // `velas`.
      ...(SEM_SERIE
        ? { vela_em_curso: relogio !== null ? ultimaVela(nome, relogio, pastaDoMercado) : null }
        : {
            velas: cruzamento.velas,
            serie_do_setup: cruzamento.serie,
            janela: cruzamento.janela,
            // OS BURACOS: o vao REAL no historico, NOMEADO (de/ate + quantas faltam). Calcula-se sobre as velas
            // CRUAS do venue (antes do cruzamento), porque um vao e' do historico, nao da serie do setup.
            buracos: buracosDeHistorico(velas ?? []),
            em_curso: sobreposicao.em_curso,
            sobreposicao_indisponivel: sobreposicao.porque,
            faltas_do_cruzamento: cruzamento.faltas_do_cruzamento,
          }),
      o_que_o_setup_disse: oQueOSetupDisse(logDoOperador, nome),
      proposta: v.proposta ?? null,
      ultima_decisao: ultimoCiclo,
      decisao_contagem: contagem(meusCiclos, (c) => `${c.acao}:${c.motivo}`),
      // O QUE TRAVA ESTE PAR — o motivo da corrente final de ciclos `nada`, a sua NATUREZA (espera ou atenção), o
      // desde-quando e o quantos (ver `travado.ts`; a régua é a natureza do motivo, não o tempo).
      parado: oQueTrava(meusCiclos),
      // ONDE A MESA DECIDIU ABRIR — os instantes das decisoes de `abrir` deste par, lidos do registo. Vao para o
      // grafico como marca propria, e NAO se misturam com a virada do indicador: uma e' a regra a virar, a outra
      // e' a mesa a decidir — e no dia em que nao coincidirem, tem de se ver que nao coincidiram.
      decisoes_de_abrir_ms: meusCiclos.filter((c) => c.acao === "abrir").map((c) => c.instante_ms),
      marcas_nossas_conhecidas: v.marcas_nossas_conhecidas ?? [],
      // AS FONTES DESTE PAR: as velas (do venue) e a ficha (do dono) — cada uma com a sua data, para o bloco do
      // gráfico e o bloco da configuração poderem dizer de onde vêm e há quanto tempo.
      fontes: {
        ficha: ficha === null ? null : fonteDe(join(RAIZ, ficha.caminho), ficha.caminho),
        velas: relogio === null ? null : fonteDe(join(pastaDoMercado, `velas-${nome}-${relogio}.jsonl`), `velas-${nome}-${relogio}.jsonl`),
      },
      falhas: v.falhas ?? null,
      divergente: v.divergente ?? null,
    });
  }

  const equity = instrumentos.find((i) => i.leitura?.equity !== undefined)?.leitura?.equity ?? null;
  const pluginsDaMesa = [...new Set(instrumentos.map((i) => i.ficha?.setup).filter((s) => s !== null))];

  return {
    instalacao,
    identidade: contaDoRetrato,
    plugin: pluginsDaMesa.length === 1 ? pluginsDaMesa[0] : pluginsDaMesa,
    ambiente: null,
    corrida: dirCorrida,
    idade_da_operacao_ms: idadeDoFicheiroMs(caminhoOperacao),
    operacao_em_ms: mtimeMs(caminhoOperacao),
    // AS FONTES, COM A SUA IDADE: de onde vem cada bloco desta instalacao, para o ecra poder DI-LO em cada um.
    fontes: {
      operacao: fonteDe(caminhoOperacao, "operacao.json"),
      registo: fonteDe(join(dirCorrida, "registo.jsonl"), "registo.jsonl"),
      operador_log: fonteDe(join(dirCorrida, "operador.log"), "operador.log"),
    },
    estado_da_mesa: estado.estado,
    estado_desde_ms: estado.desde_ms,
    estado_porque: estado.porque,
    estado_verbo: estado.verbo,
    ligacao: operacao?.ligacao ?? null,
    nota_da_operacao: operacao?.nota ?? null,
    contas: [{ conta: contaDoRetrato, equity, instrumentos }],
    registo: {
      linhas: registo.length,
      ciclos: ciclos.length,
      por_instrumento: contagem(ciclos, (c) => c.instrumento ?? "(sem instrumento)"),
      motivos: contagem(ciclos, (c) => `${c.acao}:${c.motivo}`),
      motivos_por_instrumento: Object.fromEntries(
        nomesDosInstrumentos.map((n) => [n, contagem(ciclos.filter((c) => c.instrumento === n), (c) => `${c.acao}:${c.motivo}`)]),
      ),
      mandato: mandatos.map((m) => ({ instante_ms: m.instante_ms, instrumento: m.instrumento, de: m.de, para: m.para, motivo: m.motivo })),
    },
    carteiro: {
      passagens: logDoOperador.filter((l) => l.etapa === "carteiro").length,
      por_que_nao_saiu: contagem(logDoOperador.filter((l) => l.etapa === "carteiro" && l.enviei === false), (l) => String(l.porque ?? "?")),
    },
    saiu_para_o_venue: {
      desfechos: ficheirosDe(dirCorrida, "desfechos-").map((n) => ({ ficheiro: n, quantos: lerJsonl(join(dirCorrida, n)).length })),
      marcas_de_posse: ficheirosDe(dirCorrida, "marcas-").map((n) => ({ ficheiro: n, quantas: lerJsonl(join(dirCorrida, n)).length })),
    },
    __instrumentos: instrumentos, // usado pelo agregado; nao vai para o fio (removido abaixo)
  };
}

const mesas: any[] = [];
for (const dir of CORRIDAS) mesas.push(await montarMesa(dir));

// ---------------------------------------------------------------- o AGREGADO (a vista geral)

/**
 * A VISTA GERAL — o que serve TODAS as instalacoes de uma vez, para a tela nao ter de somar nada (RN-E9: a soma
 * e' uma conta, e uma conta tem um dono — o produtor).
 *
 * E' seleccao e agregacao do que ja' foi copiado: as posicoes VIVAS, as ordens VIVAS e o que esta' PARADO, com a
 * instalacao e a conta de cada linha. Nao ha aqui nenhum numero novo.
 */
const geral = {
  n_instalacoes: mesas.length,
  n_pares: mesas.reduce((s, m) => s + m.contas[0].instrumentos.length, 0),
  posicoes: [] as any[],
  ordens_vivas: [] as any[],
  parados: [] as any[],
};
for (const m of mesas) {
  for (const i of m.__instrumentos) {
    const base = { instalacao: m.instalacao, conta: i.conta, instrumento: i.instrumento, setup: i.ficha?.setup ?? null };
    const pos = i.leitura?.posicao;
    // COM A ORDEM QUE A ABRIU: a posicao sozinha nao diz de que ordem dela veio (ver `ordemDaPosicao`).
    if (pos) geral.posicoes.push({ ...base, ...pos, ordem_que_a_abriu: i.ordem_da_posicao ?? null });
    for (const o of i.leitura?.ordens_abertas ?? []) geral.ordens_vivas.push({ ...base, ...o });
    // TODOS OS QUE NÃO AGIRAM (espera E atenção), cada um com a sua CLASSE: a fita e a matriz contam-nos em separado,
    // e é a natureza do motivo — não o tempo — que decide a palavra (ver `travado.ts`).
    if ((i.parado?.ciclos ?? 0) > 0) geral.parados.push({ ...base, classe: i.parado.classe, travado: i.parado.travado, porque: i.parado.porque, desde_ms: i.parado.desde_ms, ciclos: i.parado.ciclos, estado_da_mesa: m.estado_da_mesa });
  }
}
for (const m of mesas) delete m.__instrumentos;

// ---------------------------------------------- A CONFIGURACAO (o que a vista de configuracao mostra)
//
// A VISTA DE CONFIGURACAO NAO JULGA NADA, e esta' escrita para que nao possa: ela copia a conta, copia as fichas, e
// **corre o conferidor que ja' existe** (`tools/verificar-setup/fichas.py`, o mesmo do portao), carregando a saida
// dele tal e qual. Reimplementar aqui as regras daria DUAS contas da mesma regra no mesmo ecra — e no dia em que
// divergissem, a tela contradizia o portao (RN-E9: uma conta, um dono).
function conferirAsFichas(): { correu: boolean; codigo: number | null; saida: string } {
  try {
    const r = spawnSync("python3", [join(RAIZ, "tools", "verificar-setup", "fichas.py")], { encoding: "utf8", timeout: 30000 });
    const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return { correu: true, codigo: r.status ?? null, saida };
  } catch (e) {
    return { correu: false, codigo: null, saida: `nao correu: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * A CONTA VAI PARA A TELA — MENOS O QUE FOR SEGREDO.
 *
 * O ficheiro da conta aponta para o segredo por **caminho** (`conexao.credencial.valor_em` =
 * `ficheiro:/.../hl-teste-plugin.key`): e' o caminho que se mostra, e o ficheiro do segredo **nunca se abre aqui**.
 * Mas um guarda vale mais do que uma promessa: qualquer valor cujo NOME pareca um segredo, ou que tenha CARA de
 * chave (hex de 64 ou mais algarismos — a forma de uma chave privada; um endereco tem 40 e NAO e' apanhado), sai
 * como `(nao se mostra)`. Se um dia alguem colar um segredo no ficheiro da conta por engano, a tela nao o publica.
 */
const NOME_DE_SEGREDO = /(segredo|secret|privad|private|senha|password|mnemonic|seed|token|api[_-]?key)/i;
const CARA_DE_CHAVE = /^(0x)?[0-9a-fA-F]{64,}$/;
let segredosEscondidos = 0;
function semSegredos(x: any, nome = ""): any {
  if (typeof x === "string") {
    if (NOME_DE_SEGREDO.test(nome) || CARA_DE_CHAVE.test(x)) { segredosEscondidos++; return "(nao se mostra)"; }
    return x;
  }
  if (Array.isArray(x)) return x.map((v) => semSegredos(v, nome));
  if (x !== null && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, semSegredos(v, k)]));
  return x;
}

/** Cada conta que as instalacoes nomeiam, inteira, com os segredos fora — e o caminho do ficheiro dela. */
function lerAsContas() {
  const nomes = [...new Set(mesas.map((m) => m.identidade).filter((c) => c !== null))];
  return nomes.map((nome) => {
    const caminho = `config/contas/${nome}.json`;
    if (!existsSync(join(RAIZ, caminho))) return { nome, caminho, existe: false, conteudo: null };
    try {
      const cru = JSON.parse(readFileSync(join(RAIZ, caminho), "utf8"));
      return { nome, caminho, existe: true, conteudo: semSegredos(cru) };
    } catch (e) {
      falta(`conta ${nome}`, `ilegivel (${e instanceof Error ? e.message : String(e)})`);
      return { nome, caminho, existe: true, conteudo: null };
    }
  });
}

/**
 * O CATALOGO DOS CONECTORES — o que CADA UM DECLARA, para o formulario da tela nascer do conector e nao de um
 * formulario fixo em HTML. A fonte e o `questionario.json` que cada plugin publica
 * (`brokers/<venue>/questionario.json`, `setups/<nome>/questionario.json`) — o MESMO ficheiro que a entrevista de
 * linha de comando (`tools/preparar-contas`) segue. Acrescentar um conector passa a ser acrescentar um ficheiro:
 * a tela le-o, e nao ha uma segunda lista de campos escrita em JavaScript.
 *
 * O QUE NAO VIAJA, e porque: um campo de tipo `segredo` (o hyperliquid tem um: a chave da API wallet) e
 * publicado como DECLARACAO — id, chave, tipo, se e obrigatorio, a pergunta e a explicacao — e NUNCA com a
 * omissao nem com um exemplo. O valor de um segredo nao existe em questionario nenhum (o que la esta e onde ele
 * vive), e o que fica dito e so o NOME da credencial (RN-E14). E o guarda de CARA DE CHAVE continua a valer
 * aqui: um valor com forma de chave privada (hex de 64+) sai como `(nao se mostra)`, contado.
 */
function lerOsQuestionarios() {
  const out: any[] = [];
  for (const pastaMae of ["brokers", "setups"]) {
    const dir = join(RAIZ, pastaMae);
    if (!existsSync(dir)) continue;
    for (const pasta of readdirSync(dir)) {
      const relativo = `${pastaMae}/${pasta}/questionario.json`;
      const caminho = join(RAIZ, relativo);
      if (!existsSync(caminho)) continue;
      try {
        const q = JSON.parse(readFileSync(caminho, "utf8")) as any;
        const perguntas = (Array.isArray(q.perguntas) ? q.perguntas : []).map((p: any) => {
          // SENSIVEL diz DUAS coisas diferentes, e a tela precisa das duas:
          //   * `tipo: segredo` — o VALOR vive fora (num ficheiro protegido). Nem o valor, nem a omissao, nem um
          //     exemplo viajam; o que a tela sabe e o comando que poe o valor (`guardar-credencial.sh`);
          //   * `sensivel: true` — o campo APONTA para um segredo (um CAMINHO). A declaracao (o caminho) E
          //     legitima e viaja: sem ela o formulario nao tinha omissao nenhuma, e a conta do cTrader nao se
          //     compunha. O que nunca viaja e o valor — que nao esta em questionario nenhum.
          const ehSegredo = p.tipo === "segredo";
          const sensivel = ehSegredo || p.sensivel === true;
          const base: Record<string, unknown> = {
            id: p.id ?? null,
            chave: p.chave ?? null,
            tipo: p.tipo ?? "texto",
            obrigatorio: p.obrigatorio === true,
            opcional: p.opcional === true || p.obrigatorio !== true,
            pergunta: p.pergunta ?? p.id ?? null,
            explicacao: p.explicacao ?? null,
            opcoes: Array.isArray(p.opcoes) ? p.opcoes : null,
            sensivel,
            segredo: ehSegredo,
            destino: sensivel ? (p.destino ?? "ficheiro_de_credencial") : null,
          };
          // O VALOR DE UM SEGREDO NAO VIAJA — nem a omissao, nem o exemplo. Um CAMINHO para um ficheiro `.key`
          // (um campo `sensivel` que nao e segredo) e declaracao, e essa vai.
          if (!ehSegredo) {
            base["omissao"] = p.omissao ?? null;
            base["exemplo"] = p.exemplo ?? null;
          }
          return base;
        });
        out.push(semCaraDeChave({
          ficheiro: relativo,
          plugin: q.plugin ?? pasta,
          tipo: q.tipo ?? null,
          escreve_em: q.escreve_em ?? "conta",
          preenche_sempre: q.preenche_sempre ?? {},
          conta_de_exemplo: q.conta_de_exemplo ?? null,
          incluir: Array.isArray(q.incluir) ? q.incluir : [],
          tem_segredos: perguntas.some((p: any) => p.sensivel),
          perguntas,
        }));
      } catch (e) {
        falta(`questionario ${relativo}`, `ilegivel (${e instanceof Error ? e.message : String(e)}) — um conector que nao publica os seus campos nao da formulario nenhum`);
      }
    }
  }
  return out.sort((a, b) => String(a.plugin).localeCompare(String(b.plugin)));
}

/** O guarda de CARA DE CHAVE aplicado a um valor qualquer do catalogo (nome nao conta: um CAMINHO para um
 *  `.key` tem `client_secret` no proprio texto e NAO e um segredo — e um ponteiro, e mostra-se). */
function semCaraDeChave(x: any): any {
  if (typeof x === "string") {
    if (CARA_DE_CHAVE.test(x)) { segredosEscondidos++; return "(nao se mostra)"; }
    return x;
  }
  if (Array.isArray(x)) return x.map(semCaraDeChave);
  if (x !== null && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, semCaraDeChave(v)]));
  return x;
}

/**
 * OS PLUGINS — a vista por setup, e nao por conta. Um plugin pode correr em varias instalacoes (contas/pares); aqui
 * junta-se o que e' o MESMO setup, com as instalacoes e os pares onde corre. E' o que faz a tela deixar de ser "o
 * painel do sigma" e passar a ser a do sistema: acrescentar um setup nao muda isto.
 */
const plugins = [...manifestos.values()].map((m) => {
  const pares: any[] = [];
  for (const mesa of mesas) {
    for (const i of mesa.contas[0].instrumentos) {
      if (i.ficha?.setup === m.nome) pares.push({ instalacao: mesa.instalacao, conta: i.conta, instrumento: i.instrumento, run: i.ficha?.run ?? null, enviar: i.ficha?.enviar ?? null });
    }
  }
  return { nome: m.nome, versao: m.versao, linguagem: m.linguagem, pasta: m.pasta, publica_serie: Array.isArray(m.sobreposicao) && m.sobreposicao.length > 0, pares };
});

// ---------------------------------------------------------------- o fio

// O CATALOGO construi-se ANTES do fio: assim o contador de valores escondidos ja' inclui o que o catalogo
// esconde, e o numero que a tela mostra e' o total (configuracao + catalogo), nao metade dele.
const catalogo = { conectores: lerOsQuestionarios() };

// A VERSAO DA TELA — o instante da alteracao mais recente dos ficheiros que a desenham. Vai no fio (na fita e no
// fio leve) para a pagina a poder comparar: se a versao que ela carregou ja' nao e' a que o servidor serve, ela
// RECARREGA-SE SOZINHA. E' isto que impede DUAS SESSOES do painel com codigo diferente — a aba aberta ha' uma hora
// a mostrar a tela velha ao lado de uma nova — e e' a razao de nenhuma correcao ficar «fora do ar» para quem ja'
// tinha a pagina aberta. Nao e' um numero escrito a mao: sai do disco, a cada fio.
function versaoDaTela(): number {
  const alvos = [join(RAIZ, "web", "painel", "index.html"), join(RAIZ, "web", "painel", "tema.css")];
  try {
    for (const f of readdirSync(join(RAIZ, "web", "painel", "js"))) {
      if (f.endsWith(".js")) alvos.push(join(RAIZ, "web", "painel", "js", f));
    }
  } catch { /* sem a pasta dos js, a versao e' a do documento e do tema */ }
  let maior = 0;
  for (const a of alvos) {
    try {
      const m = statSync(a).mtimeMs;
      if (m > maior) maior = m;
    } catch { /* ficheiro ausente: nao conta para a versao */ }
  }
  return Math.round(maior);
}

const fio = {
  _o_que_e_isto:
    "O RETRATO: o fio entre o MesaCore e a tela. Leitor puro — le CADA instalacao (corrida), pergunta a cada setup a " +
    "sua serie e junta tudo. A tela NAO calcula nada disto (RN-E9). Todo o numero traz a hora a que foi lido.",
  retrato: {
    gerado_em_ms: agora,
    gerado_em: new Date(agora).toISOString(),
    // DE QUE CORRIDA E' A TELA — e por que criterio foram escolhidas (explicita ou descoberta). Hoje nao se sabia.
    instalacoes: CORRIDAS.map((d) => ({ instalacao: basename(d), corrida: d })),
    descoberta: DESCOBERTA_DAS_CORRIDAS,
    raiz_das_corridas: RAIZ_DAS_CORRIDAS,
    idade_viva_ms: IDADE_VIVA_MS,
    // RN-E8: a tela fala com um REGISTO de mesas (uma lista de identidades e enderecos), nunca com um endereco
    // unico. Aqui a lista tem N instalacoes — e a tela nunca muda de forma por ter uma ou tres (RN-E10/E23).
    nota_do_registo: "uma entrada por INSTALACAO; as contas sao vistas da mesa (RN-E23)",
  },
  registo_de_mesas: mesas.map((m) => ({
    identidade: m.identidade,
    instalacao: m.instalacao,
    corrida: m.corrida,
    plugin: m.plugin,
    estado_da_mesa: m.estado_da_mesa,
    idade_da_operacao_ms: m.idade_da_operacao_ms,
    endereco: null,
    descoberta: DESCOBERTA_DAS_CORRIDAS,
  })),
  mesas: mesas.map(({ __instrumentos, ...m }) => m),
  geral,
  plugins,
  // O CATALOGO DOS CONECTORES — a declaracao de campos de cada plugin (brokers/*, setups/*). E' daqui que o
  // formulario de criar uma conta na tela sabe quais sao os campos, quais sao obrigatorios, o que aceitam e o que
  // acontece se faltar — sem um formulario fixo em HTML e sem a tela conhecer um conector por nome.
  catalogo: { ...catalogo, segredos_escondidos: segredosEscondidos },
  // ------------------------------------------ A CONFIGURACAO — o que a vista de configuracao mostra
  configuracao: {
    contas: lerAsContas(),
    // AS FICHAS INTEIRAS: o cabecalho (as dez chaves que o sistema le) e as constantes do indicador. Sao pequenas,
    // e a vista mostra-as palavra por palavra — sem as reescrever, sem as resumir e sem as reformatar.
    //
    // O `hash` viaja com cada ficha, e nao e' enfeite: e' a IMPRESSAO do ficheiro que a tela viu. Quem escreve
    // manda-a de volta, e o escritor recusa se ela nao for a do ficheiro em disco — e' o que impede uma pagina
    // aberta ha' dez minutos de passar por cima de uma mudanca nova.
    fichas: fichas.map((f) => {
      const caminho = join(RAIZ, f.caminho);
      let hash: string | null = null;
      try { hash = createHash("sha256").update(readFileSync(caminho)).digest("hex"); } catch { /* a falta fica dita abaixo */ }
      if (hash === null) falta(`ficha ${f.caminho}`, "nao se conseguiu ler para calcular a impressao (a tela nao podera' escreve-la)");
      return { caminho: f.caminho, hash, cabecalho: f.cabecalho ?? null, constantes: f.constantes ?? null };
    }),
    // O VEREDITO VEM DO CONFERIDOR, nao daqui (ver `conferirAsFichas`): a vista nao julga.
    conferidor: conferirAsFichas(),
    segredos_escondidos: segredosEscondidos,
    // PORQUE ISTO AINDA NAO ESCREVE. Escrever uma ficha exige validacao e assinatura (RN-E12/RN-M2), e o caminho de
    // escrita tem de ser UMA porta so' — a mesma que o gesto do dono ja' usa, para nao haver duas vias de execucao.
    // Enquanto essa porta nao existir para a tela, a vista LE e APONTA a porta que existe.
    escreve: false,
    porta_que_escreve: "bash tools/ligar-par.sh <INSTRUMENTO> <sim|nao> [conta]",
  },
  // A VERSAO DA TELA que este fio acompanha — a pagina compara-a com a que carregou e recarrega-se se mudou.
  // (Sem ela, dois separadores abertos em momentos diferentes ficam com codigo diferente: e' o «2 sessao do dash».)
  tela_em_ms: versaoDaTela(),
  faltas: falhasDoRetrato,
};

const destino = isAbsolute(PARA) ? PARA : join(RAIZ, PARA);
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, JSON.stringify(fio, null, 1) + "\n");

// A SAIDA NA TELA: o que o dono le' quando corre isto a mao — e o que se cola num relatorio.
console.log(`retrato de ${new Date(agora).toISOString()}`);
console.log(`  instalacoes (${DESCOBERTA_DAS_CORRIDAS}):`);
for (const m of mesas) {
  console.log(`    ${m.instalacao} · ${m.identidade} · ${m.corrida}`);
  console.log(`      mesa: estado ${m.estado_da_mesa} · ${m.registo.ciclos} ciclos em ${m.registo.linhas} linhas · operacao lida ha' ${m.idade_da_operacao_ms === null ? "?" : Math.round(m.idade_da_operacao_ms / 1000) + " s"}`);
  for (const i of m.contas[0].instrumentos) {
    const med = i.o_que_o_setup_disse?.medicao;
    console.log(
      `      ${i.instrumento}: ficha ${i.ficha?.caminho ?? "(sem ficha)"} · run=${i.ficha?.run} enviar=${i.ficha?.enviar} · ` +
        `velas ${(i.velas ?? []).length} · serie ${(i.serie_do_setup ?? []).length}${i.sobreposicao_indisponivel ? " (AUSENTE)" : ""}` +
        ` · travado por ${i.parado?.travado ? `${i.parado.porque} (ha' ${i.parado.ciclos} ciclos)` : "nada"}` +
        ` · ultima medicao do setup (volta ${med?.volta ?? "?"}): sig=${med?.sig ?? "?"} virada=${med?.virada ?? "?"}`,
    );
  }
}
console.log(`  geral: ${geral.n_instalacoes} instalacao(oes) · ${geral.n_pares} pares · ${geral.posicoes.length} posicao(oes) viva(s) · ${geral.ordens_vivas.length} ordem(ns) viva(s) · ${geral.parados.length} parado(s)`);
if (falhasDoRetrato.length > 0) {
  console.log(`  FALTAS (ditas, nao escondidas):`);
  for (const f of falhasDoRetrato) console.log(`    - ${f.o_que}: ${f.porque}`);
} else {
  console.log("  faltas: nenhuma");
}
console.log(`  escrito em: ${destino}`);
console.log(
  `  configuracao: ${fio.configuracao.contas.length} conta(s) · ${fio.configuracao.fichas.length} ficha(s) · ` +
    `conferidor ${fio.configuracao.conferidor.correu ? (fio.configuracao.conferidor.codigo === 0 ? "APROVOU" : `REPROVOU (codigo ${fio.configuracao.conferidor.codigo})`) : "NAO CORREU"}` +
    (fio.configuracao.segredos_escondidos > 0 ? ` · ${fio.configuracao.segredos_escondidos} valor(es) escondido(s) por parecerem segredo` : ""),
);
