/* ============================================================================================
 * O GRÁFICO — as velas (do venue) e a série do setup, cruzadas por TEMPO, e a leitura do setup.
 *
 * Duas coisas separadas de propósito: as VELAS são o que aconteceu (do venue), a SÉRIE é o que o
 * motor viu (do setup). A tela desenha-as juntas e nunca as confunde — e a série NÃO se recalcula
 * aqui (RN-E9: uma conta, um dono). Quem a calcula é o setup, e o fio traz o resultado pronto.
 * ========================================================================================== */
import { estado, cor, escapar, comoVeio, hora, diaEHora, ladoDoSig, instrumentoAtual, operacaoVelha, idadeDaOperacao, redesenho, fonteEIdade } from "./nucleo.js";

const L = LightweightCharts;

export let grafico = null;
export const series = {}; // as séries do gráfico, por nome
let marcas = null;        // o gestor de marcadores (v5: createSeriesMarkers)
// O CICLO VIVO ACTUALIZA A ÚLTIMA BARRA, e precisa de duas guardas para não estragar o gráfico:
// `ultimoTempoNoGrafico` diz se PODE (um `update` com tempo ANTERIOR rebenta, e com tempo muito
// posterior — outro instrumento — desenharia uma barra solta no fim); `linhaDoPreco` é a linha do
// último preço, criada uma vez e depois só deslocada.
let ultimoTempoNoGrafico = null;
let linhaDoPreco = null;
let instrumentoDoGrafico = null; // qual instrumento está desenhado (muda → re-encaixa a janela visível)

/**
 * O TAMANHO DO GRÁFICO É MEDIDO, NÃO DELEGADO.
 *
 * A primeira versão usava `autoSize: true` — a biblioteca mede o contentor por `ResizeObserver`.
 * Medido no browser: os canvas ficavam com o tamanho de CSS certo e o BITMAP no valor de omissão
 * (300×150), ou seja, o gráfico nunca pintava. Não é um defeito de dados: é o tamanho a chegar
 * depois da primeira pintura.
 */
export function medirPalco() {
  const p = document.getElementById("palco");
  return { width: Math.max(240, Math.floor(p.clientWidth)), height: Math.max(220, Math.floor(p.clientHeight)) };
}

