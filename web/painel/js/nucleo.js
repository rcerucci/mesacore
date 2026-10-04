/* ============================================================================================
 * NUCLEO — o que é de TODOS os painéis: a cor, os formatos, o estado, e o que recolhe.
 *
 * Este módulo NÃO desenha nada e NÃO importa nenhum outro. É a base de que os desenhadores
 * (fita, posições, gráfico, dentro, registo, configuração, telefone) dependem — e é por isso
 * que ele não pode depender deles: quem precisa de mandar redesenhar usa o `redesenho`, que o
 * `arranque` preenche uma só vez. Um módulo, uma responsabilidade.
 * ========================================================================================== */

/* ---------------------------------------------------------------------------
 * A COR VEM DO DOCUMENTO, NÃO DO JAVASCRIPT.
 *
 * Um canvas não lê custom properties: se o gráfico tivesse os seus hexes, o tema
 * passaria a ter duas paletas e uma delas não mudava. `cor()` resolve a variável
 * ATRAVÉS do motor de estilo (escreve-a num `color` e lê o resultado), e é assim
 * que os derivados por `color-mix(...)` também chegam ao gráfico.
 *
 * MAS O QUE O MOTOR DEVOLVE NÃO SERVE A TODA A GENTE — e isto foi medido, com o
 * preço de uma tela inteira em branco: para um `color-mix` o `getComputedStyle`
 * devolve a forma moderna `color(srgb 0.31 0.82 0.75 / 0.5)`, e a biblioteca do
 * gráfico (que valida cor com uma expressão regular de `rgb()/rgba()`) RECUSA-A —
 * `Failed to parse color: color(srgb …)`. A excepção rebentava dentro do desenho,
 * a meio, e o painel mostrava o rectângulo vazio com a legenda por baixo: o
 * sintoma era "sem dados", a causa era uma COR.
 * ------------------------------------------------------------------------- */
const sonda = document.createElement("span");
sonda.style.display = "none";
document.body.appendChild(sonda);
/** `color(srgb r g b [/ a])` -> `rgb()/rgba()`. O resto (`rgb`, `rgba`, `#hex`) já vem na forma que a lib lê. */
export function normalizarCor(bruto) {
  const m = /^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\s*\)$/.exec(String(bruto).trim());
  if (m === null) return bruto;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.round(Number(x) * 255));
  return m[4] === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(m[4])})`;
}
export function cor(nome) {
  sonda.style.color = `var(${nome})`;
  return normalizarCor(getComputedStyle(sonda).color);
}

/* ============================ OS FORMATOS =============================== */
export const escapar = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const n = (x) => (x === null || x === undefined || x === "" ? null : Number(x));
export const dinheiro = (x, casas = 2) => (n(x) === null ? "—" : n(x).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
/** O preço vai como o venue o publicou (texto). Arredondar aqui era perder o algarismo que decide. */
export const comoVeio = (x) => (x === null || x === undefined || x === "" ? "—" : String(x));
export const hora = (ms) => (ms === null || ms === undefined ? "—" : new Date(Number(ms)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
export const diaEHora = (ms) => (ms === null || ms === undefined ? "—" : new Date(Number(ms)).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
export const idade = (ms) => (ms === null || ms === undefined ? "—" : `${(Number(ms) / 1000).toFixed(1)} s`);
export const desde = (ms) => {
  const s = Math.max(0, (Date.now() - Number(ms)) / 1000);
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} dias`;
};
export const ladoDoSig = (sig) => (sig === 1 ? "compra" : sig === -1 ? "venda" : "neutro");
export const ladoDaPosicao = (lado) => (lado === "buy" ? "comprado" : lado === "sell" ? "vendido" : String(lado ?? "—"));

/* ============================ A FONTE E A IDADE DE CADA BLOCO ============================
 * UM NÚMERO SEM A FONTE E SEM A HORA NÃO SERVE PARA DECIDIR. Medido (03/10/2026): a secção MERCADO mostrava
 * `lido: há 7,6 h` sem dizer de que corrida nem de que ficheiro vinha, e o dono perguntou — com razão — se aquilo
 * era do venue, da corrida errada ou simplesmente velho. Era velho, e a tela não o dizia.
 *
 * O fio passa a trazer, por bloco, a FONTE (o caminho do ficheiro que o alimenta) e a data dele (`em_ms`). A
 * idade calcula-se AQUI, do instante absoluto — e não da idade que o fio trouxe, que envelhece com ele: o ciclo
 * de 2 s repinta os números e a idade tem de acompanhar. Um bloco cuja fonte não exista diz `sem ficheiro`, nunca
 * um vazio com cara de zero.
 */
