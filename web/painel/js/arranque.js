/* ============================================================================================
 * O ARRANQUE — quem liga tudo: os dois relógios (retrato e «agora»), a vista pelo endereço, e o
 * ponto de encontro entre o que desenha e o que guarda o estado (`redesenho`, do `nucleo`).
 *
 * DOIS RELÓGIOS, e não um: o RELATÓRIO completo (`painel.json`, a cada 60 s) traz a série e é dele que
 * sai o gráfico; o «AGORA» (`vivo.json`, a cada 2 s) traz o que se move a cada segundo no motor e pesa
 * 28 KB em vez de 2,7 MB. O que o vivo não traz (as velas e a série) é PRESERVADO do retrato já
 * desenhado — sem isso o gráfico apareceria vazio. A barra de estado mostra AS DUAS idades.
 * ========================================================================================== */
import { estado, redesenho, escapar, aplicarAsOmissoes, aplicarOsEstadosDeRecolher, ligarOsBotoesDeRecolher, mesaAtual, alternarRecolhido, estaRecolhido, podeRecolher, oQueAbre } from "./nucleo.js";
import { desenharFita } from "./fita.js";
import { desenharVivas } from "./posicoes.js";
import { desenharPares } from "./pares.js";
import { desenharMatriz } from "./matriz.js";
import { desenharGrafico, repintarOGrafico, ajustarAlturaDosPainéis, atualizarAoVivo } from "./grafico.js";
import { desenharODentro } from "./dentro.js";
import { desenharRegistoEFaltas } from "./registo.js";
import { desenharAConfiguracao, ligarAsAcoes } from "./configuracao.js";
import { desenharAcoes, prepararAsAcoes } from "./acoes.js";
import { desenharBarraDoTelefone } from "./telefone.js";

/* --------------------------------------------------------------------------- a tela nunca fica velha */

/* A TELA NUNCA ESTA DESATUALIZADA, e nunca ha DUAS SESSOES com codigo diferente.
 *
 * O fio traz `tela_em_ms` — a versao dos ficheiros que desenham esta pagina, medida no disco pelo servidor. Esta
 * pagina guarda a versao com que FOI CARREGADA e, em cada leitura (a cada 2 s no «agora»), compara: se o servidor
 * ja' serve outra, ela RECARREGA-SE SOZINHA. E' o que faz uma correcao entrar em qualquer aba ja' aberta sem o dono
 * ter de saber o que e' uma cache — e o que impede a aba antiga e a aba nova mostrarem o painel em estados
 * diferentes. So' dispara quando a versao MUDA (uma correcao), nunca em cada leitura.
 */
let versaoDaTelaCarregada = null;
function versaoDoFio(dados) {
  return dados && typeof dados.tela_em_ms === "number" ? dados.tela_em_ms : null;
}
/** Verdadeiro quando o que o servidor serve ja' nao e' o que esta pagina carregou — e entao recarrega. */
function aTelaMudou(dados) {
  const v = versaoDoFio(dados);
  if (v === null) return false;
  if (versaoDaTelaCarregada === null) { versaoDaTelaCarregada = v; return false; }
  return v !== versaoDaTelaCarregada;
}

/* --------------------------------------------------------------------------- o desenho e as vistas */

/** A VISTA PEDIDA PELO ENDEREÇO: `#configuracao` mostra a configuração, tudo o resto mostra o terminal. */
function aplicarAVista() {
  const naConfiguracao = location.hash === "#configuracao";
  document.body.dataset.vista = naConfiguracao ? "configuracao" : "painel";
  document.getElementById("vista-de-config").hidden = !naConfiguracao;
  if (naConfiguracao) {
    // A FAIXA DOS COMANDOS PEDE A FILA AO PORTO — e o desenho sai antes de a resposta chegar («a perguntar ao
    // porto…» é melhor do que um vazio), com uma segunda passagem quando ela chega.
    desenharAConfiguracao();
    void prepararAsAcoes().then(() => desenharAConfiguracao());
  } else reencaixarEmBreve();
}