function montarGrafico() {
  const palco = document.getElementById("palco");
  const medida = medirPalco();
  const g = L.createChart(palco, {
    width: medida.width,
    height: medida.height,
    layout: {
      background: { type: "solid", color: cor("--fundo") },
      textColor: cor("--tinta-fraca"),
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: { vertLines: { color: cor("--grelha") }, horzLines: { color: cor("--grelha") } },
    rightPriceScale: { borderColor: cor("--borda") },
    timeScale: { borderColor: cor("--borda"), timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: {
      mode: L.CrosshairMode.Normal,
      vertLine: { color: cor("--tinta-fraca"), labelBackgroundColor: cor("--painel-alto"), width: 1, style: L.LineStyle.Dotted },
      horzLine: { color: cor("--tinta-fraca"), labelBackgroundColor: cor("--painel-alto"), width: 1, style: L.LineStyle.Dotted },
    },
    localization: {
      locale: "pt-BR",
      // O eixo do tempo mostra a HORA LOCAL de quem olha — e a legenda diz o fuso.
      timeFormatter: (t) => new Date(t * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    },
  });

  // As velas com o tom SUAVE, não com o acento vivo: um corpo de vela é uma área grande, e a tinta
  // clara usada como preenchimento vira a parede mais acesa do ecrã.
  series.vela = g.addSeries(L.CandlestickSeries, {
    upColor: cor("--compra-suave"), downColor: cor("--venda"),
    wickUpColor: cor("--compra-suave"), wickDownColor: cor("--venda"),
    borderVisible: false, priceLineVisible: false, lastValueVisible: false,
  }, 0);

  series.media = g.addSeries(L.LineSeries, {
    color: cor("--media"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "média",
  }, 0);
  series.bandaAlta = g.addSeries(L.LineSeries, {
    color: cor("--banda"), lineWidth: 1, lineStyle: L.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false,
  }, 0);
  series.bandaBaixa = g.addSeries(L.LineSeries, {
    color: cor("--banda"), lineWidth: 1, lineStyle: L.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false,
  }, 0);
  series.extremo = g.addSeries(L.LineSeries, {
    color: cor("--extremo"), lineWidth: 1, lineStyle: L.LineStyle.SparseDotted, lineType: L.LineType.WithSteps,
    priceLineVisible: false, lastValueVisible: false, visible: false,
  }, 0);

  // A FAIXA DO SINAL — um painel próprio por baixo: o LADO vigente barra a barra, o mesmo número que o
  // motor usou para decidir (`sig`), não uma leitura nova.
  series.sinal = g.addSeries(L.HistogramSeries, {
    priceFormat: { type: "price", precision: 0, minMove: 1 },
    priceLineVisible: false, lastValueVisible: false, base: 0, title: "lado",
  }, 1);
  marcas = L.createSeriesMarkers(series.vela, []);
  return g;
}

/**
 * O GRÁFICO NÃO SE REPINTA SOZINHO DEPOIS DE VOLTAR DE `display: none` — e isto é medido, não suposto.
 * Enquanto recolhido, o contentor tem altura 0; a biblioteca fica com um tamanho inválido em memória
 * e o canvas volta com o bitmap de omissão (300×150) e SEM um pixel desenhado. O que repinta de forma
 * determinística é RECONSTRUIR — a mesma função que montou o gráfico na primeira vez.
 */
export function repintarOGrafico() {
  if (!grafico) return;
  requestAnimationFrame(() => {
    try { grafico.remove(); } catch { /* já não havia nada para remover */ }
    grafico = null;
    for (const k of Object.keys(series)) delete series[k];
    marcas = null;
    linhaDoPreco = null;
    ultimoTempoNoGrafico = null;
    instrumentoDoGrafico = null;
    desenharGrafico();
    // O desenho reescreveu a cabeça e a matéria da leitura: os botões novos nasceriam mortos.
    redesenho.reencaixar();
  });
}

export function ajustarAlturaDosPainéis() {
  if (!grafico) return;
  const palco = document.getElementById("palco");
  if (palco === null) return;
  const barra = document.getElementById("barra-do-telefone");
  const estreito = window.innerWidth <= 1080;
  const barraVisivel = barra !== null && getComputedStyle(barra).display !== "none";

  // NO TELEFONE A ALTURA É MEDIDA, NÃO ESTIMADA EM `vh`: uma altura em `vh` ignora a fita, a faixa dos
  // pares e a barra fixa. A altura do ecrã é a MENOR das três que o browser publica (`visualViewport`,
  // `documentElement.clientHeight`, `innerHeight`) — o menor é o que nunca mente.
  if (estreito && barraVisivel) {
    const topo = palco.getBoundingClientRect().top + window.scrollY;
    const alturaDoEcra = Math.min(
      window.visualViewport ? window.visualViewport.height : Infinity,
      document.documentElement.clientHeight,
      window.innerHeight,
    );
    const alvo = Math.max(240, Math.round(alturaDoEcra - topo - barra.getBoundingClientRect().height - 10));
    if (Math.abs(palco.clientHeight - alvo) > 1) palco.style.height = `${alvo}px`;
  } else if (palco.style.height !== "") {
    palco.style.height = ""; // no computador vale a altura do CSS (min(58vh, 560px))
  }

  const medida = medirPalco();
  grafico.applyOptions(medida);
  const painéis = grafico.panes();
  if (painéis.length < 2) return;
  painéis[1].setHeight(Math.max(54, Math.round(medida.height * 0.18)));
}

/**
 * QUANTOS PIXELS O GRÁFICO PINTA — a prova de que desenhou, sem depender do olho.
 * Duas armadilhas medidas: medir em sincronia diz sempre "não pintou" (o desenho acontece no
 * `requestAnimationFrame` seguinte); e o PRIMEIRO canvas não é o que desenha (a lib empilha vários, e
 * os de sobreposição ficam em 300×150 de propósito) — o que vale é o MAIOR. O fundo conta-se por ALFA.
 */
function medirOPintado() {
  requestAnimationFrame(() => setTimeout(() => {
    try {
      const cs = Array.from(document.querySelectorAll("#palco canvas"));
      const maior = cs.reduce((a, b) => ((b.width * b.height) > (a ? a.width * a.height : 0) ? b : a), null);
      if (!maior || maior.width === 0) { if (window.__diag) window.__diag.pintado = { erro: "sem canvas com bitmap" }; return; }
      const px = maior.getContext("2d").getImageData(0, 0, maior.width, maior.height).data;
      let comAlfa = 0, foraDoFundo = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        comAlfa++;
        if (Math.abs(px[i] - 15) > 6 || Math.abs(px[i + 1] - 26) > 6 || Math.abs(px[i + 2] - 31) > 6) foraDoFundo++;
      }
      if (window.__diag) {
        window.__diag.pintado = {
          canvas_de_desenho: `${maior.width}x${maior.height}`,
          canvas_no_palco: cs.length,
          pixels_opacos: comAlfa,
          pixels_fora_do_fundo: foraDoFundo,
          total: maior.width * maior.height,
        };
      }
    } catch (e) {
      if (window.__diag) window.__diag.pintado = { erro: String(e) };
    }
  }, 400));
}

export function desenharGrafico() {
  const i = instrumentoAtual();
  const cabecalho = document.getElementById("cabecalho-do-grafico");
  const legenda = document.getElementById("legenda");
  const caixa = document.getElementById("corpo-da-leitura");
  if (!i) {
    cabecalho.innerHTML = `<span class="fraco">sem par em vista</span>`;
    if (legenda) legenda.innerHTML = "";
    if (caixa) caixa.innerHTML = "";
    const semFonte = document.getElementById("fonte-da-leitura");
    if (semFonte) semFonte.innerHTML = "";
    return;
  }
  const temSerie = (i.serie_do_setup ?? []).length > 0;
  const últimaFechada = i.janela?.ate ?? null;
  const dito = i.o_que_o_setup_disse ?? {};
  // O FIO PODE NÃO TRAZER A SÉRIE (o modo leve do `vivo.json`, e o `painel.json` quando o retrato completo falha
  // e fica o leve): sem o `?? []` isto rebentava aqui e a tela ficava desenhada a MEIO — medido (03/10/2026), com
  // as secções do «lado de dentro» vazias e uma promessa recusada na consola.
  const serie = i.serie_do_setup ?? [];
  const ultimoPonto = serie[serie.length - 1] ?? null;
  const sig = ultimoPonto?.sig ?? null;
  const virou = ultimoPonto?.virada ? ultimoPonto.virada : 0;
  // OS BURACOS DO HISTORICO (medido 04/10/2026): um vao REAL entre velas — a paragem da maquina, ou uma barra que
  // se perdeu com a corrida viva. MARCA-SE e NOMEIA-SE (de/ate + quantas faltam); nunca se inventa a barra que
  // faltou nem se atravessa o vao em silencio. Vem calculado do fio (o produtor conta as faltas).
  const buracos = i.buracos ?? [];

  cabecalho.innerHTML = `
    <span class="titulo">${escapar(i.instrumento)}</span>
    <span class="fraco">${escapar(i.ficha?.setup ?? "?")} ${escapar(i.ficha?.versao_do_setup ?? "")} · ${escapar(i.ficha?.relogio ?? "?")}</span>
    ${sig !== null ? `<span class="lado ${ladoDoSig(sig)}">${sig === 1 ? "long" : sig === -1 ? "short" : "flat"}</span>` : ""}
    ${virou !== 0 ? `<span class="fraco"><span class="glifo ${virou === 1 ? "tri-cima" : "tri-baixo"}" style="vertical-align:-1px"></span> virou ${hora(últimaFechada)}</span>` : ""}
    ${buracos.length > 0 ? `<span class="vao" title="o histórico tem ${buracos.length} vão(ões): a barra que faltou NÃO se inventa — o eixo do tempo fica com o vão, e o feed nomeia-o (buraco_no_historico)">vão${buracos.length > 1 ? `s · ${buracos.length}` : ""} ${buracos.map((b) => `${diaEHora(b.de)}→${diaEHora(b.ate)} · faltam ${b.faltam}`).join(" · ")}</span>` : ""}
    <span class="fraco" style="margin-left:auto">último <span class="${operacaoVelha() ? "fantasma" : ""}" title="${escapar(idadeDaOperacao() ?? "sem idade de leitura")}">${comoVeio(i.leitura?.ultimo)}</span> · barra ${diaEHora(últimaFechada)}${idadeDaOperacao() ? ` · <span class="${operacaoVelha() ? "venda-txt" : ""}">leitura ${escapar(idadeDaOperacao())}</span>` : ""}</span>
    <a class="botao" id="bt-config" href="#configuracao" title="a configuração desta ficha, na vista (onde se lê e se edita)">config</a>`;

  // A FONTE DESTE BLOCO: as VELAS vêm de um ficheiro do venue e a SÉRIE vem de o setup a ter respondido AGORA —
  // as duas vêm ditas no rodapé, com as suas idades, e os caminhos no `title`, para não haver número sem origem.
  const daLeitura = document.getElementById("fonte-da-leitura");
  if (daLeitura) {
    const f = i.fontes ?? {};
    daLeitura.innerHTML = [f.velas, f.ficha].filter(Boolean).map((x) => fonteEIdade(x)).join(" · ");
  }

  // O `config` é um `<a href="#configuracao">`: o «voltar» do telefone funciona e a vista tem endereço próprio —
  // não é preciso religar gesto nenhum (o `hashchange` do arranque trata disso).

  if (!grafico) { grafico = montarGrafico(); }
  ajustarAlturaDosPainéis();

  // --- as velas: o que o venue publicou ---
  const barras = (i.velas ?? []).map((v) => ({
    time: Math.floor(v.t / 1000), open: Number(v.o), high: Number(v.h), low: Number(v.l), close: Number(v.c),
  }));
  series.vela.setData(barras);
  // A JANELA VISÍVEL: as últimas ~160 barras, na PRIMEIRA vez que este instrumento é desenhado. Sem isto o
  // gráfico mostra as 1009 barras todas — 0,37 px por barra num telefone —, e as velas desaparecem numa linha
  // (medido numa captura: «não se vêem velas»). Não se repete a cada volta, para não desfazer o zoom de quem
  // já mexeu no gráfico.
  if (instrumentoDoGrafico !== i.instrumento) {
    instrumentoDoGrafico = i.instrumento;
    // A JANELA: no telefone ~70 barras (372 px / 70 = 5 px por barra — as velas lêem-se); no computador ~160.
    const janela = window.innerWidth <= 1080 ? 70 : 160;
    if (barras.length > janela) grafico.timeScale().setVisibleLogicalRange({ from: barras.length - janela, to: barras.length + 4 });
  }
  // O TEMPO DA ÚLTIMA BARRA DESENHADA — é ele que autoriza (ou não) o `update` do ciclo vivo.
  ultimoTempoNoGrafico = barras.length > 0 ? barras[barras.length - 1].time : null;

  // --- a série do setup: o que o indicador viu, barra a barra ---
  const s = serie;
  series.media.setData(s.filter((x) => x.ma !== null).map((x) => ({ time: Math.floor(x.t / 1000), value: x.ma })));
  series.bandaAlta.setData(s.map((x) => ({ time: Math.floor(x.t / 1000), value: (x.ma ?? 0) + (x.banda ?? 0) })));
  series.bandaBaixa.setData(s.map((x) => ({ time: Math.floor(x.t / 1000), value: (x.ma ?? 0) - (x.banda ?? 0) })));
  series.extremo.setData(s.filter((x) => x.extremo !== null).map((x) => ({ time: Math.floor(x.t / 1000), value: x.extremo })));
  series.sinal.setData(s.map((x) => ({
    time: Math.floor(x.t / 1000), value: x.sig,
    color: x.sig === 1 ? cor("--compra-suave") : x.sig === -1 ? cor("--venda") : cor("--neutro"),
  })));

  // --- as marcas: a VIRADA da regra (seta) e a DECISÃO da mesa (círculo) ---
  const lista = s.filter((x) => x.virada !== 0).map((x) => ({
    time: Math.floor(x.t / 1000),
    position: x.virada === 1 ? "belowBar" : "aboveBar",
    shape: x.virada === 1 ? "arrowUp" : "arrowDown",
    color: x.virada === 1 ? cor("--compra") : cor("--venda"),
    text: "",
  }));
  for (const ms of i.decisoes_de_abrir_ms ?? []) {
    // A decisão cai DENTRO de uma barra (não na abertura dela — foi um erro medido numa bancada).
    const barra = s.find((x) => x.t <= ms && ms < x.t + 3600000);
    if (barra === undefined) continue;
    lista.push({ time: Math.floor(barra.t / 1000), position: "aboveBar", shape: "circle", color: cor("--tinta"), text: "decisão" });
  }
  // OS BURACOS: um marcador na barra SEGUINTE ao vão, com o número de barras que faltam. Marcar não é preencher —
  // o eixo do tempo fica com o vão de propósito (a barra que faltou não se inventa).
  for (const b of buracos) {
    lista.push({ time: Math.floor(b.ate / 1000), position: "belowBar", shape: "square", color: cor("--venda"), text: `↔${b.faltam}` });
  }
  marcas.setMarkers(lista.sort((a, b) => a.time - b.time));

  // --- instrumentação mínima, para a verificação não depender do olho ---
  try {
    window.__diag = {
      palco: medirPalco(),
      painéis: grafico.panes().length,
      velas: (i.velas ?? []).length,
      barras_da_serie: s.length,
      marcadores: lista.length,
      sig_da_ultima_barra: s.length ? s[s.length - 1].sig : null,
      faltas_do_cruzamento: i.faltas_do_cruzamento ?? null,
      buracos: buracos.length,
      pintado: null,
    };
  } catch (e) {
    window.__diag = { erro: String(e) };
  }
  medirOPintado();

  // --- a legenda e os interruptores do desenho ---
  legenda.innerHTML = `
    <span><i class="glifo barra" style="background:${cor("--media")}"></i>média do indicador</span>
    <span><i class="glifo barra" style="background:${cor("--banda")}"></i>zona morta (± banda × ATR) — dentro dela a virada não acontece</span>
    <span><i class="glifo barra" style="background:${cor("--extremo")}"></i>extremo da perna (a memória do zigzag)</span>
    <span><span class="glifo tri-cima"></span>virou para comprado &nbsp;<span class="glifo tri-baixo"></span>virou para vendido (a seta segue o LADO, não o preço)</span>
    <label class="alternar"><input type="checkbox" id="c-media" checked>média</label>
    <label class="alternar"><input type="checkbox" id="c-banda" checked>zona morta</label>
    <label class="alternar"><input type="checkbox" id="c-extremo">extremo</label>
    <label class="alternar"><input type="checkbox" id="c-sinal" checked>faixa do sinal</label>`;
  document.getElementById("c-media").onchange = (e) => { series.media.applyOptions({ visible: e.target.checked }); };
  document.getElementById("c-banda").onchange = (e) => { series.bandaAlta.applyOptions({ visible: e.target.checked }); series.bandaBaixa.applyOptions({ visible: e.target.checked }); };
  document.getElementById("c-extremo").onchange = (e) => { series.extremo.applyOptions({ visible: e.target.checked }); };
  document.getElementById("c-sinal").onchange = (e) => { series.sinal.applyOptions({ visible: e.target.checked }); };

  // --- a leitura do setup: as últimas barras, palavra por palavra dele ---
  if (!temSerie) {
    document.getElementById("resumo-da-leitura").textContent = "sem série";
    caixa.innerHTML = `<div class="aviso">este setup não publica série${i.sobreposicao_indisponivel ? ` — ${escapar(i.sobreposicao_indisponivel)}` : ""}</div>`;
    return;
  }
  const med = dito.medicao;
  const concordam = med === null || med === undefined || sig === null ? null : med.sig === sig;
  const últimas = s.slice(-5);
  document.getElementById("resumo-da-leitura").innerHTML =
    `${últimas.length} barras · sig ${sig ?? "—"} · ` +
    (concordam === null ? "sem medição" : concordam ? "concorda" : `<span class="venda-txt">DIVERGE</span>`);
  caixa.innerHTML = `
    <table class="tab">
      <thead><tr><th>barra</th><th class="n">mid</th><th class="n">ma</th><th class="n">mid−ma</th><th class="n">atr</th><th class="n">banda</th><th class="n">sig</th></tr></thead>
      <tbody>${últimas.map((x) => {
        const midMenosMa = x.ma === null || x.mid === undefined ? "na" : (x.mid - x.ma).toFixed(4);
        return `<tr>
          <td class="fraco">${diaEHora(x.t)}</td>
          <td class="n">${x.mid === undefined ? "—" : Number(x.mid).toFixed(4)}</td>
          <td class="n">${x.ma === null ? "na" : x.ma.toFixed(4)}</td>
          <td class="n">${midMenosMa}</td>
          <td class="n">${x.atr === null ? "na" : x.atr.toFixed(4)}</td>
          <td class="n">${x.banda === null ? "na" : x.banda.toFixed(4)}</td>
          <td class="n ${x.sig === 1 ? "compra-txt" : x.sig === -1 ? "venda-txt" : ""}" title="${x.virada !== 0 ? "virou nesta barra" : ""}">${x.sig}${x.virada !== 0 ? " ⟵" : ""}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
    ${dito.veredicto
      ? `<div class="dito">volta ${escapar(dito.veredicto.volta)} · ${dito.veredicto.proposta_do_setup ? `propôs <b>${escapar(dito.veredicto.lado_da_proposta)}</b>` : "não propôs"} · ${escapar(dito.veredicto.texto)}</div>`
      : `<div class="dito fraco">o setup não falou em nenhuma volta do operador nesta corrida</div>`}
    ${med
      ? `<div class="dito fraco">medição dele: volta ${escapar(med.volta)} · sig ${escapar(med.sig)} · virada ${escapar(med.virada)} · ma ${escapar(med.ma)} · atr ${escapar(med.atr)}${concordam === null ? "" : concordam ? " · concorda" : ` · <span class="venda-txt">DIVERGE (série diz ${escapar(sig)})</span>`}</div>`
      : ""}`;
}

/**
 * O GRÁFICO TAMBÉM RESPIRA — e sem se redesenhar. O CICLO VIVO mexe só na ÚLTIMA barra (`update`, o
 * caminho leve do `lightweight-charts`) e na LINHA DO PREÇO. As duas guardas: o tempo da barra não pode
 * ser ANTERIOR ao que está desenhado (o `update` rebenta) nem de outro instrumento (desenharia uma barra
 * solta no fim — quem chama já garante que só toca no instrumento seleccionado).
 */
export function atualizarAoVivo() {
  const comGrafico = instrumentoAtual();
  if (!comGrafico || !series.vela) return;
  const ultimo = comGrafico?.leitura?.ultimo ?? null;
  if (ultimo !== null) {
    const preco = Number(ultimo);
    if (Number.isFinite(preco)) {
      if (linhaDoPreco === null) {
        linhaDoPreco = series.vela.createPriceLine({
          price: preco, color: cor("--tinta-fraca"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "último",
        });
      } else {
        linhaDoPreco.applyOptions({ price: preco });
      }
    }
  }
  const vela = comGrafico?.vela_em_curso ?? null;
  if (vela !== null) {
    const barra = { time: Math.floor(vela.t / 1000), open: Number(vela.o), high: Number(vela.h), low: Number(vela.l), close: Number(vela.c) };
    if (ultimoTempoNoGrafico === null || barra.time >= ultimoTempoNoGrafico) {
      series.vela.update(barra);
      ultimoTempoNoGrafico = barra.time;
    }
  }
}
