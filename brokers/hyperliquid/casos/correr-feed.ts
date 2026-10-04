#!/usr/bin/env bun
// A BANCADA DO FEED DE MERCADO — o núcleo puro, SEM REDE.
//
// PORQUE EXISTE. O `feed.ts` é o processo que serve o mercado por STREAM: liga-se ao venue, agrega a barra em
// curso a partir do livro e escreve `velas-<PAR>-<RELOGO>.jsonl`. Não tinha bancada nenhuma — o que havia era
// execução ao vivo, e o `docs/ONDE_ESTAMOS.md` di-lo por escrito. É o processo que alimenta TODOS os setups: uma
// barra agregada mal marcada, ou uma barra inventada onde houve um buraco, envenena a decisão a jusante sem que
// nada fique vermelho (o setup lê o ficheiro e não sabe de onde ele veio).
//
// O QUE ESTA BANCADA PROVA (as regras do núcleo, cada uma com o seu controle):
//
//   1. A BARRA EM CURSO AGREGADA DO `bbo` leva `agregada_do_bbo: true`, e o `v`/`n` ficam a ZERO. O livro não
//      diz o volume nem o número de trades: inventá-los seria fingir uma medida que não foi feita. Controle:
//      uma barra que veio DO VENUE não é zerada por nós (a marca da agregação é do que é NOSSO, e só dele); e
//      num relógio que não se alinha por divisão do dia (`1d`) não se agrega nada (fail-closed).
//   2. A BARRA DO VENUE COM O MESMO `t` SUBSTITUI a agregada — e a marca `agregada_do_bbo` DESAPARECE com ela
//      (o que é do venue manda). Controles: `t` maior acrescenta (não substitui); uma barra mais ANTIGA do que a
//      última FECHADA é NOMEADA (`barra_atrasada_descartada`) e não entra, em vez de ser ignorada em silêncio.
//   2-bis. A AGREGAÇÃO SÓ TOCA EM BARRA NOSSA (03/10/2026). Medido na corrida viva: depois de o venue substituir
//      a agregada, o `bbo` seguinte MUTAVA a barra do venue (punha-lhe o mid no `o`/`h`/`l`/`c` e carimbava-lhe a
//      marca) — 316 barras do ETH-1m ficaram com a marca da agregação E o `v`/`n` do venue. O caso que faltava
//      mede a sequência inteira: agregar -> o venue substitui -> CHEGA OUTRO `bbo` do mesmo período. A agregação
//      cala-se: a barra do venue fica como veio, e nada fica por escrever.
//   2-ter. A LISTA FICA ORDENADA POR `t` (03/10/2026). A barra do venue que chega DEPOIS de a agregação já ter
//      aberto o período seguinte: se o período dela já está na lista (a NOSSA agregada), ela toma o LUGAR dela; se
//      o período não estava (um buraco), ela INSERE-SE na posição ordenada. Era deitada fora em silêncio (achado 2
//      da auditoria, `feed-barras.ts` ~132-134). Controle negativo: uma barra ANTERIOR à última fechada é NOMEADA
//      e não entra — inserir para trás seria reescrever história que já foi gravada.
//   3. O STREAM NÃO TEM MEMÓRIA: uma barra que se perdeu é NOMEADA (`buraco_no_historico`, com quantas faltam)
//      e NUNCA inventada — a lista cresce um só (a barra que chegou). Controle: duas barras seguidas não
//      produzem buraco nenhum; sem esse par, o aviso podia sair sempre.
//   4. O FICHEIRO escreve-se ATÓMICO (ficheiro novo + `rename`) e o HISTÓRICO fica intacto. Mede-se pelos dois
//      lados: o inode do ficheiro MUDA entre duas escritas (é a troca de nome; reescrever no sítio mantinha-o) e
//      as linhas antigas ficam byte a byte iguais. Controle: uma linha partida no ficheiro não se adivinha — o
//      histórico que se lê de volta perde-a e mantém as boas.
//   5. A PRIMEIRA barra de um par NOVO não se deita fora: com a lista VAZIA (o ficheiro do par ainda não existe)
//      a barra do venue é guardada, tal como veio. Este ramo foi MEDIDO aqui — a bancada apanhou-o ao montar o
//      controle do caso 1-b: o feed perdia a primeira barra de um par novo EM SILÊNCIO, e o ficheiro ficava vazio
//      até à barra seguinte (até um período inteiro, num relógio de 1h/4h, e sem uma linha a dizê-lo).
//
// O QUE ESTA BANCADA NÃO PROVA, e fica dito: a LIGAÇÃO ao venue (o `SubscriptionClient`, o `candle` e o `bbo`
// a sério). Isso não se prova sem rede, e por isso o núcleo vive em `feed-barras.ts` (módulo SEM efeitos ao
// carregar) e o `feed.ts` — que se liga no arranque — fica de fora. A prova do stream continua a ser a execução
// ao vivo, e é isso que o `ONDE_ESTAMOS` diz.
//
// A BANCADA NÃO PODE REBENTAR: onde uma barra tem de existir, ela lê-se por `barra()`, que ANOTA o problema
// quando ela não está lá em vez de seguir com `undefined`. Medido na prova negativa: um defeito injectado fazia a
// bancada sair com um `TypeError` — vermelho, mas SEM nomear o caso, que é o mesmo que não ter medido nada.
//
// Uso:  bun run brokers/hyperliquid/casos/correr-feed.ts
// Sai 1 se houver divergência.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agregarDoBbo,
  caminhoDasVelas,
  encaixarVela,
  escreverVelas,
  estadoDoPar,
  type Estado,
  type Vela,
} from "../feed-barras.ts";

