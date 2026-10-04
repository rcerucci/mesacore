/* ============================================================================================
 * A CONFIGURAÇÃO — em vista (o documento) e em diálogo (os itens da ficha), e o caminho de ESCRITA.
 *
 * PORQUE É UMA VISTA E NÃO UM DIÁLOGO. O que muda um interruptor é diálogo; o que muda um DOCUMENTO é
 * vista. A ficha tem regras de identidade, tipos, bandas e um veredicto de um conferidor que NÃO é esta
 * tela: isso cabe numa vista, cresce com cada plugin e não cabe numa caixa.
 *
 * O QUE ELA NÃO FAZ: NÃO ESCREVE NADA por si e NÃO JULGA NADA. Copia a conta e as fichas do fio e mostra
 * o relatório do conferidor TAL E QUAL. Onde se muda o estado hoje está escrito com o comando à vista:
 * uma porta só, a mesma que o gesto do dono já usa (RN-E12 · RN-M2).
 * ========================================================================================== */
import { estado, escapar, hora, instrumentoAtual, aplicarOsEstadosDeRecolher, ligarOsBotoesDeRecolher, redesenho } from "./nucleo.js";

/* ========================= A CONFIGURAÇÃO, NA VISTA =================== *
 * O DIÁLOGO DE CONFIGURAÇÃO SAIU (04/10/2026). Ele lia os itens do setup num diálogo aberto pelo botão
 * `config` do gráfico — uma SEGUNDA porta para a MESMA coisa, só de leitura, e onde nada se editava. O que
 * muda um DOCUMENTO vai a VISTA (`#configuracao`), e o botão `config` passou a ser um `<a href="#configuracao">`:
 * há UMA porta, e é a vista — onde se lê, se compõe e se escreve. Este módulo deixou de saber de diálogo.
 */

/* ---- A ESCRITA: compor, VALIDAR, e só então escrever (RN-E12 · RN-M2) ----------------------------------
 * O CAMINHO É SEMPRE O MESMO: **compor** → **validar** (o conferidor do portão corre sobre o CANDIDATO,
 * numa cópia da árvore das fichas) → **escrever** (o mesmo escritor, com a impressão do ficheiro que se
 * viu). A COMPOSIÇÃO VIVE NUMA VARIÁVEL, e não no DOM: o retrato renova a cada minuto e o desenho é
 * refeito — um campo que só existisse no DOM perdia o que o dono escreveu.
 */
let fichaEmComposicao = null;
/** A ficha EM VISTA na configuração — a escolhida na lista da esquerda (nunca «nenhuma» com a lista cheia). */
let fichaEscolhida = null;
const composicao = new Map(); // caminho -> { chave: valor que o dono escreveu }
const respostas = new Map();  // caminho -> a última resposta do escritor

function valorNoCaminho(o, chave) {
  let atual = o;
  for (const parte of chave.split(".")) {
    if (atual === null || typeof atual !== "object" || !(parte in atual)) return undefined;
    atual = atual[parte];
  }
  return atual;
}
function valorComposto(caminho, chave, seNaoHouver) {
  const c = composicao.get(caminho);
  return c !== undefined && Object.prototype.hasOwnProperty.call(c, chave) ? c[chave] : seNaoHouver;
}
/** As mudanças que o dono compôs — e só o que DIFERE do que está na ficha: o resto não viaja. */
function asMudancas(caminho) {
  const f = (estado.dados?.configuracao?.fichas ?? []).find((x) => x.caminho === caminho);
  if (!f) return {};
  const mudancas = {};
  for (const [chave, bruto] of Object.entries(composicao.get(caminho) ?? {})) {
    const atual = valorNoCaminho(f, chave);
    // O TIPO É O DA FICHA: um booleano fica booleano, um inteiro fica inteiro, e um decimal fica TEXTO (D4).
    const novo = typeof atual === "boolean" ? bruto === true || bruto === "true" : typeof atual === "number" ? Number(bruto) : bruto;
    if (JSON.stringify(novo) !== JSON.stringify(atual)) mudancas[chave] = novo;
  }
  return mudancas;
}

