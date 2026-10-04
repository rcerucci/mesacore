/* ============================================================================================
 * AS AÇÕES — o CRUD de comandos sobre a mesa, com a fronteira dita.
 *
 * DUAS ESPÉCIES DE COMANDO, e a diferença não é de gosto, é de risco:
 *
 *   1. O MANDATO, por par (`rodar` / `enviar`) — muda uma FICHA, e a ficha é um documento. Passa pela porta que
 *      já existe e é a MESMA da linha de comando (`tools/escrever-ficha`, via `POST /api/ficha`): o candidato é
 *      VALIDADO pelo conferidor do portão antes de tocar no ficheiro, e a mudança fica registada. Isto o painel
 *      faz hoje, e é o `bash tools/ligar-par.sh <par> sim|nao>` — escrito com validação e assinatura.
 *
 *   2. O CICLO DE VIDA da observação (`iniciar` / `parar` o operador+mesa) — muda PROCESSOS, não documentos.
 *      O painel NÃO os arranca: quem lança processos é a camada de operação (o mesmo princípio que proíbe um
 *      formulário de ordem aqui dentro). O que a tela faz é PEDIR — escreve um PEDIDO numa fila
 *      (`POST /api/verbo`), mostra o comando exacto que executa cada verbo, e deixa CANCELAR o que está à
 *      espera. Quem consome a fila é a camada de operação, numa sessão com contexto para o fazer.
 *
 * Se o porto não existir (a tela servida fora do `servidor.ts`, por exemplo), a faixa DIZ isso em vez de fingir
 * que pediu — e continua a mostrar os comandos, que é o que se pode copiar.
 * ========================================================================================== */
import { estado, mesaAtual, mesas, escapar, hora, desde } from "./nucleo.js";
import { fichaEmVista } from "./configuracao.js";

const PORTO = "/api/verbo";
const RAIZ_DAS_CORRIDAS = "/home/cerucci/.hermes/profiles/appbuilder/cache/scratch";

/* ------------------------------------------------------------------ as duas listas de verbos conhecidos */
/** O mandato de um par. `run` decide se o par é calculado; `enviar`, se o que ele propõe chega ao venue. */
export function verbosDeMandato() {
  const c = estado.dados?.configuracao ?? {};
  return (c.fichas ?? []).map((f) => ({
    quem: f.cabecalho?.instrumento ?? "?",
    setup: f.cabecalho?.setup ?? "",
    conta: f.cabecalho?.conta ?? null,
    caminho: f.caminho,
    hash: f.hash ?? null,
    run: f.cabecalho?.run === true,
    enviar: f.cabecalho?.enviar === true,
  }));
}

/** O ciclo de vida, por conta — o comando que a linha de comando usa hoje, e a pasta da corrida. */
export function verbosDaCorrida() {
  const contas = [...new Set(verbosDeMandato().map((v) => v.conta).filter(Boolean))];
  return contas.map((conta) => {
    const m = mesas().find((x) => (x.contas?.[0]?.instrumentos ?? []).some((i) => i.conta === conta));
    const dir = m?.corrida ?? `${RAIZ_DAS_CORRIDAS}/observacao`;
    return {
      conta,
      instalacao: m?.instalacao ?? null,
      dir,
      iniciar: `bash tools/operar-em-observacao.sh ${conta}`,
      parar: `kill $(cat ${dir}/operacao-em-observacao.pid)`,
    };
  });
}

/* ----------------------------------------------------------------------------- o estado da fila, no porto */
let pendentes = null;      // null = ainda não se perguntou; [] = o porto respondeu (talvez vazio)
let recado = null;         // a última resposta do porto (ou a falta dele)
/** O recado é bom (escrito/pedido) ou é uma recusa? A cor depende disso — e a distinção é dita, não adivinhada. */
const recadoValido = () => recado !== null && !/^(recusado|não se|não há)/i.test(recado);