/** TUDO o que desenha, num sítio só. */
function desenharTudo() {
  desenharFita();
  desenharPares();
  desenharGrafico();
  desenharVivas();
  desenharODentro();
  desenharMatriz();
  desenharRegistoEFaltas();
  desenharBarraDoTelefone();
  aplicarOsEstadosDeRecolher();
  ligarOsBotoesDeRecolher();
  reencaixarEmBreve();
}

/** O ciclo CURTO: os números e o «agora», sem tocar no gráfico (quem o redesenha é o retrato completo). */
function desenharOsNumeros() {
  desenharFita();
  desenharPares();
  desenharVivas();
  desenharODentro();
  desenharMatriz();
  desenharBarraDoTelefone();
  aplicarOsEstadosDeRecolher();
  ligarOsBotoesDeRecolher();
  reencaixarEmBreve();
}

/* --------------------------------------------------------------------------- o arranque */

async function carregar() {
  try {
    const r = await fetch(`painel.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    estado.dados = await r.json();
  } catch (e) {
    document.getElementById("fita").innerHTML =
      `<div class="marca"><b>MesaCore</b><span class="selo teste">sem retrato</span></div>
       <div class="fraco" style="margin-left:auto">não consegui ler <code>painel.json</code> (${escapar(e.message)}) — o painel é servido pelo sistema: corra <code class="mono">bun run tools/painel/retrato.ts</code></div>`;
    return;
  }
  // A VERSÃO DA TELA ANTES DE DESENHAR: se o servidor já serve outra, recarrega (nada de desenhar o velho).
  if (aTelaMudou(estado.dados)) { location.reload(); return; }
  aplicarAsOmissoes();
  const ms = estado.dados.mesas ?? [];
  // A INSTALAÇÃO POR OMISSÃO: a MAIS FRESCA (a operação lida há menos tempo) — é a que está a acontecer.
  if (!estado.instalacao || (estado.instalacao !== "geral" && !ms.some((m) => m.instalacao === estado.instalacao))) {
    const fresca = [...ms].sort((a, b) => (a.idade_da_operacao_ms ?? Infinity) - (b.idade_da_operacao_ms ?? Infinity))[0];
    estado.instalacao = fresca?.instalacao ?? "geral";
  }
  const instrumentos = mesaAtual()?.contas?.[0]?.instrumentos ?? [];
  if (!estado.selecionado || !instrumentos.some((i) => i.instrumento === estado.selecionado)) {
    estado.selecionado = instrumentos[0]?.instrumento ?? null;
  }
  desenharTudo();
  aplicarAVista();
}

/* --------------------------------------------------------------------------- o «agora» (2 s) */

const INTERVALO_VIVO_MS = 2000;
const CAMPOS_DA_SERIE = ["velas", "serie_do_setup", "janela", "em_curso", "sobreposicao_indisponivel", "faltas_do_cruzamento", "buracos"];
async function carregarVivo() {
  if (!estado.dados || !Array.isArray(estado.dados.mesas) || estado.dados.mesas.length === 0) return;
  let vivo;
  try {
    const r = await fetch(`vivo.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    vivo = await r.json();
  } catch {
    return;
  }
  // A VERSÃO DA TELA, TAMBÉM NO CICLO CURTO (2 s): é isto que faz a correção entrar depressa em qualquer aba.
  if (aTelaMudou(vivo)) { location.reload(); return; }
  // O MERGE É POR INSTALAÇÃO (nome), e não por índice: se a descoberta mudar a ordem entre duas voltas,
  // um merge por índice casaria as mesas erradas.
  for (const mesa of vivo.mesas ?? []) {
    const minha = estado.dados.mesas.find((m) => m.instalacao === mesa.instalacao);
    if (!minha) continue;
    const contas = (minha.contas ?? []).map((minhaConta, ci) => {
      const conta = mesa.contas?.[ci];
      if (!conta) return minhaConta;
      const velhos = minhaConta.instrumentos ?? [];
      const instrumentos = (conta.instrumentos ?? []).map((inst) => {
        const velho = velhos.find((v) => v.instrumento === inst.instrumento);
        if (!velho) return inst;
        const series = {};
        for (const k of CAMPOS_DA_SERIE) if (k in velho) series[k] = velho[k];
        return { ...inst, ...series };
      });
      return { ...minhaConta, ...conta, instrumentos };
    });
    Object.assign(minha, mesa, { contas });
  }
  // O RETRATO DO VIVO NÃO SOBRESCREVE O DO COMPLETO: são duas coisas, e a barra mostra as duas idades.
  if (vivo.retrato) estado.dados.agora = vivo.retrato;
  if (vivo.faltas) estado.dados.faltas = vivo.faltas;
  if (vivo.configuracao) estado.dados.configuracao = vivo.configuracao;
  if (vivo.geral) estado.dados.geral = vivo.geral;
  if (vivo.plugins) estado.dados.plugins = vivo.plugins;
  atualizarAoVivo(); // o gráfico respira: mexe só na última barra e na linha do preço
  desenharOsNumeros();
}

/* --------------------------------------------------------------------------- o layout */

// O LAYOUT ASSENTA DEPOIS DE DESENHAR: uma única medição pegava o topo antes de o texto ter a altura final
// (o que muda de "há 25 s" para "há 2 min" pode partir uma linha). O `ResizeObserver` sobre o `body` não
// resolve — não é notificado das mudanças que acontecem dentro do próprio callback. Três medições resolvem.
let relogiosDoReencaixe = [];
function reencaixarEmBreve() {
  for (const t of relogiosDoReencaixe) clearTimeout(t);
  relogiosDoReencaixe = [
    setTimeout(ajustarAlturaDosPainéis, 0),
    setTimeout(ajustarAlturaDosPainéis, 250),
    setTimeout(ajustarAlturaDosPainéis, 900),
  ];
}

/* --------------------------------------------------------------------------- a ligação das peças */

redesenho.tudo = desenharTudo;
redesenho.numeros = desenharOsNumeros;
redesenho.reencaixar = reencaixarEmBreve;
redesenho.repintarGrafico = repintarOGrafico;
redesenho.recarregar = carregar;
redesenho.trocarInstalacao = (v) => {
  estado.instalacao = v;
  const instrumentos = mesaAtual()?.contas?.[0]?.instrumentos ?? [];
  estado.selecionado = instrumentos[0]?.instrumento ?? null;
  desenharTudo();
  aplicarAVista();
};

new MutationObserver(() => { if (estado.dados) desenharGrafico(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema", "class"] });
addEventListener("resize", ajustarAlturaDosPainéis);
addEventListener("orientationchange", reencaixarEmBreve);
addEventListener("hashchange", aplicarAVista);
// QUANDO A ABA VOLTA, O GRÁFICO PODE VOLTAR VAZIO: com a aba escondida o `requestAnimationFrame` não corre e
// um desenho agendado perde-se. A volta da aba é um pedido de desenho — e só se reconstrói quando o canvas
// ainda está no tamanho de omissão (300×150), para não desmontar o gráfico de quem só voltou a olhar.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const c = document.querySelector("#palco canvas");
  if (!c || (c.width === 300 && c.height === 150)) repintarOGrafico();
  reencaixarEmBreve();
});

// A FAIXA DOS COMANDOS, ligada uma só vez: quem a desenha é a vista da configuração, que a chama ao desenhar.
ligarAsAcoes(desenharAcoes);

// INSTRUMENTAÇÃO MÍNIMA, para a verificação não depender do olho (não decide nada nem mostra nada).
// `nucleo` entra aqui porque a prova do recolhido (`tools/painel/prova-do-recolhido.ts`) tem de usar o MESMO
// gesto dos botões — não uma segunda conta dele na bancada.
window.__painel = {
  estado,
  redesenho,
  nucleo: { alternarRecolhido, aplicarOsEstadosDeRecolher, ligarOsBotoesDeRecolher, estaRecolhido, podeRecolher, oQueAbre },
  // A versão da tela com que ESTA página foi carregada: a prova do «nunca desatualizado» lê-a para mostrar que,
  // quando o servidor passa a servir outra, a página se recarregou (a única forma de este valor mudar).
  versaoDaTela: () => versaoDaTelaCarregada,
};

carregar();
setInterval(carregar, 60000);                 // o RELATÓRIO completo (com o gráfico): a série muda por BARRA
setInterval(carregarVivo, INTERVALO_VIVO_MS); // o «AGORA»: é isto que dá a sensação de vivo