const RELOGIO = "1m";
const PASSO = 60_000; // o passo do `1m`, conferido abaixo contra o `PASSO_EM_MS` do próprio módulo
const PAR = "BTC";
const INICIO = 1_800_000_000_000 - (1_800_000_000_000 % PASSO); // um início de período exacto

let total = 0;
let ok = 0;
const divergentes: string[] = [];

function registar(caso: string, problemas: string[]): void {
  total += 1;
  if (problemas.length === 0) {
    ok += 1;
    return;
  }
  divergentes.push(`${caso}: ${problemas.join(" · ")}`);
}

/** Uma barra do VENUE, na forma crua dele (com volume e trades: é ele que os mede). */
function barraDoVenue(t: number, c: string, v = "12.5", n = 7): Vela {
  return { t, T: t + PASSO, o: c, h: c, l: c, c, v, n };
}

/** Um estado novo, como o feed o constrói ao subscrever um par (histórico lido do disco, aqui vazio). */
function estadoVazio(): Estado {
  return { velas: [], escritoEm: 0, porEscrever: false };
}

/** A barra `i` do estado — ou `null`, com o problema JÁ ANOTADO. */
function barra(e: Estado, i: number, problemas: string[]): Vela | null {
  if (e.velas.length <= i) {
    problemas.push(`esperava uma barra no indice ${i}, o estado tem ${e.velas.length}`);
    return null;
  }
  return e.velas[i]!;
}

/** Um `dizer` de bancada: guarda as linhas em vez de as escrever no canal de diagnóstico. */
function apanhar(): { linhas: Record<string, unknown>[]; dizer: (o: Record<string, unknown>) => void } {
  const linhas: Record<string, unknown>[] = [];
  return { linhas, dizer: (o) => void linhas.push(o) };
}

// ---------------------------------------------------------------------------------------------------------
// 1. A barra em curso agregada do `bbo`: marcada, e com `v`/`n` a ZERO.

