/* ============================================================================================
 * OS PARES — uma MATRIZ, não cartões.
 *
 * Uma linha por par, 21 px, três colunas: PAR (com o relógio e a seta da virada) · PREÇO · ESTADO.
 * O detalhe que não cabe aqui (posição, decisão, risco, contagem de ciclos) vive nas OUTRAS colunas do
 * terminal e na matriz do rodapé — aqui é só a escolha de qual par se está a olhar.
 * ========================================================================================== */
import { estado, escapar, comoVeio, ladoDoSig, instrumentosAtuais, mesaAtual, operacaoVelha, idadeDaOperacao, redesenho } from "./nucleo.js";

/** Um par escolhido redesenha o que dele depende. */
function escolher(par) {
  estado.selecionado = par;
  redesenho.tudo();
}

export function desenharPares() {
  const instrumentos = instrumentosAtuais();
  const caixa = document.getElementById("lista-de-pares");
  const velho = operacaoVelha();
  const idade = idadeDaOperacao();
  // A IDADE DO DADO VAI ONDE ELE APARECE: a coluna mostra PREÇOS, e um preço sem idade parece vivo. O cabeçalho
  // da coluna diz a FONTE e há quanto tempo o dado foi lido, e o preço perde a cor quando está velho.
  const fonte = mesaAtual()?.fontes?.operacao?.caminho ?? "?";
  document.getElementById("contagem-de-pares").innerHTML =
    `${instrumentos.length}${idade ? ` · <span class="${velho ? "venda-txt" : "fraco"}" title="fonte: ${escapar(fonte)}">dado ${escapar(idade)}</span>` : ""}`;

  caixa.innerHTML = `
    <div class="lh"><span class="rot">Par</span><span class="rot" style="text-align:right">Preço</span><span></span></div>
    ${instrumentos.map((i) => {
      const l = i.leitura ?? {};
      const ultimoPonto = (i.serie_do_setup ?? [])[(i.serie_do_setup ?? []).length - 1] ?? null;
      // O LADO VIGENTE VEM DA SÉRIE — a conta do PRÓPRIO setup sobre a barra que decidiu.
      const sig = ultimoPonto?.sig ?? null;
      const virou = ultimoPonto?.virada ? ultimoPonto.virada : 0;
      const f = i.ficha ?? {};
      const titulo = [
        `relógio ${f.relogio ?? "?"}`,
        `rodar ${f.run ? "sim" : "não"} · enviar ${f.enviar ? "sim" : "não"}`,
        `posição ${l.posicao ? `${l.posicao.lado} ${comoVeio(l.posicao.unidades)} @ ${comoVeio(l.posicao.preco_medio)}` : "nenhuma"}`,
        `ordens vivas ${(l.ordens_abertas ?? []).length}`,
        i.parado?.travado ? `travado: ${i.parado.porque} (há ${i.parado.ciclos} ciclos)` : "sem trava",
        idade ? `esta leitura é de ${idade}` : "sem idade de leitura",
      ].join(" · ");
      return `
      <div class="lr" role="option" data-par="${escapar(i.instrumento)}" aria-selected="${i.instrumento === estado.selecionado}" tabindex="0" title="${escapar(titulo)}">
        <span class="par">${escapar(i.instrumento)}
          <span class="fraco mono" style="font-size:10px">${escapar(f.relogio ?? "")}</span>
          ${virou !== 0 ? `<span class="glifo ${virou === 1 ? "tri-cima" : "tri-baixo"}" title="o indicador virou nesta barra"></span>` : ""}
          ${i.parado?.travado ? `<span class="venda-txt" title="travado: ${escapar(i.parado.porque ?? "")}">•</span>` : ""}
        </span>
        <span class="preco ${velho ? "fantasma" : ""}" title="${idade ? `leitura de ${escapar(idade)}` : ""}">${comoVeio(l.ultimo ?? l.bid)}</span>
        <span class="estado"><span class="lado ${ladoDoSig(sig)}" title="lado vigente, do indicador">${sig === 1 ? "L" : sig === -1 ? "S" : "—"}</span></span>
      </div>`;
    }).join("")}`;

  for (const b of caixa.querySelectorAll(".lr")) {
    b.onclick = () => escolher(b.dataset.par);
    b.onkeydown = (e) => { if (e.target === b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); escolher(b.dataset.par); } };
  }
}
