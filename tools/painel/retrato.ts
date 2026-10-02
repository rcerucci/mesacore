#!/usr/bin/env bun
// O RETRATO — o fio entre o SISTEMA e a TELA.
//
// ISTO E' UM LEITOR, e e' so' isso. Le o que a corrida ja' escreveu (a operacao, o registo, o log do operador,
// as fichas do dono), pergunta a cada SETUP a sua propria serie para desenhar, e junta tudo num ficheiro — o
// `painel.json` — que a tela consome.
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
//   bun run tools/painel/retrato.ts [--corrida <dir>] [--para <ficheiro.json>] [--conta <nome>]

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const RAIZ = join(import.meta.dir, "..", "..");
const argv = process.argv.slice(2);
const argumento = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DIR_DA_CORRIDA = argumento("--corrida") ?? `${process.env["HOME"]}/.hermes/profiles/appbuilder/cache/scratch/corrida-de-risco`;
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

const operacao: any = existsSync(join(DIR_DA_CORRIDA, "operacao.json"))
  ? JSON.parse(readFileSync(join(DIR_DA_CORRIDA, "operacao.json"), "utf8"))
  : (falta("operacao.json", `nao existe em ${DIR_DA_CORRIDA}: sem ela nao ha leitura, nem posicao, nem proposta`), null);
const registo = lerJsonl(join(DIR_DA_CORRIDA, "registo.jsonl"));
const logDoOperador = lerJsonl(join(DIR_DA_CORRIDA, "operador.log"));