async function falarComOEscritor(corpo) {
  try {
    const r = await fetch("/api/ficha", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mesacore": "1" },
      body: JSON.stringify(corpo),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, porque: `não se conseguiu falar com o escritor (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** O que o escritor respondeu, à vista: o que muda, o veredicto, o relatório dele e o que se fez. */
function blocoDaResposta(r) {
  const dif = (r.diferencas ?? []).map((d) => `<div class="item-de-config"><span class="nome-do-item">${escapar(d.chave)}</span>
    <span class="valor mono">${escapar(String(d.de))} <span class="fraco">→</span> <b>${escapar(String(d.para))}</b></span></div>`).join("");
  const v = r.veredicto ?? null;
  const veredicto = v === null ? "" : `<div class="nota fraco" style="margin-top:6px">conferidor do portão: ${
      v.correu ? `código ${v.codigo}` : "não correu"
    } · ${v.estaFichaAprovou === true ? "esta ficha passou" : v.estaFichaAprovou === false ? "<b>esta ficha REPROVOU</b>" : "sem veredicto desta ficha"}</div>
    <details class="relatorio"><summary>o que ele disse</summary><pre class="relatorio-do-conferidor">${escapar(v.saida ?? "")}</pre></details>`;
  return `<div class="resultado ${r.ok ? "bom" : "mau"}">
    <div class="mini"><b>${r.escrito ? "ESCRITO — e registado" : r.ok ? "validado: nada foi escrito" : "RECUSADO"}</b>${r.porque ? ` — ${escapar(r.porque)}` : ""}</div>
    ${dif}
    ${veredicto}
  </div>`;
}

/** O que cada botão faz. A tela PEDE; quem decide é o escritor. */
async function agirNaFicha(acao, caminho) {
  if (acao === "compor") { fichaEmComposicao = caminho; respostas.delete(caminho); desenharAConfiguracao(); return; }
  if (acao === "cancelar") { fichaEmComposicao = null; composicao.delete(caminho); respostas.delete(caminho); desenharAConfiguracao(); return; }

  const mudancas = asMudancas(caminho);
  if (Object.keys(mudancas).length === 0) {
    respostas.set(caminho, { ok: false, porque: "não mudaste nada ainda (os campos estão iguais aos da ficha)" });
    desenharAConfiguracao();
    return;
  }
  const f = (estado.dados?.configuracao?.fichas ?? []).find((x) => x.caminho === caminho);
  if (acao === "validar") {
    respostas.set(caminho, { aviso: "a validar…" });
    desenharAConfiguracao();
    respostas.set(caminho, await falarComOEscritor({ ficha: caminho, mudancas, visto: f?.hash ?? null, simular: true }));
    desenharAConfiguracao();
    return;
  }
  if (acao === "escrever") {
    // A IMPRESSÃO VAI SEMPRE: se a ficha mudou desde que a página a leu, o escritor recusa e diz porquê.
    const r = await falarComOEscritor({ ficha: caminho, mudancas, visto: f?.hash ?? null, simular: false });
    respostas.set(caminho, r);
    if (r.ok === true) { fichaEmComposicao = null; composicao.delete(caminho); }
    desenharAConfiguracao();
    if (r.ok === true) redesenho.recarregar(); // o retrato novo mostra a ficha como ela ficou
  }
}

/** Um objecto qualquer (a conta, o cabeçalho) como LINHAS de uma tabela densa: `chave | valor`. Em composição o
 *  valor vira CAMPO — menos as três chaves de identidade (`conta`, `instrumento`, `setup`), que não se editam:
 *  mudá-las não é editar a ficha, é RENOMEAR o ficheiro. */
const CHAVES_DE_IDENTIDADE = ["cabecalho.conta", "cabecalho.instrumento", "cabecalho.setup"];
/** AS CHAVES QUE VIVEM NA FAIXA DOS COMANDOS, e nao na tabela do documento (`run`/`enviar`). Mostra-las nos dois
 *  sitios era o «duplicado» medido a 04/10/2026: a MESMA chave em dois sitios do ecrã. Aqui a tabela é o DOCUMENTO
 *  (identidade, risco, bandas, constantes) e o interruptor é o GESTO — que vive na faixa, a vista, onde se muda. */
const CHAVES_NA_FAIXA = ["cabecalho.run", "cabecalho.enviar"];
function linhasDoObjeto(o, prefixo = "", compor = false, f = null) {
  return Object.entries(o).map(([k, v]) => {
    const chave = prefixo === "" ? k : `${prefixo}.${k}`;
    if (CHAVES_NA_FAIXA.includes(chave)) return "";   // o interruptor vive na faixa dos comandos
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return linhasDoObjeto(v, chave, compor, f);
    const podeEditar = compor && !CHAVES_DE_IDENTIDADE.includes(chave);
    const valorDeVerdade = v;
    const mostrado = podeEditar && f !== null ? valorComposto(f.caminho, chave, valorDeVerdade) : valorDeVerdade;
    const bruto = Array.isArray(mostrado) ? mostrado.join(" · ") : mostrado === true ? "sim" : mostrado === false ? "não" : String(mostrado);
    // O VAZIO É DITO: um valor declarado e vazio mostra `(vazio)`, não um buraco silencioso (quem lê não sabe se
    // o campo não existe ou se está em branco).
    const valor = bruto.trim() === "" ? "(vazio)" : bruto;
    // O valor que o leitor escondeu por parecer segredo aparece DITO, não em branco.
    const escondido = valor === "(nao se mostra)";
    const campo = !podeEditar
      ? `<span class="mono ${escondido ? "aviso" : ""}">${escapar(escondido ? "(escondido: parece segredo)" : valor)}${compor && CHAVES_DE_IDENTIDADE.includes(chave) ? ` <span class="fraco">· identidade, não se edita</span>` : ""}</span>`
      : typeof valorDeVerdade === "boolean" || chave === "cabecalho.ao_desligar"
        ? `<select data-chave="${escapar(chave)}">${
            (chave === "cabecalho.ao_desligar" ? ["fechar", "manter"] : ["true", "false"])
              .map((op) => `<option value="${op}" ${String(mostrado) === op ? "selected" : ""}>${
                op === "true" ? "sim" : op === "false" ? "não" : op}</option>`).join("")
          }</select>`
        : `<input type="text" inputmode="decimal" data-chave="${escapar(chave)}" value="${escapar(String(mostrado))}">`;
    return `<tr class="${podeEditar ? "composto" : ""}"><td class="fraco">${escapar(chave)}</td><td class="n">${campo}</td></tr>`;
  }).join("");
}

/* ========================= A CREDENCIAL DA CONTA: o valor vive FORA, a tela mostra só a FORMA =============
 * O dono cola o VALOR de uma chave na tela e ele fica gravado no padrão da casa — um ficheiro por valor, FORA do
 * repositório, modo 600 — e a conta continua a apontar-lhe por REFERÊNCIA. O campo vem do `questionario.json` do
 * conector (`tipo: segredo`); a porta é a MESMA que existe (`tools/guardar-credencial.sh`, modo `gravar-de-stdin`).
 * O valor NUNCA entra no fio, num log ou no histórico: vai pelo `POST /api/credencial` e o servidor entrega-o ao
 * escritor pelo STDIN. A tela mostra de volta só a FORMA (comprimento + primeiros) e a impressão.
 */
let recadoDaCredencial = null; // { conta, ok, forma, impressao, porque }

async function falarComOCredencial(conta, valor) {
  try {
    const r = await fetch("/api/credencial", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mesacore": "1" },
      body: JSON.stringify({ conta, valor }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, porque: `não se conseguiu falar com o servidor (${e instanceof Error ? e.message : String(e)})` };
  }
}

function blocoDaCredencial(c) {
  const contas = (c.contas ?? []).filter((x) => x.nome);
  if (contas.length === 0) return "";
  const linhas = contas.map((conta) => {
    const ref = conta.conteudo?.conexao?.credencial?.valor_em ?? null;
    const caminho = typeof ref === "string" && ref.startsWith("ficheiro:") ? ref.slice("ficheiro:".length) : (conta.conteudo ? "—" : "(conta ilegível)");
    const r = recadoDaCredencial?.conta === conta.nome ? recadoDaCredencial : null;
    const recado = r === null ? "" : r.aviso
      ? `<small class="fraco">${escapar(r.aviso)}</small>`
      : r.ok
        ? `<small class="fraco">gravada · forma ${r.forma?.comprimento ?? "?"} car., começa por «${escapar(r.forma?.primeiros ?? "")}» · impressão ${escapar(String(r.impressao ?? "").slice(0, 12))}…</small>`
        : `<small class="venda-txt">RECUSADO — ${escapar(r.porque ?? "sem motivo dito")}</small>`;
    return `<tr><td class="fraco">${escapar(conta.nome)}<small class="fraco mono" title="${escapar(String(caminho))}">${escapar(String(caminho).split("/").pop() ?? "")}</small></td>
      <td class="n"><input type="password" data-credencial="${escapar(conta.nome)}" autocomplete="off" spellcheck="false" placeholder="cole o VALOR da chave" title="o valor não passa pelo fio: vai para o ficheiro por referência, fora do repositório, 0600">
      <button class="botao" data-acao="gravar-credencial" data-conta="${escapar(conta.nome)}">gravar</button>${recado}</td></tr>`;
  }).join("");
  return `<div class="secao"><h4 class="cabeca">A credencial da conta <span class="contagem">uma chave por ficheiro · fora do repositório · 0600</span></h4>
    <table class="tab"><tbody>${linhas}</tbody></table></div>`;
}

/** Onde a config foi buscar cada coisa — e o que ela NÃO abre (o segredo aponta-se por caminho). As quatro linhas que repetiam `cabecalho.conta/setup/relogio/
 *  ao_desligar` (que já estão na tabela acima, com o valor) eram a mesma chave em DOIS sítios — o «duplicado» que o
 *  dono reportou. Ficam as duas que dizem o que a tabela NÃO diz: o caminho do ficheiro e o segredo (por caminho). */
function procedencias(f, c) {
  return `<table class="tab"><tbody>
    <tr><td class="fraco">ficha</td><td class="n">${escapar(f.caminho ?? "—")}</td></tr>
    <tr><td class="fraco" title="o segredo não passa por aqui: a conta aponta para ele por caminho e esta tela não abre o ficheiro${c.segredos_escondidos > 0 ? ` · ${c.segredos_escondidos} valor(es) escondido(s) por parecerem segredo` : ""}">segredo</td><td class="n fantasma">por caminho · não se abre</td></tr>
  </tbody></table>`;
}

/* ========================= CRIAR: compor → validar → criar, e SÓ cria o que ainda não existe ==============
 * O que se cria: uma FICHA DE PAR (`fichas/<setup>/<PAR>-<conta>.json`) e uma CONTA (`config/contas/<nome>.json`).
 * O que NÃO se cria aqui: um SETUP — um setup é um PLUGIN (manifesto + código + `setup.json`), e um formulário que
 * fingisse criá-lo seria pior do que não ter nada. A tela diz o que ele é e onde vive; quem o escreve é quem
 * programa.
 *
 * A FORMA VEM DO QUE EXISTE, nunca de um esquema reimplementado na tela: uma ficha nova clona a ficha do MESMO
 * setup (e troca a identidade, o relógio e desarma os dois interruptores — um par novo não nasce armado); uma
 * conta nova clona a conta que existe. Quem julga é o conferidor do portão, e a recusa dele é a resposta.
 */
let modoDeCriacao = null;      // null | { tipo: "ficha" | "conta" | "setup"; conector?: string; campos: Record<string,string> }
const criacao = new Map();     // caminho pedido -> a última resposta do escritor

function fichaModelo(setup) {
  return (estado.dados?.configuracao?.fichas ?? []).find((f) => f.cabecalho?.setup === setup) ?? null;
}
/** Os setups conhecidos — do que corre (o fio) e do modelo de ficha que existe no repositório. */
function setupsConhecidos() {
  const doFio = (estado.dados?.plugins ?? []).map((p) => p.nome);
  const dasFichas = (estado.dados?.configuracao?.fichas ?? []).map((f) => f.cabecalho?.setup).filter(Boolean);
  return [...new Set([...doFio, ...dasFichas])];
}

/* ============ A CONTA NASCE DO QUE O CONECTOR DECLARA (nunca de um formulário fixo nesta tela) ============
 * O `questionario.json` de cada plugin é a fonte dos campos — o MESMO ficheiro que a entrevista de linha de
 * comando segue (`tools/preparar-contas`). O fio publica-o no `catalogo`, e esta vista só o segue: um conector
 * novo entra com um ficheiro novo, sem se tocar aqui. O que a tela NÃO faz: presumir um valor que o conector não
 * declarou. Campo obrigatório em falta RECUSA — com o nome dele — em vez de inventar um vazio.
 */
function conectoresQueCriamConta() {
  return (estado.dados?.catalogo?.conectores ?? []).filter((c) => (c.escreve_em ?? "conta") === "conta");
}
/** O conector que esta vista usa por OMISSÃO: o que JÁ SE USA (uma conta que existe aponta-o), não o primeiro da
 *  lista por ordem alfabética. Quem abre «+ conta» quer outra conta do MESMO venue — e não um formulário de cTrader
 *  com 17 campos que não lhe dizem nada (que foi o que abria, e o dono leu como «cheio de erros»). */
function conectorPorOmissao() {
  const cs = conectoresQueCriamConta();
  const jaUsados = (estado.dados?.configuracao?.contas ?? []).flatMap((x) => x.conteudo?.conta?.conectores ?? []);
  return cs.find((c) => jaUsados.includes(c.plugin)) ?? cs[0] ?? null;
}
function oConector() {
  const cs = conectoresQueCriamConta();
  return cs.find((c) => c.plugin === modoDeCriacao?.conector) ?? conectorPorOmissao();
}
/** Um campo que a tela NÃO deixa digitar: o valor de um segredo vive fora (num ficheiro protegido), e o que
 *  viaja é o NOME da credencial ou o CAMINHO para o valor. */
const ehSensivel = (q) => q.sensivel === true || q.tipo === "segredo";
/** O que a pergunta responde: o que o dono escreveu, ou a omissão DECLARADA pelo conector (com `{{conta}}`). */
function valorDaPergunta(q, campos, nome) {
  if (Object.prototype.hasOwnProperty.call(campos, q.id)) return campos[q.id];
  const o = q.omissao;
  return typeof o === "string" ? o.replace(/\{\{conta\}\}/g, nome ?? "") : o;
}
/** O tipo do valor é o que o CONECTOR declara (D4: o número viaja em TEXTO; uma lista vira lista). */
function valorTipado(q, bruto) {
  if (q.tipo === "lista") return String(bruto).split(",").map((x) => x.trim()).filter((x) => x !== "");
  if (q.tipo === "inteiro" || q.tipo === "decimal") return String(bruto).trim();
  return String(bruto);
}
function porCaminhoPontuado(doc, chave, valor) {
  const partes = String(chave).split(".");
  let atual = doc;
  for (const p of partes.slice(0, -1)) { if (atual[p] === undefined || typeof atual[p] !== "object") atual[p] = {}; atual = atual[p]; }
  atual[partes[partes.length - 1]] = valor;
}
/** O candidato de uma CONTA, composto a partir da declaração do conector escolhido. */
function contaAPartirDaDeclaracao(campos) {
  const conector = oConector();
  if (conector === null) return { caminho: null, documento: null, porque: "nenhum conector publica um questionário de conta — não há campos que esta tela possa seguir" };
  const nome = String(campos.nome ?? "").trim();
  if (nome === "") return { caminho: null, documento: null, porque: "dê o nome do ficheiro da conta (é a pergunta «nome_da_conta» do conector)" };
  const doc = {};
  for (const [k, v] of Object.entries(conector.preenche_sempre ?? {})) if (k !== "nota") porCaminhoPontuado(doc, k, v);
  const faltam = [];
  for (const q of conector.perguntas ?? []) {
    if (q.id === "nome_da_conta" || q.chave === "(nome do ficheiro)") continue;
    if (q.tipo === "segredo") {
      // O VALOR DE UM SEGREDO NUNCA ENTRA AQUI. O que o documento leva é a REFERÊNCIA ao ficheiro protegido —
      // a MESMA regra da entrevista de linha de comando (`preparar-contas.sh`: `ficheiro:$CREDENCIAIS/<conta>.key`),
      // com o valor a ser posto por `tools/guardar-credencial.sh` (fora do repositório, modo 600, RN-E14).
      porCaminhoPontuado(doc, q.chave, `ficheiro:~/.config/mesacore/credenciais/${nome}.key`);
      continue;
    }
    const bruto = valorDaPergunta(q, campos, nome);
    if (bruto === null || bruto === undefined || String(bruto).trim() === "") {
      if (q.obrigatorio) faltam.push(q.pergunta ?? q.chave);   // a casa NÃO presume: em falta, RECUSA com nome
      continue;
    }
    porCaminhoPontuado(doc, q.chave, valorTipado(q, bruto));
  }
  if (faltam.length > 0) {
    // ISTO NÃO É UM ERRO — é o estado do formulário a meio. Diz-se o que FALTA, com o nome, em tom NEUTRO: o
    // vermelho fica reservado para a RECUSA a sério (do conferidor ou do escritor). Antes, abrir «+ conta» era
    // abrir uma parede vermelha de «campos obrigatórios em falta» — o dono leu isso como «cheio de erros».
    return { caminho: null, documento: null, porque: null, por_preencher: faltam };
  }
  return { caminho: `config/contas/${nome}.json`, documento: doc, conector: conector.plugin, porque: null, por_preencher: [] };
}

/** O candidato COMPOSTO a partir do modelo — o que vai ser validado (e o que se mostra, para não haver surpresa).
 *  `porque` é uma RECUSA (vermelha); `por_preencher` é o que ainda falta escrever (neutro) — dois estados diferentes. */
function candidatoComposto() {
  if (modoDeCriacao === null) return { caminho: null, documento: null, porque: null, por_preencher: [] };
  const c = modoDeCriacao.campos;
  if (modoDeCriacao.tipo === "ficha") {
    const modelo = fichaModelo(c.setup);
    if (modelo === null) return { caminho: null, documento: null, porque: `não há nenhuma ficha do setup «${c.setup ?? "?"}» para servir de modelo — a forma da ficha vem do que existe`, por_preencher: [] };
    if (!c.instrumento || !c.conta) return { caminho: null, documento: null, porque: null, por_preencher: ["instrumento", "conta"] };
    const cabecalho = { ...modelo.cabecalho, conta: c.conta, instrumento: c.instrumento, setup: c.setup, relogio: c.relogio || modelo.cabecalho?.relogio, run: false, enviar: false };
    const documento = { cabecalho, constantes: { ...modelo.constantes } };
    return { caminho: `fichas/${c.setup}/${c.instrumento}-${c.conta}.json`, documento, porque: null, por_preencher: [] };
  }
  if (modoDeCriacao.tipo === "conta") return contaAPartirDaDeclaracao(c);
  return { caminho: null, documento: null, porque: null, por_preencher: [] };
}

/** A LINHA DO ESTADO DO CANDIDATO, e não uma só: o que ainda FALTA preencher é NEUTRO (é o formulário a meio); a
 *  RECUSA (do conferidor ou do escritor) é vermelha. Misturar as duas coisas — como antes — fazia o formulário
 *  abrir «cheio de erros» antes de o dono ter escrito nada. */
function linhaDoCandidato(composto) {
  const porPreencher = composto.por_preencher.length > 0
    ? `<div class="fraco" id="por-preencher"><b>por preencher</b> (${composto.por_preencher.length}): ${escapar(composto.por_preencher.join(" · "))} — o conector recusa sem eles</div>`
    : "";
  const recusa = composto.porque !== null ? `<div class="aviso" id="aviso-do-candidato">${escapar(composto.porque)}</div>` : "";
  return porPreencher + recusa;
}

/** UM CAMPO DO QUESTIONÁRIO, EM TRÊS LINHAS — e não numa linha só.
 *
 *  1. a PERGUNTA (o que se responde), com o tipo e se é obrigatório à direita;
 *  2. o CONTROLE (input ou `select` com as opções que o conector declara);
 *  3. a RÉGUA — a chave do documento, em mono, e o que o conector JÁ DECLARA (a omissão), para se ver o que é
 *     resposta do dono e o que é proposta do conector.
 *
 * Antes saía tudo colado numa célula («…?texto · obrigatórioconta.identificador»), com a pergunta repetida ao lado
 * do campo: não se lia, e quem preenchia não sabia o que era pergunta e o que era chave. */
function campoDoQuestionario(q, campos, nomeDaConta) {
  const id = `q-${String(q.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const valor = valorDaPergunta(q, campos, nomeDaConta);
  const tipo = q.obrigatorio ? `<b class="obrig" title="obrigatório: sem ele o conector recusa">obrigatório</b> · ${escapar(q.tipo)}` : `<span class="fraco">opcional</span> · ${escapar(q.tipo)}`;
  const declarado = q.omissao === null || q.omissao === undefined
    ? ""
    : ` · o conector declara <b class="mono">${escapar(String(q.omissao).replace(/\{\{conta\}\}/g, nomeDaConta ?? ""))}</b>`;
  const porPreencher = q.obrigatorio && (valor === null || valor === undefined || String(valor).trim() === "");
  let controle;
  if (q.tipo === "segredo") {
    // O VALOR DE UM SEGREDO NÃO ENTRA AQUI: nem o campo, nem a omissão. O que se diz é a porta que o põe.
    controle = `<div class="campo-sem-valor">o valor não passa por esta tela — ponha-o com <code class="comando mono">bash tools/guardar-credencial.sh gravar ${escapar(q.id)}</code></div>`;
  } else if (q.tipo === "enum" && Array.isArray(q.opcoes)) {
    controle = `<select id="${id}" data-novo="${escapar(q.id)}">${q.opcoes.map((o) => `<option value="${escapar(o)}" ${String(valor) === o ? "selected" : ""}>${escapar(o)}</option>`).join("")}</select>`;
  } else {
    controle = `<input id="${id}" type="text" data-novo="${escapar(q.id)}" value="${escapar(valor ?? "")}" placeholder="${escapar(q.exemplo ?? "")}"${ehSensivel(q) ? ' class="sensivel"' : ""}>${ehSensivel(q) ? `<div class="regua">só o caminho viaja · o valor vive fora</div>` : ""}`;
  }
  return `<div class="campo${porPreencher ? " por-preencher" : ""}">
    <label class="rot" for="${id}" title="${escapar(q.explicacao ?? "")}">${escapar(q.pergunta ?? q.id)} <span class="tipo">${tipo}</span></label>
    ${controle}
    <div class="regua mono">${escapar(q.chave ?? "")}${declarado}</div>
  </div>`;
}

/** AS SECÇÕES DO QUESTIONÁRIO — os campos agrupados pela RAIZ da chave (`conta.*` → «A conta», `conexao.*` → «A
 *  ligação ao venue»). Um documento de 14 campos numa lista rasa não se lê; com título por grupo, lê-se. */
const NOME_DA_SECCAO = { conta: "A conta", conexao: "A ligação ao venue", risco: "O risco", outros: "Outros campos" };
function secoesDoQuestionario(perguntas, campos, nomeDaConta) {
  const grupos = new Map();
  for (const q of perguntas) {
    if (q.id === "nome_da_conta" || q.chave === "(nome do ficheiro)") continue;
    const raiz = String(q.chave ?? "outros").split(".")[0] || "outros";
    if (!grupos.has(raiz)) grupos.set(raiz, []);
    grupos.get(raiz).push(q);
  }
  return [...grupos.entries()].map(([raiz, qs]) =>
    `<div class="secao-do-formulario"><h4 class="titulo-da-seccao">${escapar(NOME_DA_SECCAO[raiz] ?? raiz)}</h4>` +
    qs.map((q) => campoDoQuestionario(q, campos, nomeDaConta)).join("") + `</div>`).join("");
}

function formularioDeCriacao() {
  const campos = modoDeCriacao.campos;
  // UM CAMPO, EM TRÊS LINHAS: o rótulo (o que se responde) · o controle · a régua (a chave do documento e o tipo).
  // Antes eram duas células de uma tabela rasa, com o rótulo a repetir-se ao lado do campo.
  const campo = (nome, rotulo, dica = "", opcoes = null) => {
    const id = `s-${escapar(nome)}`;
    const controle = opcoes
      ? `<select id="${id}" data-novo="${escapar(nome)}">${opcoes.map((o) => `<option value="${escapar(o)}" ${campos[nome] === o ? "selected" : ""}>${escapar(o)}</option>`).join("")}</select>`
      : `<input id="${id}" type="text" data-novo="${escapar(nome)}" value="${escapar(campos[nome] ?? "")}" placeholder="${escapar(dica)}">`;
    return `<div class="campo">
      <label class="rot" for="${id}">${escapar(rotulo)} <span class="tipo"><b class="obrig">obrigatório</b></span></label>
      ${controle}
      <div class="regua mono">${escapar(dica || "")}</div>
    </div>`;
  };

  if (modoDeCriacao.tipo === "setup") {
    return `<div class="aviso">um setup não é um documento — é um PLUGIN: um <b>manifesto</b> (<code>setups/&lt;nome&gt;/setup.json</code>),
      o <b>código</b> que publica a série e a proposta, e a entrada no <code>setup.json</code> do repositório. Um formulário aqui
      fingiria criá-lo. O que a tela pode fazer é apontar o sítio: <code>setups/</code> · <code>setups/O-QUE-UM-SETUP-RECEBE-E-ENTREGA.md</code>
      · e a ficha de um par novo (o botão <b>+ ficha de par</b>) já compõe a configuração a partir do template dele.</div>`;
  }

  if (modoDeCriacao.tipo === "conta") {
    const conector = oConector();
    const composto = candidatoComposto();
    const resposta = composto.caminho === null ? null : (criacao.get(composto.caminho) ?? null);
    if (conector === null) {
      return `<div class="aviso">nenhum conector publica um questionário (<code>brokers/&lt;venue&gt;/questionario.json</code>) — sem essa declaração
        esta tela não sabe que campos pedir, e não os inventa. O que se cria mesmo assim: uma ficha de par (o botão <b>+ ficha de par</b>).</div>`;
    }
    const escolha = `<select id="q-conector" data-novo="__conector">${conectoresQueCriamConta().map((c) => `<option value="${escapar(c.plugin)}" ${c.plugin === conector.plugin ? "selected" : ""}>${escapar(c.plugin)} · ${c.perguntas.length} campos</option>`).join("")}</select>`;
    // O QUESTIONÁRIO EM SECÇÕES: os campos agrupados pela RAIZ da chave (`conta.*` · `conexao.*`), cada um em três
    // linhas — a pergunta, o controle e a régua (chave · tipo · o que o conector já declara). Era uma tabela rasa de
    // 14 linhas com tudo colado («…?texto · obrigatórioconta.identificador») e a pergunta repetida ao lado do campo.
    const linhas = secoesDoQuestionario(conector.perguntas ?? [], campos, campos.nome ?? "");
    const mostraDoc = composto.documento === null ? "" : `
      <div class="mini fraco" style="margin-top:4px">o que vai ser escrito${composto.caminho ? ` em <b class="mono">${escapar(composto.caminho)}</b>` : ""}:</div>
      <table class="tab"><tbody>${Object.entries(composto.documento.conexao ?? {}).map(([k, v]) => `<tr><td class="fraco">conexao.${escapar(k)}</td><td class="n mono">${escapar(v !== null && typeof v === "object" ? JSON.stringify(v) : String(v))}</td></tr>`).join("")}
        ${Object.entries(composto.documento.conta ?? {}).map(([k, v]) => `<tr><td class="fraco">conta.${escapar(k)}</td><td class="n mono">${escapar(Array.isArray(v) ? v.join(" · ") : String(v))}</td></tr>`).join("")}</tbody></table>
      <div class="botoes-da-ficha">
        <button class="botao" data-acao="validar-criacao">validar o candidato</button>
        <button class="botao escreve" data-acao="criar">criar o documento</button>
        <button class="botao" data-acao="fechar-criacao">desistir</button>
      </div>
      ${resposta ? blocoDaResposta(resposta) : ""}`;
    return `
      <div class="campo">
        <label class="rot" for="q-conector">conector <span class="tipo">é dele que vêm os campos</span></label>
        ${escolha}
        <div class="regua mono">${escapar(conector.ficheiro)} · ${(conector.perguntas ?? []).length} campo(s)${conector.tem_segredos ? ` · ${(conector.perguntas ?? []).filter((q) => ehSensivel(q)).length} sensível(is): o valor nunca entra aqui` : ""}</div>
      </div>
      ${campo("nome", "nome do ficheiro", "ex.: " + (conector.conta_de_exemplo ?? "conta"))}
      ${linhas}
      ${linhaDoCandidato(composto)}
      ${mostraDoc}
      ${composto.documento !== null ? "" : `<div class="botoes-da-ficha"><button class="botao" data-acao="fechar-criacao">desistir</button></div>`}
      <div class="mini fraco" style="margin-top:4px">a criação passa pela MESMA porta: o candidato é conferido pelo mesmo conferidor,
        escreve-se atómico, e o registo leva a origem e a hora. Um ficheiro que já exista é RECUSADO — criar não é sobrepor.</div>`;
  }

  // A FICHA DE PAR: a forma vem do que existe (a ficha do mesmo setup) — um esquema aqui seria uma segunda conta.
  const composto = candidatoComposto();
  const resposta = composto.caminho === null ? null : (criacao.get(composto.caminho) ?? null);
  return `
    <div class="secao-do-formulario"><h4 class="titulo-da-seccao">O par</h4>
      ${campo("setup", "setup", "", setupsConhecidos())}
      ${campo("instrumento", "instrumento", "ex.: BTC")}
      ${campo("conta", "conta", "", (estado.dados?.configuracao?.contas ?? []).map((x) => x.nome))}
      ${campo("relogio", "relógio", "ex.: 30m")}
    </div>
    <div class="mini fraco" style="padding:2px 0">a forma vem da ficha do setup «${escapar(campos.setup ?? "")}»
      — a tela não inventa esquemas; quem julga o candidato é o conferidor do portão</div>
    ${linhaDoCandidato(composto)}
    ${composto.documento === null ? "" : `
      <div class="mini fraco" style="margin-top:4px">o que vai ser escrito${composto.caminho ? ` em <b class="mono">${escapar(composto.caminho)}</b>` : ""}:</div>
      <table class="tab"><tbody>${Object.entries({ ...(composto.documento.cabecalho ?? {}) }).map(([k, v]) => `<tr><td class="fraco">${escapar(k)}</td><td class="n mono">${escapar(Array.isArray(v) ? v.join(" · ") : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v))}</td></tr>`).join("")}</tbody></table>
      <div class="botoes-da-ficha">
        <button class="botao" data-acao="validar-criacao">validar o candidato</button>
        <button class="botao escreve" data-acao="criar">criar o documento</button>
        <button class="botao" data-acao="fechar-criacao">desistir</button>
      </div>
      ${resposta ? blocoDaResposta(resposta) : ""}`}
    ${composto.documento !== null ? "" : `<div class="botoes-da-ficha"><button class="botao" data-acao="fechar-criacao">desistir</button></div>`}
    <div class="mini fraco" style="margin-top:4px">a criação passa pela MESMA porta: o candidato é conferido pelo mesmo conferidor,
      escreve-se atómico, e o registo leva a origem e a hora. Um ficheiro que já exista é RECUSADO — criar não é sobrepor.</div>`;
}

/** Os gestos do formulário de criação (campos + os três botões). */
function ligarOFormularioDeCriacao(caixa) {
  for (const campo of caixa.querySelectorAll("[data-novo]")) {
    campo.oninput = campo.onchange = () => {
      if (campo.dataset.novo === "__conector") {
        // TROCAR DE CONECTOR REINICIA AS RESPOSTAS: os campos são OUTROS (o cTrader tem quatro caminhos de
        // credencial, o Hyperliquid tem uma chave). Guardar o que estava escrito misturava duas declarações — e o
        // nome do ficheiro, esse, é o pior: ficava o do conector anterior (MEDIDO na prova do catálogo: um
        // formulário trocado para outro conector criava um ficheiro com o nome de exemplo do PRIMEIRO).
        modoDeCriacao.conector = campo.value;
        const novo = conectoresQueCriamConta().find((c) => c.plugin === campo.value);
        modoDeCriacao.campos = { nome: novo?.conta_de_exemplo ?? "" };
      } else {
        modoDeCriacao.campos[campo.dataset.novo] = campo.value;
      }
      desenharAConfiguracao();
    };
  }
  for (const b of caixa.querySelectorAll("[data-acao='validar-criacao'], [data-acao='criar'], [data-acao='fechar-criacao']")) {
    b.onclick = () => void agirNaCriacao(b.dataset.acao);
  }
}

function abrirACriacao(tipo) {
  const contas = (estado.dados?.configuracao?.contas ?? []).map((c) => c.nome);
  const fichas = estado.dados?.configuracao?.fichas ?? [];
  // OS CAMPOS DE ESCOLHA NASCEM PREENCHIDOS com o que existe: um formulário que abre com um `<select>` por
  // escolher deixa o candidato incompleto e o botão de criar nunca aparece — «diga o instrumento e a conta» é uma
  // resposta honesta, mas um formulário que já tem a conta certa poupa o gesto.
  // Na CONTA, o campo de partida é o `nome_da_conta` que o CONECTOR declara como exemplo — e o conector por
  // omissão é o que JÁ SE USA (ver `conectorPorOmissao`), para não abrir um formulário de outro venue.
  const primeiro = conectorPorOmissao();
  modoDeCriacao = {
    tipo,
    conector: tipo === "conta" ? (primeiro?.plugin ?? null) : undefined,
    campos: tipo === "ficha"
      ? { setup: setupsConhecidos()[0] ?? "", conta: contas[0] ?? "", relogio: fichas[0]?.cabecalho?.relogio ?? "" }
      : tipo === "conta"
        ? { nome: primeiro?.conta_de_exemplo ?? "" }
        : {},
  };
  desenharAConfiguracao();
}

async function agirNaCriacao(acao) {
  if (acao === "fechar-criacao") { modoDeCriacao = null; desenharAConfiguracao(); return; }
  const composto = candidatoComposto();
  if (composto.caminho === null || composto.documento === null) return;
  const simular = acao === "validar-criacao";
  criacao.set(composto.caminho, { aviso: simular ? "a validar…" : "a criar…" });
  desenharAConfiguracao();
  const r = await falarComOEscritor({ ficha: composto.caminho, conteudo: composto.documento, criar: true, simular });
  criacao.set(composto.caminho, r);
  if (r.ok === true && r.escrito === true) modoDeCriacao = null; // criado: volta à vista da ficha
  desenharAConfiguracao();
  if (r.ok === true && r.escrito === true) redesenho.recarregar();
}

export function desenharAConfiguracao() {
  const c = estado.dados?.configuracao ?? null;
  const caixa = document.getElementById("config-corpo");
  document.getElementById("config-do-retrato").textContent = `do retrato de ${hora(estado.dados?.retrato?.gerado_em_ms)}`;
  if (c === null) {
    caixa.innerHTML = `<div class="aviso">o retrato não traz a configuração: não há conta nem fichas para mostrar</div>`;
    return;
  }
  const contas = c.contas ?? [];
  const fichas = c.fichas ?? [];
  // A FICHA EM VISTA: a escolhida, ou a primeira. Nunca «nenhuma» com a lista cheia — uma vista sem escolha é uma
  // vista que não mostra nada.
  if (fichaEscolhida === null || !fichas.some((x) => x.caminho === fichaEscolhida)) fichaEscolhida = fichas[0]?.caminho ?? null;
  const f = fichas.find((x) => x.caminho === fichaEscolhida) ?? null;
  const compor = f !== null && fichaEmComposicao === f.caminho;
  const resposta = f ? (respostas.get(f.caminho) ?? null) : null;
  const veredicto = c.conferidor?.correu
    ? (c.conferidor.codigo === 0 ? { classe: "vivo", texto: "aprovou" } : { classe: "teste", texto: `reprovou (${c.conferidor.codigo})` })
    : { classe: "teste", texto: "não correu" };

  const linhasDaLista = `
    <div class="lh grupo">Fichas · ${fichas.length}</div>    ${fichas.map((x) => `<div class="lr" role="option" tabindex="0" data-ficha="${escapar(x.caminho)}" aria-selected="${x.caminho === fichaEscolhida}">
      <span class="par">${escapar(x.cabecalho?.instrumento ?? "?")}<span class="fraco" style="font-size:10px">${escapar(x.cabecalho?.setup ?? "")}</span></span>
      <span class="estado mono ${x.cabecalho?.run ? "compra-txt" : "fraco"}" title="rodar / enviar">${x.cabecalho?.run ? "R" : "·"}${x.cabecalho?.enviar ? "E" : "·"}</span>
    </div>`).join("")}
    <div class="lh grupo">Contas · ${contas.length}</div>
    ${contas.map((conta) => `<div class="lr" data-conta="${escapar(conta.caminho)}">
      <span class="par">${escapar(conta.nome ?? "?")}</span>
      <span class="estado mono ${conta.existe === true ? "" : "venda-txt"}" title="${escapar(conta.caminho)}${conta.existe === true ? "" : " · o ficheiro não existe neste repositório"}">${conta.existe === true ? "ok" : "falta"}</span>
    </div>`).join("")}`;

  const corpoDaFicha = f === null
    ? `<div class="aviso">nenhuma ficha no repositório — um par sem ficha não entra na operação</div>`
    : `
      <table class="tab"><tbody>${linhasDoObjeto(f.cabecalho ?? {}, "cabecalho", compor, f)}</tbody></table>
      <table class="tab">
        <thead><tr><th>constantes · as do indicador, e as únicas que vão ao setup</th><th class="n">valor</th></tr></thead>
        <tbody>${linhasDoObjeto(f.constantes ?? {}, "constantes", compor, f)}</tbody>
      </table>
      <table class="tab"><tbody>${procedencias(f, c)}</tbody></table>
      <div class="botoes-da-ficha">
        ${compor
          ? `<button class="botao" data-acao="validar" data-ficha="${escapar(f.caminho)}">validar a mudança</button>
             <button class="botao" data-acao="cancelar" data-ficha="${escapar(f.caminho)}">deixar como estava</button>
             ${resposta?.ok && !resposta.escrito ? `<button class="botao escreve" data-acao="escrever" data-ficha="${escapar(f.caminho)}">escrever a ficha</button>` : ""}`
          : `<button class="botao" data-acao="compor" data-ficha="${escapar(f.caminho)}">mudar esta ficha</button>
             ${resposta?.escrito ? `<span class="selo vivo sem-ponto">escrita — e registada</span>` : ""}`}
      </div>
      ${resposta ? blocoDaResposta(resposta) : ""}`;

  caixa.innerHTML = `
    <div class="config-grade">
      <aside class="col">
        <header class="cabeca-da-col"><span class="rot">O que existe</span></header>
        <div class="corpo-rolavel"><div class="matriz solta" id="lista-de-fichas" role="listbox" aria-label="fichas e contas">${linhasDaLista}</div></div>
        <div class="nova-linha">
          <button class="botao" data-nova="ficha" title="cria fichas/<setup>/<PAR>-<conta>.json a partir do template do setup">+ ficha de par</button>
          <button class="botao" data-nova="conta" title="cria config/contas/<nome>.json a partir da forma da conta que existe">+ conta</button>
          <button class="botao" data-nova="setup" title="um setup é um plugin (manifesto + código) — não se cria num formulário">+ setup</button>
        </div>
      </aside>

      <section class="col">
        <header class="cabeca-da-col">
          <span class="rot">${modoDeCriacao === null ? "A ficha" : `Criar · ${modoDeCriacao.tipo === "ficha" ? "ficha de par" : modoDeCriacao.tipo === "conta" ? "conta" : "setup"}`}</span>
          ${modoDeCriacao === null && f ? `<b class="mono">${escapar(f.cabecalho?.instrumento ?? "?")} · ${escapar(f.cabecalho?.setup ?? "?")}</b>` : ""}
          <span class="contagem">${modoDeCriacao !== null ? "novo documento" : compor ? "a compor" : "campos · só leitura"}</span>
        </header>
        <div class="corpo-rolavel" id="corpo-da-ficha">${modoDeCriacao !== null ? formularioDeCriacao() : corpoDaFicha}</div>
      </section>

      <aside class="col">
        <header class="cabeca-da-col">
          <span class="rot">Conferidor e escrita</span>
          <span class="contagem"><span class="selo ${veredicto.classe} sem-ponto">${escapar(veredicto.texto)}</span></span>
        </header>
        <div class="corpo-rolavel">
          <details class="relatorio"><summary>o relatório dele (${(c.conferidor?.saida ?? "").split("\n").length} linhas) — o mesmo conferidor do portão, sem reimplementar nada</summary>
            <pre class="relatorio-do-conferidor" title="tools/verificar-setup/fichas.py: esta tela não reimplementa as regras dele">${escapar(c.conferidor?.saida ?? "")}</pre>
          </details>
          <table class="tab"><tbody>
            <tr><td class="fraco" title="${escapar(c.porta_que_escreve ?? "")}">porta</td><td class="n mono">${f !== null ? `bash tools/ligar-par.sh ${escapar(f.cabecalho?.instrumento ?? "")} ${f.cabecalho?.run ? "nao" : "sim"}` : escapar(c.porta_que_escreve ?? "—")}</td></tr>
            <tr><td class="fraco" title="a validação antes de aplicar · a impressão do ficheiro que se viu · o pedido só é aceite vindo desta tela">guardas</td><td class="n">validação · impressão · origem</td></tr>
          </tbody></table>
          ${blocoDaCredencial(c)}
        </div>
      </aside>
    </div>

    <div class="acoes-grade" id="acoes"></div>`;

  // Os botões desta vista nascem agora: ligam-se no mesmo sítio que os da bancada.
  aplicarOsEstadosDeRecolher();
  ligarOsBotoesDeRecolher();
  // A ESCOLHA DE UMA FICHA redesenha só esta vista.
  for (const linha of caixa.querySelectorAll("#lista-de-fichas .lr[data-ficha]")) {
    const escolher = () => { fichaEscolhida = linha.dataset.ficha; desenharAConfiguracao(); };
    linha.onclick = escolher;
    linha.onkeydown = (e) => { if (e.target === linha && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); escolher(); } };
  }
  // OS CAMPOS E OS BOTÕES DA ESCRITA, ligados DEPOIS de desenhar: o desenho reescreve o HTML todo e um campo
  // novo nasceria sem gesto.
  for (const campo of caixa.querySelectorAll("[data-chave]")) {
    campo.oninput = campo.onchange = () => {
      const ficha = campo.closest("[data-chave]") !== null ? fichaEscolhida : null;
      if (ficha === null) return;
      const c2 = composicao.get(ficha) ?? {};
      c2[campo.dataset.chave] = campo.value;
      composicao.set(ficha, c2);
      // MEXER NUMA CHAVE INVALIDA O VEREDICTO ANTERIOR — e o botão de escrever sai no mesmo gesto.
      respostas.delete(ficha);
      for (const b of caixa.querySelectorAll(`[data-acao="escrever"][data-ficha="${CSS.escape(ficha)}"]`)) b.remove();
    };
  }
  for (const b of caixa.querySelectorAll("[data-acao]")) {
    b.onclick = () => { void agirNaFicha(b.dataset.acao ?? "", b.dataset.ficha ?? ""); };
  }
  for (const b of caixa.querySelectorAll("[data-nova]")) b.onclick = () => abrirACriacao(b.dataset.nova);
  // A CREDENCIAL: ler o valor do campo ANTES de redesenhar (o redesenho reescreve o DOM), entregar ao servidor, e
  // mostrar de volta só a FORMA. O valor não fica em variável nenhuma do módulo — some com o campo.
  for (const b of caixa.querySelectorAll("[data-acao='gravar-credencial']")) {
    b.onclick = async () => {
      const conta = b.dataset.conta;
      const campo = caixa.querySelector(`[data-credencial="${CSS.escape(conta)}"]`);
      const valor = campo ? campo.value : "";
      b.disabled = true;
      recadoDaCredencial = { conta, aviso: "a gravar a credencial…" };
      desenharAConfiguracao();
      const r = await falarComOCredencial(conta, valor);
      recadoDaCredencial = { conta, ...r };
      desenharAConfiguracao();
      if (r.ok === true) redesenho.recarregar();
    };
  }
  ligarOFormularioDeCriacao(caixa);
  desenharAcoes(); // a faixa dos comandos, com o estado que vem do fio
}

/** A faixa dos comandos: quem PEDE, quem executa, e o que está à espera. */
let desenharAcoes = () => {};
export function ligarAsAcoes(fn) { desenharAcoes = fn; }
export const fichaEmVista = () => fichaEscolhida;