{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, RELOGIO, 100, INICIO + 1_000);
  if (e.velas.length !== 1) problemas.push(`esperava UMA barra agregada, veio ${e.velas.length}`);
  const primeira = barra(e, 0, problemas);
  if (primeira !== null) {
    if (primeira.agregada_do_bbo !== true) problemas.push(`a barra agregada nao leva \`agregada_do_bbo: true\` (veio ${JSON.stringify(primeira.agregada_do_bbo)})`);
    if (primeira.v !== "0") problemas.push(`o volume da barra agregada tem de ser ZERO (o livro nao o diz), veio ${JSON.stringify(primeira.v)}`);
    if (primeira.n !== 0) problemas.push(`o numero de trades da barra agregada tem de ser ZERO, veio ${JSON.stringify(primeira.n)}`);
    if (primeira.t !== INICIO) problemas.push(`a barra agregada tem de comecar no inicio do periodo (${INICIO}), veio ${primeira.t}`);
    if (!(primeira.o === primeira.h && primeira.h === primeira.l && primeira.l === primeira.c)) {
      problemas.push(`a primeira barra tem o/h/l/c iguais ao mid, veio ${primeira.o}/${primeira.h}/${primeira.l}/${primeira.c}`);
    }
  }
  // O mid seguinte, DENTRO do mesmo periodo: sobe o `h` e move o `c`; o `l` fica.
  agregarDoBbo(e, RELOGIO, 105, INICIO + 1_500);
  if (e.velas.length !== 1) problemas.push(`um segundo mid dentro do periodo nao pode criar barra nova (veio ${e.velas.length})`);
  const segunda = barra(e, 0, problemas);
  if (segunda !== null) {
    if (segunda.h !== "105") problemas.push(`o maximo tinha de subir para 105, veio ${segunda.h}`);
    if (segunda.l !== "100") problemas.push(`o minimo nao podia mexer-se (100), veio ${segunda.l}`);
    if (segunda.c !== "105") problemas.push(`o fecho tinha de ser 105, veio ${segunda.c}`);
  }
  // E o mid seguinte, mais BAIXO: o `l` desce.
  agregarDoBbo(e, RELOGIO, 99, INICIO + 1_800);
  const terceira = barra(e, 0, problemas);
  if (terceira !== null && terceira.l !== "99") problemas.push(`o minimo tinha de descer para 99, veio ${terceira.l}`);
  if (e.porEscrever !== true) problemas.push("a barra mexida tem de ficar POR ESCREVER");
  registar("feed/a-barra-agregada-do-bbo-e-marcada-e-o-vn-fica-a-zero", problemas);
}

// 1-b. CONTROLE: o zero é do que NÓS agregamos — a barra do venue passa com o volume e os trades DELE.
{
  const problemas: string[] = [];
  const e = estadoVazio();
  encaixarVela(e, barraDoVenue(INICIO, "100", "12.5", 7), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  const b = barra(e, 0, problemas);
  if (b !== null) {
    if (b.v !== "12.5") problemas.push(`a barra do venue nao pode ser zerada por nos: v=${JSON.stringify(b.v)}`);
    if (b.n !== 7) problemas.push(`a barra do venue nao pode ser zerada por nos: n=${JSON.stringify(b.n)}`);
    if (b.agregada_do_bbo !== undefined) problemas.push(`a barra do venue NAO leva a marca da nossa agregacao (veio ${JSON.stringify(b.agregada_do_bbo)})`);
  }
  registar("feed/controle-a-barra-do-venue-nao-e-zerada-por-nos", problemas);
}

// 1-c. CONTROLE: num relogio que nao se alinha por divisao do dia (`1d`), nao se agrega nada.
{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, "1d", 100, INICIO + 1_000);
  if (e.velas.length !== 0) problemas.push(`\`1d\` nao se agrega (fail-closed): veio ${e.velas.length} barra(s)`);
  if (e.porEscrever !== false) problemas.push("sem agregacao nao ha nada por escrever");
  registar("feed/controle-relogio-que-nao-se-alinha-nao-se-agrega", problemas);
}

// ---------------------------------------------------------------------------------------------------------
// 2. A barra do venue com o MESMO `t` SUBSTITUI a agregada (e a marca desaparece com ela).

{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, RELOGIO, 100, INICIO + 1_000);
  encaixarVela(e, barraDoVenue(INICIO, "101", "3", 2), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  if (e.velas.length !== 1) problemas.push(`substituir nao pode fazer crescer a lista (veio ${e.velas.length})`);
  const b = barra(e, 0, problemas);
  if (b !== null) {
    if (b.c !== "101" || b.v !== "3" || b.n !== 2) problemas.push(`a barra do venue tinha de ficar no lugar da agregada, veio ${JSON.stringify(b)}`);
    if (b.agregada_do_bbo !== undefined) problemas.push("a marca `agregada_do_bbo` tinha de DESAPARECER com a barra que ela marcava");
  }
  registar("feed/a-barra-do-venue-com-o-mesmo-t-substitui-a-agregada", problemas);
}