/** Os desfechos e as marcas de posse, um ficheiro por conta — como o sistema os escreve, ao lado da operacao. */
function ficheirosDe(prefixo: string): string[] {
  if (!existsSync(DIR_DA_CORRIDA)) return [];
  return readdirSync(DIR_DA_CORRIDA).filter((n) => n.startsWith(prefixo) && n.endsWith(".jsonl"));
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
  const cmd = [...manifesto.sobreposicao.map((p) => p.replace(/^\.\//, "")), "--"].filter((p) => p !== "--");
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

/** As velas do VENUE — o ficheiro que o operador escreve a cada leitura (`velas-<PAR>-<RELOGO>.jsonl`). */
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
 * e' o dono da regra "a barra que ainda esta' a formar nao conta" — o leitor limita-se a recortar as velas por
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
function oQueOSetupDisse(instrumento: string) {
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

// ---------------------------------------------------------------- o estado da mesa, do registo

let estadoDaMesa = "parada";
for (const l of registo) if (l.tipo === "transicao" && l.para) estadoDaMesa = l.para;
const ciclos = registo.filter((l) => l.tipo === "ciclo");
const mandatos = registo.filter((l) => l.tipo === "mandato");
const contagem = (xs: any[], chave: (x: any) => string) => {
  const c: Record<string, number> = {};
  for (const x of xs) c[chave(x)] = (c[chave(x)] ?? 0) + 1;
  return c;
};

// ---------------------------------------------------------------- os instrumentos

const instrumentosDaOperacao: Record<string, any> = operacao?.instrumentos ?? {};
const nomesDosInstrumentos = Object.keys(instrumentosDaOperacao).sort();
const contaDoRetrato = CONTA ?? operacao?.conta ?? fichas[0]?.cabecalho?.["conta"] ?? null;

const instrumentos: any[] = [];
for (const nome of nomesDosInstrumentos) {
  const v = instrumentosDaOperacao[nome]!;
  const leitura = v.leitura ?? null;
  const ficha = fichas.find((f) => f.cabecalho?.["instrumento"] === nome && (contaDoRetrato === null || f.cabecalho?.["conta"] === contaDoRetrato)) ?? null;
  const setup = ficha?.cabecalho?.["setup"] ?? null;
  const manifesto = setup !== null ? manifestos.get(setup) ?? null : null;
  const relogio = v.relogio ?? ficha?.cabecalho?.["relogio"] ?? null;
  const constantes = v.parametros ?? ficha?.constantes ?? {};
  const pastaDoMercado = existsSync(join(DIR_DA_CORRIDA, "mercado")) ? join(DIR_DA_CORRIDA, "mercado") : join(RAIZ, "tools", "verificar-setup", "barras");

  const sobreposicao = SEM_SERIE
    ? { serie: null, em_curso: null, janela: null, porque: null }
    : manifesto !== null && relogio !== null
      ? await pedirSobreposicao(manifesto, nome, relogio, constantes, pastaDoMercado, leitura?.tempo_do_venue_ms ?? null)
      : { serie: null, em_curso: null, janela: null, porque: `nao ha ficha nem manifesto para ${nome}: nao se sabe que serie pedir` };
  if (sobreposicao.porque !== null) falta(`sobreposicao de ${nome}`, sobreposicao.porque);

  // AS VELAS (do venue) x A SERIE (do setup): duas pontas, cruzadas por tempo. Sem serie nao ha cruzamento, e
  // as velas ficam sozinhas — o grafico desenha o mercado e di-lo: "este setup nao publica serie".
  // Em modo leve nenhuma das duas se le': a tela ja' as tem do retrato completo, e a falta nao se anuncia (nao
  // falta nada — apenas nao se pediu nada).
  const velas = SEM_SERIE || relogio === null ? null : lerVelas(nome, relogio, pastaDoMercado);
  if (velas === null && relogio !== null && !SEM_SERIE) falta(`velas de ${nome}-${relogio}`, `nao existe velas-${nome}-${relogio}.jsonl em ${pastaDoMercado}`);
  const cruzamento =
    velas !== null && sobreposicao.serie !== null
      ? cruzar(velas, sobreposicao.serie, sobreposicao.janela)
      : { velas: velas ?? [], serie: [], janela: null, faltas_do_cruzamento: { velas_sem_ponto_da_serie: [], pontos_sem_vela: [] } };
  if (cruzamento.faltas_do_cruzamento.velas_sem_ponto_da_serie.length > 0) {
    falta(
      `cruzamento de ${nome}`,
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
    // O QUE SE DESENHA, em duas pontas separadas e ditadas: as VELAS (o mercado, do venue) e a SERIE (a leitura
    // do indicador, do setup). A tela desenha-as juntas e nunca as confunde: uma e' o que aconteceu, a outra e'
    // o que o motor viu.
    // AS SERIES SO' EXISTEM NO RETRATO COMPLETO (ver `SEM_SERIE`): em modo leve a tela JA' tem a serie
    // desenhada, e repetir 1,7 MB a cada dois segundos para a deitar fora seria o contrario de leve.
    ...(SEM_SERIE
      ? {}
      : {
          velas: cruzamento.velas,
          serie_do_setup: cruzamento.serie,
          janela: cruzamento.janela,
          em_curso: sobreposicao.em_curso,
          sobreposicao_indisponivel: sobreposicao.porque,
          faltas_do_cruzamento: cruzamento.faltas_do_cruzamento,
        }),
    o_que_o_setup_disse: oQueOSetupDisse(nome),
    proposta: v.proposta ?? null,
    ultima_decisao: ultimoCiclo,
    decisao_contagem: contagem(meusCiclos, (c) => `${c.acao}:${c.motivo}`),
    // ONDE A MESA DECIDIU ABRIR — os instantes das decisoes de `abrir` deste par, lidos do registo. Vao para o
    // grafico como marca propria, e NAO se misturam com a virada do indicador: uma e' a regra a virar, a outra
    // e' a mesa a decidir — e no dia em que nao coincidirem, tem de se ver que nao coincidiram.
    decisoes_de_abrir_ms: meusCiclos.filter((c) => c.acao === "abrir").map((c) => c.instante_ms),
    marcas_nossas_conhecidas: v.marcas_nossas_conhecidas ?? [],
    falhas: v.falhas ?? null,
    divergente: v.divergente ?? null,
  });
}

// ---------------------------------------------------------------- o fio

/** O instante em que ESTE retrato foi feito — a tela mostra-o: um numero sem hora nao se confia. */
const agora = Date.now();
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

/** A conta do retrato, inteira, com os segredos fora — e o caminho de cada ficheiro que ela nomeia. */
function lerAConfiguracaoDaConta() {
  if (contaDoRetrato === null) return null;
  const caminho = `config/contas/${contaDoRetrato}.json`;
  if (!existsSync(join(RAIZ, caminho))) return { caminho, existe: false, conteudo: null };
  try {
    const cru = JSON.parse(readFileSync(join(RAIZ, caminho), "utf8"));
    return { caminho, existe: true, conteudo: semSegredos(cru) };
  } catch (e) {
    falta(`conta ${contaDoRetrato}`, `ilegivel (${e instanceof Error ? e.message : String(e)})`);
    return { caminho, existe: true, conteudo: null };
  }
}

const fio = {
  _o_que_e_isto:
    "O RETRATO: o fio entre o MesaCore e a tela. Leitor puro — le a corrida, pergunta a cada setup a sua serie e " +
    "junta tudo. A tela NAO calcula nada disto (RN-E9). Todo o numero traz a hora a que foi lido.",
  retrato: {
    gerado_em_ms: agora,
    gerado_em: new Date(agora).toISOString(),
    corrida: DIR_DA_CORRIDA,
    // RN-E8: a tela fala com um REGISTO de mesas (uma lista de identidades e enderecos), nunca com um endereco
    // unico. Aqui a lista tem uma instalacao — e a tela nunca muda de forma por ter uma ou tres (RN-E10/E23).
    nota_do_registo: "uma entrada por INSTALACAO; as contas sao vistas da mesa (RN-E23)",
  },
  registo_de_mesas: [{ identidade: contaDoRetrato, endereco: null, descoberta: "retrato local (ainda sem caminho fixo publicado)" }],
  mesas: [
    {
      identidade: contaDoRetrato,
      ambiente: null,
      estado_da_mesa: estadoDaMesa,
      ligacao: operacao?.ligacao ?? null,
      nota_da_operacao: operacao?.nota ?? null,
      contas: [
        {
          conta: contaDoRetrato,
          equity: instrumentos.find((i) => i.leitura?.equity !== undefined)?.leitura?.equity ?? null,
          instrumentos,
        },
      ],
      registo: {
        linhas: registo.length,
        ciclos: ciclos.length,
        por_instrumento: contagem(ciclos, (c) => c.instrumento ?? "(sem instrumento)"),
        motivos: contagem(ciclos.filter((c) => c.instrumento === nomesDosInstrumentos[0]), (c) => `${c.acao}:${c.motivo}`),
        mandato: mandatos.map((m) => ({ instante_ms: m.instante_ms, instrumento: m.instrumento, de: m.de, para: m.para, motivo: m.motivo })),
      },
      carteiro: {
        passagens: logDoOperador.filter((l) => l.etapa === "carteiro").length,
        por_que_nao_saiu: contagem(logDoOperador.filter((l) => l.etapa === "carteiro" && l.enviei === false), (l) => String(l.porque ?? "?")),
      },
      saiu_para_o_venue: {
        desfechos: ficheirosDe("desfechos-").map((n) => ({ ficheiro: n, quantos: lerJsonl(join(DIR_DA_CORRIDA, n)).length })),
        marcas_de_posse: ficheirosDe("marcas-").map((n) => ({ ficheiro: n, quantas: lerJsonl(join(DIR_DA_CORRIDA, n)).length })),
      },
    },
  ],
  // ------------------------------------------ A CONFIGURACAO — o que a vista de configuracao mostra
  configuracao: {
    conta: lerAConfiguracaoDaConta(),
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
  faltas: falhasDoRetrato,
};

const destino = isAbsolute(PARA) ? PARA : join(RAIZ, PARA);
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, JSON.stringify(fio, null, 1) + "\n");

// A SAIDA NA TELA: o que o dono le' quando corre isto a mao — e o que se cola num relatorio.
console.log(`retrato de ${new Date(agora).toISOString()}`);
console.log(`  corrida:   ${DIR_DA_CORRIDA}`);
console.log(`  mesa:      ${contaDoRetrato} · estado ${estadoDaMesa} · ${ciclos.length} ciclos em ${registo.length} linhas`);
console.log(`  instrumentos: ${nomesDosInstrumentos.join(", ") || "(nenhum)"}`);
for (const i of instrumentos) {
  const med = i.o_que_o_setup_disse?.medicao;
  console.log(
    `    ${i.instrumento}: ficha ${i.ficha?.caminho ?? "(sem ficha)"} · run=${i.ficha?.run} enviar=${i.ficha?.enviar} · ` +
      `velas ${i.velas.length} · serie ${i.serie_do_setup.length}${i.sobreposicao_indisponivel ? " (AUSENTE)" : ""} · ` +
      `ultima medicao do setup (volta ${med?.volta ?? "?"}): sig=${med?.sig ?? "?"} virada=${med?.virada ?? "?"}`,
  );
}
if (falhasDoRetrato.length > 0) {
  console.log(`  FALTAS (ditas, nao escondidas):`);
  for (const f of falhasDoRetrato) console.log(`    - ${f.o_que}: ${f.porque}`);
} else {
  console.log("  faltas: nenhuma");
}
console.log(`  escrito em: ${destino}`);
console.log(
  `  configuracao: conta ${fio.configuracao.conta?.caminho ?? "(sem conta)"} · ${fio.configuracao.fichas.length} ficha(s) · ` +
    `conferidor ${fio.configuracao.conferidor.correu ? (fio.configuracao.conferidor.codigo === 0 ? "APROVOU" : `REPROVOU (codigo ${fio.configuracao.conferidor.codigo})`) : "NAO CORREU"}` +
    (fio.configuracao.segredos_escondidos > 0 ? ` · ${fio.configuracao.segredos_escondidos} valor(es) escondido(s) por parecerem segredo` : ""),
);
