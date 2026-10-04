/* ============================================================================================
 * A MATRIZ DE ESTADO — um par por linha, e o que o trava numa COLUNA.
 *
 * É a peça que substitui os parágrafos: "o setup não propôs nada nesta volta (espera)" deixa de ser uma
 * frase de 40 px e passa a um CÓDIGO numa coluna, com o texto no `title`. Oito colunas fixas — par · lado ·
 * rodar · enviar · trava · ciclos · desde — e uma linha cinzenta quando a coluna não tem nada.
 * ========================================================================================== */
import { estado, mesas, escapar, hora, desde, ladoDoSig, motivoCurto, fonteEIdade } from "./nucleo.js";

export function desenharMatriz() {
  const caixa = document.getElementById("matriz");
  if (!caixa) return;
  const geral = estado.instalacao === "geral";
  const linhas = [];
  for (const m of mesas()) {
    if (!geral && m.instalacao !== estado.instalacao) continue;
    for (const i of m.contas?.[0]?.instrumentos ?? []) {
      const ultimoPonto = (i.serie_do_setup ?? [])[(i.serie_do_setup ?? []).length - 1] ?? null;
      linhas.push({ m, i, sig: ultimoPonto?.sig ?? null });
    }
  }

  const corpo = linhas.length === 0
    ? `<tr class="vazio"><td colspan="7">nenhum par nesta instalação</td></tr>`
    : linhas.map(({ m, i, sig }) => {
      const p = i.parado ?? {};
      const f = i.ficha ?? {};
      return `<tr class="${p.travado ? "parado" : ""}">
        <td>${geral ? `${escapar(m.instalacao)}<span class="fraco"> · </span>` : ""}<b>${escapar(i.instrumento)}</b> <span class="fraco" style="font-size:10px">${escapar(f.relogio ?? "")}</span></td>
        <td><span class="lado ${ladoDoSig(sig)}">${sig === 1 ? "L" : sig === -1 ? "S" : "—"}</span></td>
        <td class="${f.run ? "" : "fantasma"}">${f.run ? "sim" : "não"}</td>
        <td class="${f.enviar ? "" : "fantasma"}">${f.enviar ? "sim" : "não"}</td>
        <td title="${escapar(p.porque ?? "sem trava declarada")}">${(p.ciclos ?? 0) > 0 ? (p.travado ? `<span class="venda-txt">${escapar(motivoCurto(p.porque))}</span>` : `<span class="fraco">${escapar(motivoCurto(p.porque))}</span>`) : "—"}</td>
        <td class="n">${(p.ciclos ?? 0) > 0 ? escapar(p.ciclos) : "—"}</td>
        <td class="n fraco">${(p.ciclos ?? 0) > 0 && p.desde_ms ? `há ${desde(p.desde_ms)}` : "—"}</td>
      </tr>`;
    }).join("");

  caixa.innerHTML = `
    <table class="tab">
      <thead><tr><th>par</th><th>lado</th><th>rodar</th><th>enviar</th><th>trava</th><th class="n">ciclos</th><th class="n">travado desde</th></tr></thead>
      <tbody>${corpo}</tbody>
    </table>`;

  // A CONTAGEM SEPARA AS DUAS NATUREZAS: `travado` (precisa do dono, a vermelho) e «à espera de sinal» (o estado
  // NORMAL de um sistema em observação, em tom neutro). Contá-las juntas era o que fazia o painel dizer «3 travados»
  // com um par a operar (ver `travado.ts`).
  const deAtencao = linhas.filter((x) => x.i.parado?.classe === "atencao").length;
  const deEspera = linhas.filter((x) => (x.i.parado?.ciclos ?? 0) > 0 && x.i.parado?.classe !== "atencao").length;
  document.getElementById("contagem-da-matriz").innerHTML =
    `${linhas.length} par(es)` +
    (deAtencao > 0 ? ` · <span class="venda-txt">${deAtencao} travado(s)</span>` : "") +
    (deEspera > 0 ? ` · <span class="fraco">${deEspera} à espera de sinal</span>` : "");
  // A FONTE: o que trava (e o lado vigente) sai do `registo.jsonl` da corrida — a matriz di-lo, com a idade.
  const daMatriz = document.getElementById("fonte-da-matriz");
  if (daMatriz) {
    const fontes = (geral ? mesas() : mesas().filter((m) => m.instalacao === estado.instalacao)).map((m) => m.fontes?.registo).filter(Boolean);
    daMatriz.innerHTML = fontes.map((f) => fonteEIdade(f)).join(" · ");
  }
}