const BLOCO_VELHO_MS = 300000;   // 5 min: a operação devia ser reescrita a cada segundo
export function fonteEIdade(fonte, limite = BLOCO_VELHO_MS) {
  if (fonte === null || fonte === undefined || typeof fonte !== "object") return "";
  const caminho = String(fonte.caminho ?? "?");
  // O NOME DO FICHEIRO, e não o caminho inteiro: a cabeça de um bloco de 306 px não tem largura para o caminho
  // todo, e o que o cortava era a IDADE — que é o que interessa. O caminho inteiro e a hora exacta vão no `title`.
  const nome = escapar(caminho.split("/").pop());
  if (fonte.em_ms === null || fonte.em_ms === undefined) {
    return `<span class="fonte mono fraco" title="a fonte não foi encontrada: ${escapar(caminho)}">${nome} · sem ficheiro</span>`;
  }
  const velho = Date.now() - Number(fonte.em_ms) > limite;
  return `<span class="fonte mono ${velho ? "venda-txt" : "fraco"}" title="fonte: ${escapar(caminho)} · escrito ${diaEHora(fonte.em_ms)}">${nome} · ${escapar(desde(fonte.em_ms))}</span>`;
}

/* ============================ OS MOTIVOS, DITOS EM PORTUGUÊS ============ *
 * O motivo cru (`proposta_ausente_tratada_como_hold`) é a prova, e vai sempre no `title`. Mas quem abre a tela
 * não lê chaves: ao lado vai a frase. Duas formas — a LONGA (para a lista do que está parado) e a CURTA (para
 * o cartão de 208 px, onde a longa não cabe).
 */
const MOTIVOS = {
  proposta_ausente_tratada_como_hold: "o setup não propôs nada nesta volta (espera)",
  proposta_sem_lado_a_executar: "o setup propôs, mas sem lado a executar",
  proposta_de_barra_antiga: "a proposta era de uma barra já fechada — não se abre no meio da perna",
  reversao_sem_posicao_a_reverter: "pediu-se uma reversão, mas não havia posição para reverter",
  reduzido_a_caixa_por_regra: "a posição foi fechada por regra",
  sem_leitura: "o conector não conseguiu ler este instrumento",
  sem_ligacao: "sem ligação ao venue — a mesa não abre",
  travado_por_banda: "o valor cai fora da banda declarada na ficha",
};
const MOTIVOS_CURTOS = {
  proposta_ausente_tratada_como_hold: "sem proposta",
  proposta_sem_lado_a_executar: "sem lado",
  proposta_de_barra_antiga: "barra antiga",
  reversao_sem_posicao_a_reverter: "sem posição a reverter",
  reduzido_a_caixa_por_regra: "fechada por regra",
  sem_leitura: "sem leitura",
  sem_ligacao: "sem ligação",
};
export const motivoDito = (m) => (m === null || m === undefined ? "sem motivo declarado" : (MOTIVOS[m] ?? m));
export const motivoCurto = (m) => (m === null || m === undefined ? "travado" : (MOTIVOS_CURTOS[m] ?? m));
export const acaoDita = (a) => ({ abrir: "abriu", fechar: "fechou", reverse: "inverteu", adoptar: "adoptou", nada: "nada" }[a] ?? a ?? "—");

/* ============================ O ESTADO ================================== *
 * UM SÓ ESTADO, para toda a tela. `instalacao` é QUAL das N corridas se está a olhar (o seletor);
 * `dados` é o fio (`painel.json` + o `agora` do `vivo.json`). Nada disto vive no DOM, que é
 * reescrito a cada volta.
 */
export const estado = {
  dados: null,
  selecionado: null,   // o instrumento (par) escolhido
  instalacao: null,    // a instalação (corrida) escolhida, ou "geral"
};

/** O ponto de encontro entre o que desenha e o que guarda o estado. O `arranque` preenche isto
 *  UMA vez; nenhum desenhador importa outro, e por isso não há ciclos de importação. */
export const redesenho = {
  tudo() {},
  numeros() {},
  reencaixar() {},
  repintarGrafico() {},
  recarregar() {},
  trocarInstalacao() {},
};

/* ============================ OS ERROS DO PRÓPRIO GESTO ================= *
 * Uma excepção dentro de um `listener` não sobe para quem chamou: fica na consola e o ecrã mostra só
 * a metade que correu. Este ouvinte guarda os erros em `window.__erros` — e a barra do rodapé
 * mostra-os quando existem, em vez de a tela ficar calada sobre o que falhou.
 */