// 2-b. CONTROLE: `t` MAIOR acrescenta (a anterior fechou), `t` IGUAL substitui (a mesma barra, mais fresca).
{
  const problemas: string[] = [];
  const e = estadoVazio();
  encaixarVela(e, barraDoVenue(INICIO, "100"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  encaixarVela(e, barraDoVenue(INICIO + PASSO, "101"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  if (e.velas.length !== 2) problemas.push(`um \`t\` maior acrescenta: esperava 2 barras, veio ${e.velas.length}`);
  encaixarVela(e, barraDoVenue(INICIO + PASSO, "102"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  if (e.velas.length !== 2) problemas.push(`um \`t\` igual ao da ultima substitui (nao acrescenta): veio ${e.velas.length} barras`);
  const ultima = barra(e, 1, problemas);
  if (ultima !== null && ultima.c !== "102") problemas.push(`a barra do mesmo \`t\` tinha de ser a mais fresca (c=102), veio ${ultima.c}`);
  registar("feed/controle-t-maior-acrescenta-e-t-igual-substitui", problemas);
}

// 2-c. A SEQUENCIA QUE FALTAVA (03/10/2026): bater o `bbo` DEPOIS de o venue substituir a agregada.
//      A agregação SO' TOCA EM BARRA NOSSA: a barra do venue do mesmo período faz a agregação CALAR-SE.
{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, RELOGIO, 100, INICIO + 1_000); // a NOSSA agregada abre o periodo
  encaixarVela(e, barraDoVenue(INICIO, "101", "3", 2), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  // O venue mandou a barra do periodo: ela substituiu a nossa (e' o caso 2). Agora chega outro `bbo` do MESMO periodo.
  e.porEscrever = false; // se a agregacao mexer, volta a `true` — e' assim que se ve' que ela se calou
  agregarDoBbo(e, RELOGIO, 105, INICIO + 2_000);
  if (e.velas.length !== 1) problemas.push(`o bbo posterior nao pode criar barra nenhuma (veio ${e.velas.length})`);
  const b = barra(e, 0, problemas);
  if (b !== null) {
    if (b.c !== "101" || b.h !== "101" || b.l !== "101") {
      problemas.push(`a barra do VENUE foi MUTADA pelo bbo (o/h/l/c deviam ficar 101/101/101, veio ${b.o}/${b.h}/${b.l}/${b.c})`);
    }
    if (b.v !== "3" || b.n !== 2) problemas.push(`o v/n do venue nao se toca (veio ${JSON.stringify(b.v)}/${b.n})`);
    if (b.agregada_do_bbo !== undefined) problemas.push(`a marca da NOSSA agregacao nao se carimba numa barra do venue (veio ${JSON.stringify(b.agregada_do_bbo)})`);
  }
  if (e.porEscrever !== false) problemas.push("a agregacao tinha de se CALAR neste periodo: nada mudou, logo nada fica por escrever");
  registar("feed/a-agregacao-so-toca-em-barra-nossa-e-cala-se-no-periodo-do-venue", problemas);
}

// 2-c-bis. A TROCA DE DONO INTEIRA: derivado -> fonte -> derivado OUTRA VEZ (04/10/2026).
//      A pergunta do dono («o grafico tem um gap, sao duplicados?») mostrou a classe: a agregacao tem de saber
//      CALAR-SE quando a barra do venue chega, e VOLTAR a compor quando o periodo seguinte e' NOSSO outra vez. Sem
//      esta VOLTA, a agregacao ficava calada para sempre depois do primeiro `bbo` do periodo — e a tela perdia a
//      barra em curso. O controle esta' DENTRO: em N manda a FONTE (a barra do venue nao se toca) e em N+1 a
//      derivacao volta (marcada).
{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, RELOGIO, 100, INICIO + 1_000);                                                 // N: DERIVADA (marcada)
  encaixarVela(e, barraDoVenue(INICIO, "101", "3", 2), `${PAR}-${RELOGIO}`, RELOGIO, () => {});   // N: a FONTE manda
  agregarDoBbo(e, RELOGIO, 105, INICIO + PASSO + 1_000);                                         // N+1: DERIVADA outra vez
  if (e.velas.length !== 2) problemas.push(`a serie e' N (fonte) + N+1 (derivada): veio ${e.velas.length}`);
  const n = barra(e, 0, problemas);
  if (n !== null) {
    if (n.t !== INICIO) problemas.push(`a barra do venue fica no periodo dela (${INICIO}), veio ${n.t}`);
    if (n.c !== "101" || n.v !== "3") problemas.push(`a barra da FONTE nao se toca (veio ${JSON.stringify(n)})`);
    if (n.agregada_do_bbo !== undefined) problemas.push(`a marca da NOSSA agregacao nao se carimba na barra da fonte (veio ${JSON.stringify(n.agregada_do_bbo)})`);
  }
  const n1 = barra(e, 1, problemas);
  if (n1 !== null) {
    if (n1.t !== INICIO + PASSO) problemas.push(`o periodo seguinte tinha de voltar a ser derivado (${INICIO + PASSO}), veio ${n1.t}`);
    if (n1.agregada_do_bbo !== true) problemas.push("o periodo N+1 volta a ser DERIVADO e MARCADO (a derivacao nao fica calada para sempre)");
    if (n1.c !== "105") problemas.push(`a barra derivada de N+1 traz o ultimo preco (105), veio ${n1.c}`);
  }
  registar("feed/a-troca-de-dono-derivado-fonte-derivado-outra-vez", problemas);
}

// 2-d. INSERCAO FORA DE ORDEM (achado 2): a agregacao ja' abriu o periodo SEGUINTE e o venue manda o ANTERIOR.
//      E' a NOSSA agregada desse periodo que esta' la': o venue toma o LUGAR dela (a lista fica ordenada).
{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, RELOGIO, 100, INICIO + 1_000); // agregada do periodo N
  agregarDoBbo(e, RELOGIO, 101, INICIO + PASSO + 1_000); // agregada do periodo N+1 (o bbo da volta nova)
  const { linhas, dizer } = apanhar();
  encaixarVela(e, barraDoVenue(INICIO, "101", "3", 2), `${PAR}-${RELOGIO}`, RELOGIO, dizer);
  if (e.velas.length !== 2) problemas.push(`a barra atrasada entra NO LUGAR dela, nao acrescenta (veio ${e.velas.length})`);
  const n = barra(e, 0, problemas);
  if (n !== null) {
    if (n.t !== INICIO) problemas.push(`a barra do venue tinha de ficar no periodo dela (${INICIO}), veio ${n.t}`);
    if (n.v !== "3" || n.agregada_do_bbo !== undefined) problemas.push(`a NOSSA agregada do periodo tinha de dar lugar a' do venue (veio ${JSON.stringify(n)})`);
  }
  const seguinte = barra(e, 1, problemas);
  if (seguinte !== null) {
    if (seguinte.t !== INICIO + PASSO) problemas.push(`a barra seguinte tinha de continuar no fim (${INICIO + PASSO}), veio ${seguinte.t}`);
    if (seguinte.agregada_do_bbo !== true) problemas.push("a NOSSA agregada do periodo seguinte nao se toca (a barra do venue e' de outro periodo)");
  }
  const ts = e.velas.map((v) => v.t);
  if (!ts.every((t, i) => i === 0 || ts[i - 1]! < t)) problemas.push(`a lista tem de ficar ORDENADA por t, veio ${JSON.stringify(ts)}`);
  if (linhas.length !== 0) problemas.push(`o que ENTRA no lugar dele nao se nomeia (veio ${JSON.stringify(linhas)})`);
  registar("feed/a-barra-atrasada-do-venue-toma-o-lugar-da-nossa-agregada", problemas);
}

// 2-e. O BURACO QUE A AGREGACAO NAO PREENCHEU: o periodo do venue nao estava na lista — ela INSERE-SE ordenada.
{
  const problemas: string[] = [];
  const e = estadoVazio();
  encaixarVela(e, barraDoVenue(INICIO - PASSO, "99"), `${PAR}-${RELOGIO}`, RELOGIO, () => {}); // venue, N-1
  agregarDoBbo(e, RELOGIO, 101, INICIO + PASSO + 1_000); // a agregacao abre N+1 (N ficou em buraco)
  encaixarVela(e, barraDoVenue(INICIO, "100", "7", 4), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  if (e.velas.length !== 3) problemas.push(`a barra que preenche o buraco entra na lista (esperava 3, veio ${e.velas.length})`);
  const meio = barra(e, 1, problemas);
  if (meio !== null && (meio.t !== INICIO || meio.v !== "7")) problemas.push(`a barra tinha de entrar ENTRE N-1 e N+1 (veio ${JSON.stringify(meio)})`);
  const ts = e.velas.map((v) => v.t);
  if (!ts.every((t, i) => i === 0 || ts[i - 1]! < t)) problemas.push(`a lista tem de ficar ORDENADA por t, veio ${JSON.stringify(ts)}`);
  registar("feed/a-barra-atrasada-que-preenche-um-buraco-insere-se-ordenada", problemas);
}

// 2-f. CONTROLE NEGATIVO da insercao fora de ordem: mais ANTIGA do que a ultima FECHADA -> NOMEIA-SE, e nao entra.
//      Sem este par, «insere-se no lugar dela» podia querer dizer «acha sempre um lugar» — e reescrever historia.
{
  const problemas: string[] = [];
  const e = estadoVazio();
  encaixarVela(e, barraDoVenue(INICIO, "100"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  encaixarVela(e, barraDoVenue(INICIO + PASSO, "101"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  const antes = JSON.stringify(e.velas);
  const { linhas, dizer } = apanhar();
  encaixarVela(e, barraDoVenue(INICIO - PASSO, "999"), `${PAR}-${RELOGIO}`, RELOGIO, dizer);
  if (JSON.stringify(e.velas) !== antes) problemas.push("uma barra ANTERIOR a' ultima fechada nao pode entrar na lista");
  if (linhas.length !== 1) {
    problemas.push(`esperava UMA linha a nomear a barra descartada, veio ${linhas.length}`);
  } else {
    const l = linhas[0]!;
    if (l.veredicto !== "barra_atrasada_descartada") problemas.push(`o nome tinha de ser \`barra_atrasada_descartada\`, veio ${JSON.stringify(l.veredicto)}`);
    if (l.t !== INICIO - PASSO) problemas.push(`a linha tem de dizer o instante da barra descartada (${INICIO - PASSO}), veio ${l.t}`);
    if (l.ultima_fechada !== INICIO) problemas.push(`a linha tem de dizer a ultima fechada (${INICIO}), veio ${JSON.stringify(l.ultima_fechada)}`);
  }
  registar("feed/controle-a-barra-anterior-a-ultima-fechada-e-nomeada-e-nao-entra", problemas);
}

// ---------------------------------------------------------------------------------------------------------
// 3. O STREAM NAO TEM MEMORIA: o buraco e' NOMEADO, e nunca se inventa a barra que faltou.

{
  const problemas: string[] = [];
  const e = estadoVazio();
  encaixarVela(e, barraDoVenue(INICIO, "100"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  const { linhas, dizer } = apanhar();
  // O venue manda a barra 4 passos a' frente: 3 periodos inteiros passaram sem ninguem ouvir.
  encaixarVela(e, barraDoVenue(INICIO + 4 * PASSO, "104"), `${PAR}-${RELOGIO}`, RELOGIO, dizer);
  const buracos = linhas.filter((l) => l.veredicto === "buraco_no_historico");
  if (buracos.length !== 1) {
    problemas.push(`esperava UMA linha de buraco, veio ${buracos.length}`);
  } else {
    const b = buracos[0]!;
    if (b.par !== `${PAR}-${RELOGIO}`) problemas.push(`o buraco tem de dizer o par, veio ${JSON.stringify(b.par)}`);
    if (b.de !== INICIO) problemas.push(`o buraco comeca na ultima barra conhecida (${INICIO}), veio ${b.de}`);
    if (b.ate !== INICIO + 4 * PASSO) problemas.push(`o buraco acaba na barra que chegou (${INICIO + 4 * PASSO}), veio ${b.ate}`);
    if (b.faltam !== 3) problemas.push(`faltavam 3 barras, o aviso disse ${JSON.stringify(b.faltam)}`);
  }
  if (e.velas.length !== 2) {
    problemas.push(`as barras que faltaram NAO se inventam: esperava 2 (a antiga + a que chegou), veio ${e.velas.length}`);
  }
  const ultima = barra(e, 1, problemas);
  if (ultima !== null && ultima.t !== INICIO + 4 * PASSO) problemas.push("a barra que chegou tinha de ficar no fim, tal como veio");
  registar("feed/o-buraco-no-historico-e-nomeado-e-nunca-inventado", problemas);
}

// 3-b. CONTROLE: duas barras seguidas NAO produzem buraco nenhum.
{
  const problemas: string[] = [];
  const e = estadoVazio();
  encaixarVela(e, barraDoVenue(INICIO, "100"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  const { linhas, dizer } = apanhar();
  encaixarVela(e, barraDoVenue(INICIO + PASSO, "101"), `${PAR}-${RELOGIO}`, RELOGIO, dizer);
  if (linhas.length !== 0) problemas.push(`sem buraco nao ha aviso nenhum, veio ${JSON.stringify(linhas)}`);
  registar("feed/controle-a-barra-seguida-nao-avisa-de-buraco", problemas);
}

// ---------------------------------------------------------------------------------------------------------
// 4. A escrita ATOMICA: ficheiro novo + `rename`, e o historico fica intacto.

{
  const pasta = mkdtempSync(join(tmpdir(), "mesacore-feed-"));
  try {
    const problemas: string[] = [];
    const e = estadoVazio();
    encaixarVela(e, barraDoVenue(INICIO, "100"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
    encaixarVela(e, barraDoVenue(INICIO + PASSO, "101"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
    escreverVelas(pasta, PAR, RELOGIO, e, INICIO + 10_000);

    const caminho = caminhoDasVelas(pasta, PAR, RELOGIO);
    if (!existsSync(caminho)) problemas.push("o ficheiro das velas nao existe depois de escrito");
    if (existsSync(`${caminho}.a-escrever`)) problemas.push("o ficheiro temporario ficou para tras: nao houve troca de nome");
    if (e.porEscrever !== false) problemas.push("depois de escrever, o estado tem de ficar sem nada por escrever");
    if (e.escritoEm !== INICIO + 10_000) problemas.push(`o instante da escrita tinha de ficar gravado no estado, veio ${e.escritoEm}`);

    if (existsSync(caminho)) {
      const primeira = readFileSync(caminho, "utf8");
      const linhas = primeira.split("\n").filter((l) => l.trim() !== "");
      if (linhas.length !== 2) problemas.push(`esperava 2 linhas de velas, veio ${linhas.length}`);
      if (!primeira.endsWith("\n")) problemas.push("o ficheiro tem de fechar a ultima linha com quebra");

      // A SEGUNDA escrita: mais uma barra. O que la' estava fica BYTE A BYTE igual, e o inode MUDA (troca de nome).
      const inodeAntes = statSync(caminho).ino;
      const linhasAntes = linhas.slice();
      encaixarVela(e, barraDoVenue(INICIO + 2 * PASSO, "102"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
      escreverVelas(pasta, PAR, RELOGIO, e, INICIO + 20_000);
      const inodeDepois = statSync(caminho).ino;
      const linhasDepois = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "");

      if (linhasDepois.length !== 3) problemas.push(`a segunda escrita tinha de deixar 3 linhas, veio ${linhasDepois.length}`);
      for (let i = 0; i < linhasAntes.length; i++) {
        if (linhasDepois[i] !== linhasAntes[i]) problemas.push(`o historico nao ficou intacto na linha ${i}: ${linhasDepois[i]} != ${linhasAntes[i]}`);
      }
      if (inodeDepois === inodeAntes) {
        problemas.push(`o inode do ficheiro nao mudou (${inodeAntes}): isso e' uma reescrita NO SITIO, nao a troca de nome que a escrita atomica exige`);
      }
      if (existsSync(`${caminho}.a-escrever`)) problemas.push("o temporario da segunda escrita ficou para tras");
    }

    // O estado novo de um par LE^ o que ficou no disco — e' assim que o feed arranca.
    const lido = estadoDoPar(pasta, PAR, RELOGIO);
    if (lido.velas.length !== 3) problemas.push(`ao reler o ficheiro esperava 3 barras, veio ${lido.velas.length}`);
    registar("feed/a-escrita-e-atomica-e-o-historico-fica-intacto", problemas);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

// 4-b. CONTROLE: uma linha PARTIDA no ficheiro nao se adivinha — perde-se ela, e as boas ficam.
{
  const pasta = mkdtempSync(join(tmpdir(), "mesacore-feed-"));
  try {
    const problemas: string[] = [];
    const caminho = caminhoDasVelas(pasta, PAR, RELOGIO);
    writeFileSync(
      caminho,
      [JSON.stringify(barraDoVenue(INICIO, "100")), '{"t":1800000060000,"o":"101"', JSON.stringify(barraDoVenue(INICIO + 2 * PASSO, "102"))].join("\n") + "\n",
    );
    const lido = estadoDoPar(pasta, PAR, RELOGIO);
    if (lido.velas.length !== 2) problemas.push(`uma linha partida nao se adivinha: esperava 2 barras boas, veio ${lido.velas.length}`);
    const ultimaBoa = barra(lido, 1, problemas);
    if (ultimaBoa !== null && ultimaBoa.t !== INICIO + 2 * PASSO) problemas.push("a barra boa que vinha depois da partida tinha de sobreviver");
    registar("feed/controle-a-linha-partida-nao-se-adivinha", problemas);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------------
// 5. A PRIMEIRA barra de um par NOVO nao se deita fora (o historico esta' vazio, e a barra do venue e' o dado).

{
  const problemas: string[] = [];
  const e = estadoVazio();
  const doVenue = barraDoVenue(INICIO, "100", "12.5", 7);
  encaixarVela(e, doVenue, `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  if (e.velas.length !== 1) problemas.push(`a primeira barra de um par novo tem de ficar guardada (veio ${e.velas.length} barra(s))`);
  const b = barra(e, 0, problemas);
  if (b !== null && JSON.stringify(b) !== JSON.stringify(doVenue)) {
    problemas.push(`a barra guardada tem de ser a do venue, tal como veio: ${JSON.stringify(b)}`);
  }
  if (e.porEscrever !== true) problemas.push("guardar a barra tem de a deixar por escrever");
  // CONTROLE: a lista VAZIA nao pode ter virado «acrescenta tudo» — a ordem continua a mandar (um `t` menor e'
  // ignorado, mesmo depois de a primeira barra ter entrado por este ramo).
  const antes = JSON.stringify(e.velas);
  encaixarVela(e, barraDoVenue(INICIO - PASSO, "99"), `${PAR}-${RELOGIO}`, RELOGIO, () => {});
  if (JSON.stringify(e.velas) !== antes) problemas.push("depois da primeira barra, um `t` menor tem de continuar a ser ignorado");
  registar("feed/a-primeira-barra-de-um-par-novo-nao-se-deita-fora", problemas);
}

// ---------------------------------------------------------------------------------------------------------
// O passo do `1m` que esta bancada usa e' o do MODULO (nao um numero escrito aqui a mao).

{
  const problemas: string[] = [];
  const e = estadoVazio();
  agregarDoBbo(e, RELOGIO, 100, INICIO + 1_000);
  const b = barra(e, 0, problemas);
  if (b !== null && b.t !== INICIO) problemas.push(`o passo do \`${RELOGIO}\` do modulo nao e' o que esta bancada assume (${PASSO} ms)`);
  registar("feed/o-passo-do-relogio-vem-do-modulo-e-nao-da-bancada", problemas);
}

// ---------------------------------------------------------------------------------------------------------

for (const d of divergentes) console.log(d);

// A ULTIMA LINHA e' o placar, e sai pelo STDERR (a mesma convencao das bancadas deste recorte).
console.error(`feed: ${total} provas · ${ok} ok · ${divergentes.length} divergentes (esperado: 0)`);
process.exit(divergentes.length === 0 ? 0 : 1);
