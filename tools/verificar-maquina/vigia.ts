// A BANCADA DO VIGIA (recorte 003). Este ficheiro responde aos modos da porta `vigia.sh`.
//
// `--arranque` (US1, T024): o vigia a governar a mesa, com as seis portas, uma de cada vez.
//
//   - prova-se a SEQUENCIA inteira: o comando entra no vigia, o vigia arranca a mesa como processo filho,
//     corre as portas, e a resposta que sai e a resposta QUE A MESA DEU;
//   - prova-se o que a T021 pede: quando as portas recusam, o **nome daquela porta** fica no registro do
//     vigia (`porta`), com o que se chegou a conferir - o motivo generico nao chega a ninguem;
//   - NAO se prova o comportamento da mesa (tem as bancadas dela) nem as portas (tem a bateria do
//     arranque): mede-se a fronteira entre os dois e o que o vigia acrescenta.
//
// As mutacoes NAO se inventam aqui: leem-se de `core/ciclo/arranque.casos.json`, onde ja esta declarada
// uma por porta. Duas baterias a declarar as mesmas mutacoes divergiriam, e a que ficasse por actualizar
// seria a que mente.
//
// Nada aqui toca numa corretora e nada pede chave: o conector e duble (RN-E24).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";
import { validar } from "../../contracts/esqueleto/framing.ts";
import { fundir } from "./fundir.ts";

const MODO = process.argv[2] ?? "";
if (MODO !== "--arranque") {
  const tarefa = MODO === "--orfandade" ? "T031" : MODO === "--encerramento" ? "T038" : MODO === "--verbos" ? "T044" : "(desconhecido)";
  console.log(`${MODO}: NAO IMPLEMENTADO (tarefa ${tarefa})`);
  process.exit(2);
}

const VERSAO = "1.1.0";
const comando = (id: string, carga: Record<string, unknown>) =>
  JSON.stringify({ contrato: VERSAO, tipo: "comando", id, carga });

const declarado = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core/ciclo/arranque.casos.json"), "utf8"));
const manifestoDoFixture = JSON.parse(readFileSync(join(RAIZ_DO_REPO, declarado.manifesto_fixture), "utf8"));

const dir = mkdtempSync(join(tmpdir(), "vigia-"));
let verificacoes = 0;
let divergentes = 0;
const falhas: string[] = [];
function conferir(nome: string, ok: boolean, detalhe = "") {
  verificacoes++;
  if (!ok) {
    divergentes++;
    falhas.push(`${nome}${detalhe ? " :: " + detalhe : ""}`);
  }
}

/** Escreve os tres ficheiros que o vigia le, a partir do padrao do arranque + a mudanca do caso. */
function preparar(mudanca: Record<string, unknown>) {
  const config = fundir(declarado.padrao.config, mudanca.config_mudanca);
  const marcas = fundir(declarado.padrao.marcas, mudanca.marcas_mudanca);
  // A mudanca entra na CARGA do manifesto, e nao no envelope: a versao que a porta confere e a que a ponta
  // DECLARA (carga.versao). Aplicada ao envelope, a mutacao caia num sitio que ninguem le - e o caso
  // passava a aceitar um arranque que devia recusar.
  const mensagem = JSON.parse(JSON.stringify(manifestoDoFixture));
  mensagem.carga = fundir(manifestoDoFixture.carga, mudanca.manifesto_mudanca);
  if (mudanca.manifesto_instrumentos !== undefined) mensagem.carga.instrumentos = mudanca.manifesto_instrumentos;
  for (const campo of (mudanca.manifesto_remover as string[] | undefined) ?? []) delete mensagem.carga[campo];

  const caminhos = {
    config: join(dir, "config.json"),
    manifesto: join(dir, "manifesto.json"),
    marcas: join(dir, "marcas.json"),
    registo: join(dir, "vigia.json"),
    portas: join(dir, "arranque.json"),
  };
  writeFileSync(caminhos.config, JSON.stringify(config));
  writeFileSync(caminhos.manifesto, JSON.stringify(mensagem));
  writeFileSync(caminhos.marcas, JSON.stringify(marcas));
  rmSync(caminhos.registo, { force: true });
  rmSync(caminhos.portas, { force: true });
  return caminhos;
}