window.__erros = [];
addEventListener("error", (e) => window.__erros.push(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
addEventListener("unhandledrejection", (e) => window.__erros.push(`promessa recusada: ${e.reason && e.reason.message ? e.reason.message : String(e.reason)}`));

/* ============================ A INSTALAÇÃO E O PAR ====================== */

/** As mesas do fio. A tela nunca muda de forma por haver uma ou cinco. */
export const mesas = () => estado.dados?.mesas ?? [];
/** A mesa EM VISTA: a escolhida no seletor, ou a primeira. `"geral"` não é uma mesa. */
export function mesaAtual() {
  const ms = mesas();
  if (estado.instalacao && estado.instalacao !== "geral") return ms.find((m) => m.instalacao === estado.instalacao) ?? ms[0] ?? null;
  return ms[0] ?? null;
}
export function instrumentosAtuais() {
  const m = mesaAtual();
  return m?.contas?.[0]?.instrumentos ?? [];
}
export const instrumentoAtual = () =>
  instrumentosAtuais().find((i) => i.instrumento === estado.selecionado) ?? instrumentosAtuais()[0] ?? null;

/* -------------------------------------------------------------------------------------------- a IDADE do dado
 * A operação devia ser reescrita a cada segundo pelo operador. Passado um minuto, TUDO o que a tela mostra dela
 * (preço, posição, decisão) é dado VELHO — e o ecrã tem de o dizer em cada sítio onde o número aparece, senão um
 * preço de três horas lê-se como um preço de agora. Era este o defeito: a barra dizia «operação há 3 h» e a
 * matriz de pares mostrava o preço com a mesma cara de um preço vivo. */
export const OPERACAO_VELHA_MS = 60000;
export function operacaoVelha() {
  const m = mesaAtual();
  if (m?.operacao_em_ms === null || m?.operacao_em_ms === undefined) return false;
  return Date.now() - Number(m.operacao_em_ms) > OPERACAO_VELHA_MS;
}
export function idadeDaOperacao() {
  const m = mesaAtual();
  return m?.operacao_em_ms ? `há ${desde(m.operacao_em_ms)}` : null;
}

/* ================== O QUE RECOLHE, E POR QUÊ (um só estado) ============= *
 * TUDO RECOLHE, e o estado é UM SÓ — um conjunto de chaves no `localStorage`, com o prefixo a dizer
 * que espécie de coisa cada chave é (`par:BTC`, `bloco:grafico`, `secao:dentro:risco`). O que
 * "recolhido" esconde muda de forma para forma, e cada forma tem a sua regra no CSS — mas quem
 * guarda a escolha é o mesmo sítio.
 *
 * A OMISSÃO É GRAVADA, E NÃO DEDUZIDA: tratar "não há chave" como "recolhido" fazia recolher UM par
 * abrir TODOS os outros (ao mexer num cartão a chave passava a existir). O estado é explícito desde
 * o primeiro desenho.
 */
const CHAVE_DO_RECOLHIDO = "mesacore.painel.recolhidos.v3";
/** As omissões, ditas em voz alta: no terminal tudo abre (a densidade é o ponto) — só a LEITURA do setup
 *  começa recolhida, porque é a que menos se olha. */
export const OMISSOES = { vivas: false, matriz: false, leitura: false, registo: false };
function lerRecolhidos() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_DO_RECOLHIDO) ?? "null");
    return { conjunto: new Set(Array.isArray(guardado) ? guardado : []), jaGravado: Array.isArray(guardado) };
  } catch {
    return { conjunto: new Set(), jaGravado: false };
  }
}
const doStorage = lerRecolhidos();
export const recolhidos = doStorage.conjunto;
export function gravarRecolhidos() {
  try { localStorage.setItem(CHAVE_DO_RECOLHIDO, JSON.stringify([...recolhidos])); } catch { /* sem storage, segue sem gravar */ }
}
let omissaoJaAplicada = doStorage.jaGravado;
export function aplicarAsOmissoes() {
  if (omissaoJaAplicada) return;
  for (const [chave, fechado] of Object.entries(OMISSOES)) if (fechado) recolhidos.add(chave);
  gravarRecolhidos();
  omissaoJaAplicada = true;
}
export const estaRecolhido = (chave) => recolhidos.has(chave);
/** O gesto: uma chave, e o estado dela. Uma só função para todos os botões da tela. */
export function alternarRecolhido(chave) {
  const eraGrafico = chave === "bloco:grafico";
  if (recolhidos.has(chave)) {
    recolhidos.delete(chave);
  } else {
    // NÃO SE ESCONDE O QUE NÃO SE SABE REABRIR: o mesmo invariante do `aplicarOsEstadosDeRecolher`, aqui no
    // gesto — recolher uma secção cujo botão ficaria escondido é recusado, e o defeito é dito.
    const el = document.querySelector(`[data-recolhivel='${CSS.escape(chave)}']`);
    if (el !== null && !podeRecolher(el)) dizerODefeito(chave);
    else recolhidos.add(chave);
  }
  gravarRecolhidos();
  aplicarOsEstadosDeRecolher();
  if (eraGrafico && !estaRecolhido(chave)) redesenho.repintarGrafico();
  redesenho.reencaixar(); // a altura do que está por cima do gráfico pode ter mudado: mede-se de novo
}
/** Põe o estado guardado em cada contentor que se recolhe (a classe é o que o CSS lê). */
export function aplicarOsEstadosDeRecolher() {
  for (const el of document.querySelectorAll("[data-recolhivel]")) {
    const chave = el.dataset.recolhivel;
    const querRecolhido = estaRecolhido(chave);
    // O INVARIANTE, EM COMPORTAMENTO: uma secção SÓ recolhe se o botão que a abre sobreviver ao recolhimento.
    // Ver `podeRecolher`, abaixo, para o porquê (é a diferença entre «feia» e «tela perdida»).
    if (querRecolhido && !podeRecolher(el)) {
      el.classList.remove("recolhido");
      dizerODefeito(chave);
    } else {
      el.classList.toggle("recolhido", querRecolhido);
    }
    for (const b of el.querySelectorAll("[data-alternar='" + chave + "']")) {
      b.setAttribute("aria-expanded", String(!querRecolhido));
      b.title = querRecolhido ? "abrir" : "recolher (deixar só o principal)";
      const g = b.querySelector(".glifo.chevron");
      if (g) g.classList.toggle("aberto", !querRecolhido);
    }
  }
}

