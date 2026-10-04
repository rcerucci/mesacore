/* ============================================================================================
 * POSIÇÕES VIVAS E ORDENS EM ABERTO — duas TABELAS, não um hero.
 *
 * Cinco colunas cada, 20 px por linha: PAR · LADO · TAMANHO · PREÇO · (marca/ordem). A decisão da mesa
 * que tocou aquela posição vai na última coluna, em CÓDIGO. Nada de frases: "não há" é uma linha cinzenta,
 * e uma tabela sem linhas custa 20 px, não 40.
 *
 * Em "Geral" a mesma tabela mostra todas as instalações — a coluna PAR passa a `instalação · par`.
 * ========================================================================================== */
import { estado, mesaAtual, mesas, escapar, comoVeio, acaoDita, motivoCurto, fonteEIdade } from "./nucleo.js";

/** A decisão da mesa sobre um par, procurada onde ela vive (a última linha de ciclo daquele par). */
function decisaoDe(instalacao, instrumento) {
  for (const m of mesas()) {
    if (m.instalacao !== instalacao) continue;
    return (m.contas?.[0]?.instrumentos ?? []).find((i) => i.instrumento === instrumento)?.ultima_decisao ?? null;
  }
  return null;
}

/** As três listas da fonte certa: o AGREGADO do fio (Geral) ou a mesa em vista. */
function asVivas() {
  const out = { posicoes: [], ordens: [], parados: [] };
  const geral = estado.instalacao === "geral";
  if (geral) {
    const g = estado.dados?.geral ?? {};
    for (const p of g.posicoes ?? []) out.posicoes.push({ ...p, decisao: decisaoDe(p.instalacao, p.instrumento) });
    for (const o of g.ordens_vivas ?? []) out.ordens.push(o);
    for (const p of g.parados ?? []) out.parados.push(p);
    return out;
  }
  const m = mesaAtual();
  if (!m) return out;
  for (const i of m.contas?.[0]?.instrumentos ?? []) {
    const base = { instalacao: m.instalacao, conta: i.conta, instrumento: i.instrumento, setup: i.ficha?.setup ?? null };
    if (i.leitura?.posicao) out.posicoes.push({ ...base, ...i.leitura.posicao, decisao: i.ultima_decisao });
    for (const o of i.leitura?.ordens_abertas ?? []) out.ordens.push({ ...base, ...o });
    if (i.parado?.travado) out.parados.push({ ...base, porque: i.parado.porque, desde_ms: i.parado.desde_ms, ciclos: i.parado.ciclos, estado_da_mesa: m.estado_da_mesa });
  }
  return out;
}

/** Em Geral a linha diz de que instalação é; numa instalação, o par basta. */
const etiqueta = (v) => estado.instalacao === "geral"
  ? `${escapar(v.instalacao)}<span class="fraco"> · ${escapar(v.instrumento)}</span>`
  : escapar(v.instrumento);

export function desenharVivas() {
  const caixa = document.getElementById("vivas-corpo");
  if (!caixa) return;
  const v = asVivas();

  const posicoes = v.posicoes.length === 0
    ? `<tr class="vazio"><td colspan="5">nenhuma posição viva</td></tr>`
    : v.posicoes.map((p) => `<tr title="marca ${escapar(String(p.marca_de_posse ?? "—"))}">
        <td>${etiqueta(p)}</td>
        <td><span class="lado ${p.lado === "buy" ? "compra" : "venda"}">${p.lado === "buy" ? "buy" : "sell"}</span></td>
        <td class="n">${comoVeio(p.unidades)}</td>
        <td class="n">${comoVeio(p.preco_medio)}</td>
        <td class="fraco" title="${escapar(p.decisao?.motivo ?? "")}">${escapar(acaoDita(p.decisao?.acao))}</td>
      </tr>`).join("");

  const ordens = v.ordens.length === 0
    ? `<tr class="vazio"><td colspan="5">nenhuma ordem em aberto</td></tr>`
    : v.ordens.map((o) => `<tr title="marca ${escapar(String(o.marca_de_posse ?? "—"))}">
        <td>${etiqueta(o)}</td>
        <td><span class="lado ${o.lado === "buy" ? "compra" : "venda"}">${o.lado === "buy" ? "buy" : "sell"}</span></td>
        <td class="n">${comoVeio(o.unidades)}</td>
        <td class="n">${comoVeio(o.preco)}</td>
        <td class="fraco">${escapar(o.ordem ?? "—")}</td>
      </tr>`).join("");

  // CINCO COLUNAS, e a MARCA SAIU para o `title` da linha: com seis colunas numa coluna de 306 px o cabeçalho
  // saía cortado («DECIS?») e a linha ficava uma papa. O que sobra é o que se lê de relance — par, lado,
  // tamanho, entrada, decisão —, e a marca (um marcador de posse, que se procura raramente) vive no rato.
  caixa.innerHTML = `
    <table class="tab">
      <thead><tr><th>par</th><th>lado</th><th class="n">tam</th><th class="n">entrada</th><th>decisão</th></tr></thead>
      <tbody>${posicoes}</tbody>
    </table>
    <table class="tab">
      <thead><tr><th>ordens</th><th>lado</th><th class="n">tam</th><th class="n">preço</th><th>ordem</th></tr></thead>
      <tbody>${ordens}</tbody>
    </table>`;

  // A contagem na cabeça do bloco: nada vivo é um zero, não uma frase. E ao lado, a FONTE e a idade do que a
  // tabela mostra: as posições e as ordens vivas vêm da leitura do venue, escrita na `operacao.json` da corrida.
  const parado = v.parados.length;
  document.getElementById("contagem-das-vivas").innerHTML =
    `${v.posicoes.length} pos · ${v.ordens.length} ord${parado > 0 ? ` · <span class="venda-txt">${parado} travados</span>` : ""}`;
  const fontes = estado.instalacao === "geral"
    ? mesas().map((m) => m.fontes?.operacao).filter(Boolean)
    : [mesaAtual()?.fontes?.operacao].filter(Boolean);
  const alvo = document.getElementById("fonte-das-vivas");
  if (alvo) alvo.innerHTML = fontes.map((f) => fonteEIdade(f)).join(" · ");
}
