/* ============================================================================================
 * A BARRA DE ESTADO — o que muda depressa, numa faixa só.
 *
 * Sem slogans e sem sopa de pílulas: dois selos (o ambiente e o estado da mesa) e o resto são NÚMEROS.
 * As IDADES ficam à vista e ficam VERMELHAS quando o dado envelhece — é o alarme mais barato que existe,
 * e era o que faltava quando a corrida parecia viva e já não estava.
 * ========================================================================================== */
import { estado, mesaAtual, mesas, escapar, dinheiro, desde, operacaoVelha, idadeDaOperacao, redesenho } from "./nucleo.js";

/** A idade que já merece alarme: o retrato devia ser refeito a cada minuto. */
const VELHO_RETRATO_MS = 300000;
const velho = (de, limite) => de !== null && de !== undefined && Date.now() - Number(de) > limite;

export function desenharFita() {
  const fita = document.getElementById("fita");
  const mesa = mesaAtual();
  if (!mesa) { fita.innerHTML = ""; return; }
  const conta = mesa.contas?.[0] ?? {};
  const instrumentos = conta.instrumentos ?? [];
  const ambiente = (mesa.identidade ?? "").includes("teste") ? "TESTE" : null;
  const armados = instrumentos.filter((i) => i.ficha?.enviar === true).length;
  const ligados = instrumentos.filter((i) => i.ficha?.run === true).length;
  const plugin = Array.isArray(mesa.plugin) ? mesa.plugin.join("/") : (mesa.plugin ?? "—");

  const opcoes = [
    `<option value="geral" ${estado.instalacao === "geral" ? "selected" : ""}>Geral (${mesas().length})</option>`,
    ...mesas().map((m) => `<option value="${escapar(m.instalacao)}" ${m.instalacao === estado.instalacao ? "selected" : ""}>${escapar(m.instalacao)}</option>`),
  ].join("");

  const tOperacao = operacaoVelha();
  const tRetrato = velho(estado.dados?.retrato?.gerado_em_ms, VELHO_RETRATO_MS);
  // O ESTADO DECLARADO, SEM O CONTRADIZER: a mesa diz «em operação» na última linha que gravou — se essa
  // linha é velha, o selo perde a cor viva e o `title` explica porquê. Antes o ecrã mostrava «em operação» a
  // verde ao lado de «sem dados há 3 h» a vermelho, e as duas coisas juntas liam-se como um erro do painel.
  const classeDoEstado = tOperacao ? "parado" : mesa.estado_da_mesa === "em_operacao" ? "vivo" : "parado";
  // A ATENÇÃO, calculada e dita no topo — é ela que responde aos 5 segundos. A ordem é a da gravidade:
  // sem dados > faltas do retrato > travados (que num sistema em observação é o estado NORMAL, e por isso
  // não se pinta de vermelho: gritar sempre é o mesmo que não gritar).
  const parados = estado.instalacao === "geral"
    ? (estado.dados?.geral?.parados ?? []).length
    : instrumentos.filter((i) => i.parado?.travado).length;
  const faltas = (estado.dados?.faltas ?? []).length;
  const atencao = tOperacao
    ? { classe: "teste", texto: `sem dados há ${desde(mesa.operacao_em_ms)}` }
    : faltas > 0
      ? { classe: "teste", texto: `${faltas} falta(s) do retrato` }
      : parados > 0
        ? { classe: "parado", texto: `${parados} travado(s)` }
        : { classe: "vivo", texto: "nada exige atenção" };

  fita.innerHTML = `
    <div class="marca">
      <span class="rot">MesaCore</span>
      <b class="corrida" title="${escapar(mesa.corrida ?? "")}">${escapar(mesa.instalacao)}</b>
      ${ambiente ? `<span class="selo teste sem-ponto">${ambiente}</span>` : ""}
      <span class="selo ${classeDoEstado}" title="${escapar(mesa.nota_da_operacao ?? "")}">${escapar(mesa.estado_da_mesa ?? "—")}</span>
      <span class="selo ${atencao.classe} atencao">${escapar(atencao.texto)}</span>
    </div>
    <div class="numeros-da-fita">
      <label class="numero seletor" title="qual instalação olhar"><span class="rot">instalação</span><select id="seletor-de-instalacao" aria-label="qual instalação olhar">${opcoes}</select></label>
      <span class="numero" title="equity da conta, como o venue a publica · fonte: ${escapar(mesa.fontes?.operacao?.caminho ?? "?")}"><span class="rot">equity</span><span class="val">${dinheiro(conta.equity)}</span></span>
      <span class="numero ciclos" title="ciclos da mesa nesta corrida · fonte: ${escapar(mesa.fontes?.registo?.caminho ?? "?")}"><span class="rot">ciclos</span><span class="val">${mesa.registo?.ciclos ?? "—"}</span></span>
      <span class="numero" title="ligação ao venue, reportada pelo protocolo"><span class="rot">lig</span><span class="val ${mesa.ligacao === "ligada" ? "" : "venda-txt"}">${escapar(mesa.ligacao ?? "—")}</span></span>
      <span class="numero pares" title="pares a rodar / pares armados para enviar"><span class="rot">pares</span><span class="val">${ligados}/${armados}</span></span>
      <span class="numero" title="o operador reescreve a operação a cada segundo; passado 1 min é dado velho · fonte: ${escapar(mesa.fontes?.operacao?.caminho ?? "?")}"><span class="rot">operação</span><span class="val ${operacaoVelha() ? "venda-txt" : ""}">${mesa.operacao_em_ms ? `há ${desde(mesa.operacao_em_ms)}` : "—"}</span></span>
      <span class="numero" title="o retrato completo (com o gráfico) renova a cada minuto"><span class="rot">retrato</span><span class="val ${velho(estado.dados?.retrato?.gerado_em_ms, VELHO_RETRATO_MS) ? "venda-txt" : ""}">há ${desde(estado.dados?.retrato?.gerado_em_ms)}</span></span>
      ${estado.dados?.agora ? `<span class="numero agora" title="o fio leve, renovado a cada 2 s"><span class="rot">agora</span><span class="val">há ${desde(estado.dados.agora.gerado_em_ms)}</span></span>` : ""}
      <button class="botao" id="recarregar">recarregar</button>
      <a class="botao" id="botao-config" href="#configuracao">config</a>
    </div>`;

  document.getElementById("recarregar").onclick = () => redesenho.recarregar();
  document.getElementById("seletor-de-instalacao").onchange = (e) => redesenho.trocarInstalacao(e.target.value);
}
