/* ============================================================================================
 * O REGISTO — o ledger da mesa, em tabelas densas: os ciclos por par, o MANDATO, o carteiro e o que
 * saiu para o venue. As FALTAS só aparecem quando existem (uma lista de "nenhuma" é uma linha a dizer
 * nada, e um terminal não paga por isso).
 * ========================================================================================== */
import { estado, escapar, hora, instrumentoAtual, mesaAtual, fonteEIdade } from "./nucleo.js";

export function desenharRegistoEFaltas() {
  const mesa = mesaAtual();
  const el = document.getElementById("registo");
  if (!mesa) { el.innerHTML = ""; return; }
  const r = mesa.registo ?? {};
  const par = instrumentoAtual();

  document.getElementById("contagem-do-registo").innerHTML = `${r.linhas ?? 0} linhas · ${r.ciclos ?? 0} ciclos`;
  // A FONTE: o registo (ciclos, mandato) vem do `registo.jsonl` e o carteiro/o que o setup disse vêm do
  // `operador.log` — as duas fontes, com as suas idades, ditas na cabeça do bloco.
  const alvoDaFonte = document.getElementById("fonte-do-registo");
  if (alvoDaFonte) {
    alvoDaFonte.innerHTML = [mesa.fontes?.registo, mesa.fontes?.operador_log].filter(Boolean).map((f) => fonteEIdade(f)).join(" · ");
  }

  const desfechos = mesa.saiu_para_o_venue?.desfechos ?? [];
  const marc = mesa.saiu_para_o_venue?.marcas_de_posse ?? [];
  const ciclosDoPar = Object.entries(par?.decisao_contagem ?? {});

  el.innerHTML = `
    <table class="tab">
      <thead><tr><th>${escapar(par?.instrumento ?? "par")} · ação:motivo</th><th class="n">n</th></tr></thead>
      <tbody>${ciclosDoPar.map(([m, c]) => `<tr><td class="fraco quebra">${escapar(m)}</td><td class="n">${c}</td></tr>`).join("") || `<tr class="vazio"><td colspan="2">—</td></tr>`}</tbody>
    </table>
    <table class="tab">
      <thead><tr><th>mandato</th><th>par</th><th class="n">de → para</th></tr></thead>
      <tbody>${(r.mandato ?? []).map((m) => `<tr><td class="fraco">${hora(m.instante_ms)}</td><td>${escapar(m.instrumento)}</td><td class="n fraco">${escapar(m.de)} → ${escapar(m.para)}</td></tr>`).join("") || `<tr class="vazio"><td colspan="3">sem mudanças de mandato</td></tr>`}</tbody>
    </table>
    <table class="tab">
      <thead><tr><th>carteiro · ${mesa.carteiro?.passagens ?? 0} passagens</th><th class="n">n</th></tr></thead>
      <tbody>${Object.entries(mesa.carteiro?.por_que_nao_saiu ?? {}).map(([m, c]) => `<tr><td class="fraco">${escapar(m)}</td><td class="n">${c}</td></tr>`).join("") || `<tr class="vazio"><td colspan="2">nenhuma boleta retida</td></tr>`}</tbody>
    </table>
    <table class="tab">
      <thead><tr><th>saiu para o venue</th><th class="n">n</th></tr></thead>
      <tbody>
        ${desfechos.map((d) => `<tr><td class="fraco">${escapar(d.ficheiro)}</td><td class="n">${d.quantos}</td></tr>`).join("")}
        ${marc.map((m) => `<tr><td class="fraco">${escapar(m.ficheiro)}</td><td class="n">${m.quantas}</td></tr>`).join("")}
        ${desfechos.length + marc.length === 0 ? `<tr class="vazio"><td colspan="2">nada submetido nesta corrida</td></tr>` : ""}
      </tbody>
    </table>
    <dl class="pares">
      <dt title="${escapar(mesa.nota_da_operacao ?? "")}">corrida</dt><dd class="fraco">${escapar(String(mesa.corrida ?? "—").split("/").filter(Boolean).pop() ?? "—")}</dd>
      <dt title="como as instalações foram escolhidas">critério</dt><dd class="fraco">${escapar(estado.dados?.retrato?.descoberta ?? "—")}</dd>
    </dl>`;

  // AS FALTAS: só existem quando existem.
  const faltas = estado.dados?.faltas ?? [];
  document.getElementById("faltas").innerHTML = faltas.length === 0
    ? ""
    : `<div class="mini fraco" style="padding:2px 8px">faltas do retrato — o que não se conseguiu ler, dito:</div>` +
      faltas.map((f) => `<div class="falta"><b>${escapar(f.o_que)}</b><span class="fraco">${escapar(f.porque)}</span></div>`).join("");
}
