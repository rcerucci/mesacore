/* ============================================================================================
 * O LADO DE DENTRO — o mercado, o RISCO EM VIGOR e as decisões contadas do par em vista.
 *
 * Tudo em `dl` de duas colunas, sem parágrafos. O que era a nota do livro é um `title` na linha do
 * livro: quem precisa do porquê passa o rato e lê; quem não precisa não lhe paga 100 px de ecrã.
 * ========================================================================================== */
import { escapar, comoVeio, idade, diaEHora, instrumentoAtual, mesaAtual, motivoDito, operacaoVelha, idadeDaOperacao, botaoDeRecolher, fonteEIdade, fonteDeDocumento } from "./nucleo.js";

export function desenharODentro() {
  const i = instrumentoAtual();
  const caixa = document.getElementById("dentro");
  if (!i) { caixa.innerHTML = ""; return; }
  const l = i.leitura ?? {};
  const pos = l.posicao;
  const parado = i.parado ?? {};
  const decidiu = i.ultima_decisao;
  // AS FONTES DESTE LADO: a da mesa (`operacao.json`, `registo.jsonl`) e a da ficha do dono — cada secção diz de
  // onde vem o que mostra, e há quanto tempo esse ficheiro foi escrito.
  const fontes = i.fontes ?? {};
  const fontesDaMesa = mesaAtual()?.fontes ?? {};

  caixa.innerHTML = `
    <div class="secao" data-recolhivel="dentro:mercado">
      <h3 class="cabeca"><span>Mercado</span>${fonteEIdade(fontesDaMesa.operacao)}${botaoDeRecolher("dentro:mercado", "o mercado")}</h3>
      <div class="dentro-da-secao">
        <dl class="pares">
          <dt>bid / ask</dt><dd>${comoVeio(l.bid)} / ${comoVeio(l.ask)}</dd>
          <dt>último</dt><dd>${comoVeio(l.ultimo)}</dd>
          <dt title="a idade da ÚLTIMA LEITURA: o operador reescreve a operação a cada segundo, e este número é o que diz de quando é tudo o que está nesta coluna">lido</dt><dd class="${operacaoVelha() ? "venda-txt" : ""}">${escapar(idadeDaOperacao() ?? "—")}</dd>
          <dt title="a idade que o dado do venue tinha QUANDO foi lido (0,1 s é fresco na leitura — não quer dizer que a leitura seja de agora)">idade no venue</dt><dd class="fraco">${idade(l.idade_do_dado_ms)}</dd>
          <dt title="mercado.livro é opcional no contrato e o operador não o publica — o que não vem do sistema não se desenha (RN-E9). É uma AUSÊNCIA declarada, não um zero.">livro</dt><dd class="fantasma">não publicado pelo operador</dd>
          <dt>marcas nossas</dt><dd>${(i.marcas_nossas_conhecidas ?? []).length}</dd>
        </dl>
      </div>
    </div>

    <div class="secao" data-recolhivel="dentro:risco">
      <h3 class="cabeca"><span>Risco em vigor</span>${fonteDeDocumento(fontes.ficha)}${botaoDeRecolher("dentro:risco", "o risco em vigor")}</h3>
      <div class="dentro-da-secao">
        <dl class="pares">
          <dt>saldo</dt><dd>${escapar(i.risco?.saldo_pct ?? "—")}%</dd>
          <dt>alavancagem</dt><dd>${escapar(i.risco?.alavancagem ?? "—")}×</dd>
          <dt>prazo de resposta</dt><dd>${escapar(i.risco?.prazo_de_resposta_ms ?? "—")} ms</dd>
          <dt title="${escapar(Object.entries(i.risco?.bandas ?? {}).map(([k, b]) => `${k}: ${b.minimo} … ${b.maximo}`).join(" · "))}">bandas</dt><dd class="fraco">${Object.keys(i.risco?.bandas ?? {}).length} definidas</dd>
        </dl>
      </div>
    </div>

    <div class="secao" data-recolhivel="dentro:decisoes">
      <h3 class="cabeca"><span>Decisões deste par</span>${fonteEIdade(fontesDaMesa.registo)}${botaoDeRecolher("dentro:decisoes", "as decisões deste par")}</h3>
      <div class="dentro-da-secao">
        ${parado.travado
          ? `<div class="aviso">travado há <b>${escapar(parado.ciclos)}</b> ciclos: ${escapar(motivoDito(parado.porque))}${parado.desde_ms ? ` <span class="fraco">(desde ${diaEHora(parado.desde_ms)})</span>` : ""}</div>`
          : ""}
        <table class="tab">
          <thead><tr><th>ciclos · ação:motivo</th><th class="n">n</th></tr></thead>
          <tbody>${Object.entries(i.decisao_contagem ?? {}).map(([m, c]) => `<tr><td class="fraco quebra">${escapar(m)}</td><td class="n">${c}</td></tr>`).join("") || `<tr class="vazio"><td colspan="2">sem ciclos registados</td></tr>`}</tbody>
        </table>
        <dl class="pares">
          <dt title="o último ciclo da mesa para este par, com a hora a que foi gravado (o dado envelhece: a operação é reescrita a cada segundo)">última</dt><dd class="fraco">${decidiu ? `${escapar(decidiu.acao)} · ${escapar(decidiu.motivo ?? "—")} <span class="mono">· ${escapar(diaEHora(decidiu.instante_ms))}</span>` : "—"}</dd>
          <dt>proposta</dt><dd class="fraco">${i.proposta ? `${escapar(i.proposta.lado)} · ${diaEHora(i.proposta.barra_ms)}` : "o setup está calado"}</dd>
        </dl>
        ${i.divergente ? `<div class="aviso">divergente: ${escapar(JSON.stringify(i.divergente))}</div>` : ""}
        ${i.falhas && (i.falhas.leitura || !i.falhas.setup_respondeu) ? `<div class="aviso">falhas da leitura: ${escapar(JSON.stringify(i.falhas))}</div>` : ""}
      </div>
    </div>`;
}