/* ---------- O INVARIANTE DO QUE RECOLHE — em COMPORTAMENTO, nunca num comentário de CSS ----------------
 * A regra de CSS conserva a CABEÇA DECLARADA (`.cabeca`, e os `header`/`h4` que já existiam) e esconde o
 * resto. Isso é uma promessa escrita num sítio que ninguém testa: a secção NOVA que nasça com a cabeça fora da
 * forma (um `<h3>` sem `.cabeca`, ou o botão FORA da cabeça) recolhe e DESAPARECE com o botão de abrir dentro
 * do que se escondeu — medido a 03/10/2026: o dono recolheu e perdeu a tela, sem forma de a reabrir.
 *
 * Aqui o invariante passa a comportamento: o que abre uma secção (`[data-alternar]`) tem de viver num filho
 * que a regra CONSERVA. Se não viver, a secção NÃO recolhe — ficar aberta é feio, ficar sem forma de reabrir é
 * perder a tela — e o defeito é DITO (em `window.__erros` e na barra de faltas): quem a escreveu vê-o, e a
 * prova `tools/painel/prova-do-recolhido.ts` reprova-o, em vez de o dono o descobrir a usar o painel.
 */
const CABECAS_QUE_O_CSS_CONSERVA = ".cabeca, header, h4";
/** O elemento que abre uma secção recolhível (o `[data-alternar]` com a chave dela). */
export function oQueAbre(el) {
  const chave = el.dataset.recolhivel;
  return chave ? el.querySelector(`[data-alternar='${CSS.escape(chave)}']`) : null;
}
/** O botão que abre esta secção sobrevive ao recolhimento? (vive num filho que o CSS conserva) */
export function podeRecolher(el) {
  const b = oQueAbre(el);
  if (b === null) return false; // sem botão não há reabertura: recolher seria a secção a desaparecer para sempre
  return Array.from(el.children).some((f) => f.matches(CABECAS_QUE_O_CSS_CONSERVA) && f.contains(b));
}
function dizerODefeito(chave) {
  const aviso = `secção «${chave}»: NÃO recolheu — recolhida ficaria sem o botão que a abre (a cabeça declara-se com a classe .cabeca, e o [data-alternar] vive DENTRO dela)`;
  if (!window.__erros.includes(aviso)) window.__erros.push(aviso);
}
/**
 * O BOTÃO DE RECOLHER, um só construtor para todos os sítios.
 * O `stopPropagation` é essencial no cartão de um par (que é clicável por inteiro): sem ele, recolher
 * o cartão escolhia o par.
 */
export function botaoDeRecolher(chave, rotulo) {
  const fechado = estaRecolhido(chave);
  return `<button type="button" class="abre-o-card" data-alternar="${escapar(chave)}" aria-expanded="${!fechado}"
    title="${fechado ? "abrir" : "recolher"}" aria-label="${escapar(rotulo)}: ${fechado ? "abrir" : "recolher"}">
    <i class="glifo chevron ${fechado ? "" : "aberto"}"></i>
  </button>`;
}
export function ligarOsBotoesDeRecolher() {
  for (const b of document.querySelectorAll("[data-alternar]")) {
    b.onclick = (e) => { e.stopPropagation(); alternarRecolhido(b.dataset.alternar); };
  }
}