async function falarComOPorto(corpo, metodo = "POST") {
  try {
    const r = await fetch(PORTO, {
      method: metodo,
      headers: { "content-type": "application/json", "x-mesacore": "1" },
      body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 404) return { ok: false, porque: "esta tela não está a ser servida pelo `servidor.ts` — não há aqui o porto dos verbos" };
    return await r.json();
  } catch (e) {
    return { ok: false, porque: `não se conseguiu falar com o porto (${e instanceof Error ? e.message : String(e)})` };
  }
}

async function lerOsPendentes() {
  const r = await falarComOPorto(null, "GET");
  pendentes = r.ok === true ? (r.pedidos ?? []) : null;
  if (r.ok !== true) recado = r.porque ?? "o porto não respondeu";
  return r.ok === true;
}

/* ------------------------------------------------------------------------------------ o desenho da faixa */
export function desenharAcoes() {
  const caixa = document.getElementById("acoes");
  if (!caixa) return;
  const mandatos = verbosDeMandato();
  const corridas = verbosDaCorrida();

  const linhasDeMandato = mandatos.length === 0
    ? `<div class="fraco">nenhuma ficha no fio — sem ficha não há mandato a mudar</div>`
    : mandatos.map((v) => {
      const proximoRun = !v.run;
      const proximoEnviar = !v.enviar;
      return `<div class="linha-de-acao">
        <span class="quem">${escapar(v.quem)}</span>
        <button class="botao" data-mandato="${escapar(v.caminho)}" data-chave="cabecalho.run" data-para="${proximoRun}" title="escreve run: ${proximoRun} na ficha, validado pelo conferidor do portão" aria-label="rodar ${v.quem}: ${v.run ? "desligar" : "ligar"}">rodar <b class="${v.run ? "compra-txt" : "fraco"}">${v.run ? "●" : "○"}</b></button>
        <button class="botao" data-mandato="${escapar(v.caminho)}" data-chave="cabecalho.enviar" data-para="${proximoEnviar}" title="escreve enviar: ${proximoEnviar} na ficha — é o gatilho que deixa a mesa mandar ao venue" aria-label="enviar ${v.quem}: ${v.enviar ? "desligar" : "ligar"}">enviar <b class="${v.enviar ? "venda-txt" : "fraco"}">${v.enviar ? "●" : "○"}</b></button>
        <span class="com" title="o mesmo gesto pela linha de comando">bash tools/ligar-par.sh ${escapar(v.quem)} ${v.run ? "nao" : "sim"}</span>
      </div>`;
    }).join("");

  const linhasDaCorrida = corridas.length === 0
    ? `<div class="fraco">nenhuma conta no fio — não se sabe que corrida pedir</div>`
    : corridas.map((c) => `<div class="linha-de-acao">
        <span class="quem">${escapar(c.conta)}</span>
        <button class="botao" data-verbo="iniciar" data-conta="${escapar(c.conta)}" data-dir="${escapar(c.dir)}" title="pede o arranque da observação desta conta — quem lança o processo é a camada de operação">iniciar</button>
        <button class="botao" data-verbo="parar" data-conta="${escapar(c.conta)}" data-dir="${escapar(c.dir)}" title="pede a paragem da observação desta conta (pelo ficheiro de PID da pasta da corrida)">parar</button>
        <span class="com" title="o que executa este verbo hoje, na linha de comando">${escapar(c.iniciar)}</span>
      </div>`).join("");

  const lista = pendentes === null
    ? `<div class="fraco">${recado === null ? "a perguntar ao porto…" : escapar(recado)}</div>`
    : pendentes.length === 0
      ? `<div class="fraco">nenhum pedido à espera</div>`
      : pendentes.map((p) => `<div class="pedido pendente">
          <span class="quando mono">${escapar(hora(p.instante_ms))}</span>
          <span class="oque">${escapar(p.verbo)} · ${escapar(p.conta ?? "—")}<span class="fraco"> · ${escapar(desde(p.instante_ms))}</span></span>
          <button class="botao" data-cancelar="${escapar(p.id)}" aria-label="cancelar o pedido ${escapar(p.id)}">cancelar</button>
        </div>`).join("");

  caixa.innerHTML = `
    <div>
      <h4>O mandato, por par <span class="contagem">roda · envia — escreve a ficha, validada</span></h4>
      <div class="dentro">${linhasDeMandato}</div>
    </div>
    <div>
      <h4>O ciclo de vida <span class="contagem">pede — não arranca processos daqui</span></h4>
      <div class="dentro">${linhasDaCorrida}</div>
    </div>
    <div>
      <h4>Pedidos à espera <span class="contagem">${pendentes === null ? "—" : pendentes.length}</span></h4>
      <div class="dentro">
        ${lista}
        ${recado === null ? "" : `<div class="dito ${recadoValido() ? "" : "aviso"}" style="margin-top:4px">${escapar(recado)}</div>`}
      </div>
    </div>`;

  ligarOsGestos(caixa);
}

/* ------------------------------------------------------------------------------- os gestos da faixa */
function ligarOsGestos(caixa) {
  // 1. O MANDATO: pela porta das fichas — o mesmo escritor da linha de comando, com validação antes de aplicar.
  for (const b of caixa.querySelectorAll("[data-mandato]")) {
    b.onclick = async () => {
      const caminho = b.dataset.mandato;
      const f = (estado.dados?.configuracao?.fichas ?? []).find((x) => x.caminho === caminho);
      const para = b.dataset.para === "true";
      b.disabled = true;
      recado = null;
      try {
        const r = await fetch("/api/ficha", {
          method: "POST",
          headers: { "content-type": "application/json", "x-mesacore": "1" },
          body: JSON.stringify({ ficha: caminho, mudancas: { [b.dataset.chave]: para }, visto: f?.hash ?? null, simular: false }),
        });
        const d = await r.json();
        recado = d.ok === true ? `${b.dataset.chave} → ${para ? "sim" : "não"} · escrito e registado` : `recusado: ${d.porque ?? "sem motivo dito"}`;
      } catch (e) {
        recado = `não se conseguiu falar com o escritor (${e instanceof Error ? e.message : String(e)})`;
      }
      b.disabled = false;
      desenharAcoes();
    };
  }

  // 2. O CICLO DE VIDA: pedido na fila. Nada se executa daqui.
  for (const b of caixa.querySelectorAll("[data-verbo]")) {
    b.onclick = async () => {
      b.disabled = true;
      const r = await falarComOPorto({
        verbo: b.dataset.verbo,
        conta: b.dataset.conta,
        dir: b.dataset.dir,
        origem: "painel",
      });
      recado = r.ok === true ? `pedido registado (${r.pedido?.id ?? "?"}) — quem executa é a camada de operação` : `não se pediu: ${r.porque ?? "sem motivo dito"}`;
      await lerOsPendentes();
      b.disabled = false;
      desenharAcoes();
    };
  }

  // 3. CANCELAR: o `D` do CRUD.
  for (const b of caixa.querySelectorAll("[data-cancelar]")) {
    b.onclick = async () => {
      b.disabled = true;
      const r = await falarComOPorto({ id: b.dataset.cancelar }, "DELETE");
      recado = r.ok === true ? `pedido cancelado` : `não se cancelou: ${r.porque ?? "sem motivo dito"}`;
      await lerOsPendentes();
      b.disabled = false;
      desenharAcoes();
    };
  }
}

/** O que o porto disse por último — mostrado uma vez, no cabeçalho da faixa. */
export const recadoDoPorto = () => recado;

/** A faixa pede a fila ao porto na primeira vez que aparece; depois é o desenho que a mantém. */
export async function prepararAsAcoes() {
  if (pendentes === null) await lerOsPendentes();
}