/** Corre o VIGIA como processo (e ele arranca a mesa por sua conta: e isso que esta em causa). */
function correrVigia(linhas: string[], mudanca: Record<string, unknown> = {}) {
  const c = preparar(mudanca);
  const args = [
    "run", join(RAIZ_DO_REPO, "vigia", "vigia.ts"),
    "--config", c.config, "--manifesto", c.manifesto,
    "--marcas", c.marcas, "--registo", c.registo, "--portas", c.portas,
  ];
  if (mudanca.inventario_mudanca !== undefined) args.push("--inventario", "falso");
  if (mudanca.registo_retomavel !== undefined) args.push("--registo-retomavel", String(mudanca.registo_retomavel));
  const r = spawnSync("bun", args, { input: linhas.join("\n") + "\n", encoding: "utf8" });
  const saida = (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
  let registro: any = { transicoes: [] };
  try { registro = JSON.parse(readFileSync(c.registo, "utf8")); } catch { /* ausente: as provas reprovam */ }
  return { saida, registro };
}

// As seis portas, pelos casos que ja as declaram (um caso por porta).
const PORTAS = ["manifesto", "mandato", "contenda", "inventario", "versao_do_contrato", "sessao"] as const;
const casoDaPorta = (porta: string) => declarado.casos.find((c: any) => c.porta_esperada === porta);

console.log("=== bancada do vigia: as seis portas, uma de cada vez, e o que ele acrescenta\n");

// 1. O CAMINHO FELIZ - sem ele as recusas nao significam nada.
{
  const feliz = declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam"));
  const { saida, registro } = correrVigia(
    [comando("a-1", { verbo: "start", autor: "dono", pedido_id: "a-1" })],
    feliz,
  );
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("feliz: start aceite", carga.aceito === true, `aceito=${carga.aceito} motivo=${carga.motivo}`);
  // T023/RN-M4.9: o instante e o DA MESA. O vigia copia-o, e nao carimba o seu - uma segunda contabilidade
  // do mesmo facto (o relogio do vigia ao lado do relogio da mesa) daria duas horas para uma so transicao.
  conferir("feliz: o instante e o da mesa (o vigia nao carimba o seu)",
    registro.transicoes[0]?.instante_ms === carga.instante_ms,
    `vigia=${registro.transicoes[0]?.instante_ms} mesa=${carga.instante_ms}`);
  conferir("feliz: parada->em_operacao", carga.transicao?.de === "parada" && carga.transicao?.para === "em_operacao",
    `${carga.transicao?.de}->${carga.transicao?.para}`);
  conferir("feliz: as seis portas conferidas", registro.transicoes[0]?.portas_conferidas?.length === 6,
    `conferidas=${registro.transicoes[0]?.portas_conferidas?.length}`);
  console.log(`ok    arranque/todas-as-portas-passam · ${registro.transicoes[0]?.portas_conferidas?.length} portas conferidas · ` +
    `parada->${carga.transicao?.para} · ${carga.aceito ? "aceite" : "recusado: " + carga.motivo}`);
}

// 2. UMA PORTA FALHADA, POR PORTA: a resposta recusa, e o NOME DA PORTA fica no registro (T021).
for (const porta of PORTAS) {
  const caso = casoDaPorta(porta);
  if (caso === undefined) {
    conferir(`porta ${porta}: ha um caso declarado`, false, "nenhum caso em arranque.casos.json");
    continue;
  }
  const { saida, registro } = correrVigia(
    [comando("b-1", { verbo: "start", autor: "dono", pedido_id: "b-1" })],
    caso,
  );
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  const t = registro.transicoes[0] ?? {};
  conferir(`porta ${porta}: a resposta recusa`, carga.aceito === false, `aceito=${carga.aceito}`);
  // O motivo aceita duas formas, e as duas dizem a mesma coisa: a porta do arranque recusou
  // (`porta_do_arranque_falhou`), ou a propria TABELA tinha um motivo mais especifico para aquele estado
  // (o CB inibido, por exemplo) e deu esse. O segundo nao e um generico: e mais preciso. O que nao se
  // aceita e um "nao" sem razao, ou uma razao que nao seja nenhuma destas duas.
  conferir(`porta ${porta}: o motivo e o daquela porta`,
    carga.motivo === "porta_do_arranque_falhou" || carga.motivo === caso.motivo_esperado,
    `motivo=${carga.motivo} esperado=porta_do_arranque_falhou|${caso.motivo_esperado}`);
  conferir(`porta ${porta}: a mesa NAO arrancou`, t.de === "parada" && t.para === "parada", `${t.de}->${t.para}`);
  conferir(`porta ${porta}: o registro NOMEIA a porta`, t.porta === porta, `porta=${t.porta} esperado=${porta}`);
  conferir(`porta ${porta}: o registro diz o que se conferiu`, Array.isArray(t.portas_conferidas) && t.portas_conferidas.length > 0,
    `conferidas=${JSON.stringify(t.portas_conferidas)}`);
  console.log(`ok    arranque/${porta}-recusa · resposta="${carga.motivo}" · registro nomeia a porta "${t.porta}" · ` +
    `conferidas ate a falha: ${JSON.stringify(t.portas_conferidas)} · mesa ${t.de}->${t.para}`);
}

// 3. O VIGIA ACRESCENTA OS VERBOS: start repetido, stop em parada, e o que a porta recusa sem incomodar a mesa.
{
  const feliz = declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam"));
  const { saida, registro } = correrVigia(
    [
      comando("c-1", { verbo: "start", autor: "dono", pedido_id: "c-1" }),
      comando("c-2", { verbo: "start", autor: "dono", pedido_id: "c-2" }),
      comando("c-3", { verbo: "stop", autor: "dono", pedido_id: "c-3" }),
    ],
    feliz,
  );
  const ultima = JSON.parse(saida[1] ?? "{}")?.carga ?? {};
  conferir("start repetido: mesa_ja_em_operacao", ultima.motivo === "mesa_ja_em_operacao", `motivo=${ultima.motivo}`);
  conferir("start repetido: a transicao diz onde a mesa esta",
    ultima.transicao?.de === "em_operacao" && ultima.transicao?.para === "em_operacao",
    `${ultima.transicao?.de}->${ultima.transicao?.para}`);
  const parada = JSON.parse(saida[2] ?? "{}")?.carga ?? {};
  conferir("stop: a mesa diz o que sabe (mesa_ja_parada ou posicao_desconhecida)",
    ["mesa_ja_parada", "posicao_desconhecida", "mesa_ja_pausada"].includes(parada.motivo) || parada.aceito === true,
    `aceito=${parada.aceito} motivo=${parada.motivo}`);
  conferir("tres comandos, tres linhas no registro do vigia", registro.transicoes?.length === 3,
    `linhas=${registro.transicoes?.length}`);
  console.log(`ok    verbos/start-start-stop · start repetido="${ultima.motivo}" · stop="${parada.motivo ?? (parada.aceito ? "aceite" : "?")}" · ` +
    `${registro.transicoes?.length} linhas no registro`);
  for (const [i, linha] of saida.entries()) {
    const d = validar(linha);
    conferir(`resposta ${i + 1} e mensagem VALIDA do contrato`, d.veredicto === "aceite",
      `veredicto=${d.veredicto} motivo=${d.motivo}`);
    // T023: um aceite NAO traz motivo, e o efeito - quando existe - diz mais do que a transicao ja diz.
    // Um `efeito` igual ao `para` seria um enfeite a repetir o nome do estado, e o campo deixaria de
    // significar "ha mais para dizer" para significar "ha sempre".
    const c = JSON.parse(linha)?.carga ?? {};
    if (c.aceito === true) {
      conferir(`resposta ${i + 1}: aceito nao traz motivo`, c.motivo === undefined, `motivo=${c.motivo}`);
      if (c.efeito !== undefined) {
        conferir(`resposta ${i + 1}: o efeito nao repete o destino`, c.efeito !== c.transicao?.para,
          `efeito=${c.efeito} para=${c.transicao?.para}`);
      }
    }
  }
}

// 3b. `stop` NUMA MESA PARADA (T022): a mesa diz o que sabe - e a posicao, aqui, nao muda a resposta.
{
  const feliz = declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam"));
  const { saida, registro } = correrVigia([comando("c-4", { verbo: "stop", autor: "dono", pedido_id: "c-4" })], feliz);
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("stop em parada: mesa_ja_parada", carga.aceito === false && carga.motivo === "mesa_ja_parada",
    `aceito=${carga.aceito} motivo=${carga.motivo}`);
  conferir("stop em parada: a transicao diz parada->parada",
    carga.transicao?.de === "parada" && carga.transicao?.para === "parada",
    `${carga.transicao?.de}->${carga.transicao?.para}`);
  conferir("stop em parada: uma linha no registro, com o verbo declarado",
    registro.transicoes?.length === 1 && registro.transicoes[0]?.verbo === "stop",
    `linhas=${registro.transicoes?.length} verbo=${registro.transicoes[0]?.verbo}`);
  console.log(`ok    verbos/stop-em-parada · resposta="${carga.motivo}" · parada->parada · ` +
    `sem conferir portas (portas conferidas: ${JSON.stringify(registro.transicoes[0]?.portas_conferidas)})`);
}

// 4. O COMANDO QUE NAO PRESTA: o vigia recusa e nao incomoda a mesa.
{
  const { saida } = correrVigia(
    [comando("d-1", { verbo: "start", autor: "dono", pedido_id: "d-1", lado: "buy" })],
    declarado.casos.find((c: any) => c.nome.startsWith("todas-as-portas-passam")),
  );
  const carga = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("campo a mais: recusado", carga.aceito === false && carga.motivo === "comando_com_campo_a_mais",
    `aceito=${carga.aceito} motivo=${carga.motivo}`);
  console.log(`ok    porta/campo-a-mais · resposta="${carga.motivo}" (o vigia recusa sem incomodar a mesa)`);
}

rmSync(dir, { recursive: true, force: true });

for (const f of falhas) console.log("FALHA " + f);
console.log(
  `\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ` +
    `${PORTAS.length + 4} cenarios · vigia + mesa como processos`,
);
process.exit(divergentes === 0 ? 0 : 1);
