// A BANCADA DO PRAZO DO OPERADOR (D-017) — «o operador nao espera para sempre por uma leitura que nao vem».
//
// O QUE SE PROVA, e o defeito que isto mede: com um par LIGADO (`run: true`) cujo instrumento o conector NAO
// le^, o operador **escreve a OPERACAO** — com o par, e `ligacao: "sem_leitura"` — e **TERMINA**, em vez de
// ficar a' espera indefinidamente. Medido a 30/09/2026, ANTES da correccao: duas corridas de 240 s cada e
// **nenhum ficheiro de operacao**. O par sem leitura tem nome no contrato (`sem_leitura`, RN-D7): o operador
// devia escreve-lo, com o motivo, em vez de silencio.
//
// COMO, E PORQUE ASSIM. O operador **fixava o comando do conector no codigo**, e nao havia conector de mentira
// que se lhe apontasse — uma prova so' contra a conta de teste a serio depende da rede e gasta o orcamento de
// leituras ao venue para medir uma regra que e' DESTE lado. Foi por isso que a costura `--conector <ficheiro>`
// passou a existir (e o operador di-lo em voz alta quando a usa). A bancada escreve um conector FALSO que le^
// **outro** instrumento — o `ADA`, que a conta nao tem — e nunca o ligado (o `SOL`). Sem rede, sem venue, sem
// chave: e e' exactamente a cena do defeito («o conector le^ outros instrumentos»).
//
// O QUE ELA **NAO** PROVA, dito em vez de disfarcado: que o operador corre contra o venue a serio. Essa metade
// e' da corrida viva — a de 03/10/2026 entregou leitura dos TRES pares em 7173 voltas e nunca chegou ao prazo
// (ver a retratacao do D-020). Esta bancada mede o PRAZO, e so' o prazo.
//
// E ela NAO e' uma bancada «sem rede», pela mesma honestidade: o operador arranca o **feed de mercado** por
// desenho (`feed.ts`, uma subscricao PUBLICA do livro — sem chave, sem conta, sem orcamento de leituras), e a
// bancada nao o desliga nem espera por ele. O que a bancada mede nao depende dele: se o feed nao conseguir
// ligar, o operador faz o mesmo (o feed nao esta' no caminho da decisao).
//
// A BANCADA ESCREVE DOIS FICHEIROS NO REPOSITORIO E REMOVE-OS NO FIM (`fichas/sigma/SOL-hl-nao-le.json` e
// `config/contas/hl-nao-le.json`): o operador resolve as fichas e a conta a partir da raiz do repositorio e nao
// ha' opcao que o faca olhar para outro sitio. Os dois sao de uma conta de teste com um nome que nao existe em
// lado nenhum, e saem no `finally` E num handler de `exit` — uma bancada que rebente a meio nao pode deixar
// lixo na arvore (a trava da arvore limpa vale para as bancadas tambem).
//
// Uso:  bun tools/verificar-maquina/operador-nao-espera.ts
// Sai 1 se algum passo divergir; a ultima linha diz `operador nao espera: N de M passaram`.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";

const RAIZ = RAIZ_DO_REPO;
const CONTA_DE_TESTE = "hl-nao-le"; // uma conta que NAO existe no repositorio: a bancada cria-a e apaga-a
const FICHA_DA_BANCADA = join(RAIZ, "fichas", "sigma", `SOL-${CONTA_DE_TESTE}.json`);
const CONTA_DA_BANCADA = join(RAIZ, "config", "contas", `${CONTA_DE_TESTE}.json`);
const FICHA_MOLDE = join(RAIZ, "fichas", "sigma", "BTC-hl-teste-plugin.json");
const CONTA_MOLDE = join(RAIZ, "config", "contas", "hl-teste-plugin.json");

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

// A REMOCAO, NUM SOITIO E GARANTIDA (ver o cabecalho).
function limpar(): void {
  for (const f of [FICHA_DA_BANCADA, CONTA_DA_BANCADA]) {
    try { rmSync(f, { force: true }); } catch { /* ja' nao existe */ }
  }
}
process.on("exit", limpar);

if (!existsSync(FICHA_MOLDE) || !existsSync(CONTA_MOLDE)) {
  console.error(`operador-nao-espera: faltam os moldes (${FICHA_MOLDE} / ${CONTA_MOLDE}): a bancada nao inventa uma ficha nem uma conta`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "operador-nao-espera-"));
const para = join(dir, "operacao.json");

// ---- O CONECTOR FALSO -------------------------------------------------------------------------------------
// Fala as duas linguagens que o operador escuta: as PORTAS de arranque no `stderr` (`{"porta":...,"veredicto":...}`,
// que viram o `operacao.json.portas.json` que a mesa le^) e as LEITURAS no `stdout` (`tipo: "mercado"`).
// Le^ o `ADA` — que nao tem ficha nenhuma nesta conta — e por isso cada leitura dele e' uma leitura INUTIL para
// os pares ligados: e' o contador que faz o prazo correr (e o defeito e' o prazo nao existir).
const VERSAO = JSON.parse(readFileSync(join(RAIZ, "contracts", "versao.json"), "utf8")).contrato as string;
const conectorFalso = join(dir, "conector-falso.ts");
writeFileSync(conectorFalso, `// conector falso da bancada (D-017): le^ o ADA e nunca o SOL ligado
const VERSAO = ${JSON.stringify(VERSAO)};
const portas = ["ficha", "versao_do_contrato", "uma_conta", "ambiente_e_rede", "chave", "ligacao", "sonda_e_manifesto", "identidade"];
for (const porta of portas) process.stderr.write(JSON.stringify({ porta, veredicto: "passou", motivo: null }) + "\\n");
process.stderr.write(JSON.stringify({ etapa: "conector", veredicto: "pronto", instrumentos: ["ADA"] }) + "\\n");
let n = 0;
setInterval(() => {
  n += 1;
  process.stdout.write(JSON.stringify({ contrato: VERSAO, tipo: "mercado", id: "m-" + n,
    carga: { instrumento: "ADA", tempo_do_venue_ms: Date.now(), idade_do_dado_ms: 1 } }) + "\\n");
}, 40);
`);

// ---- AS FIXTURES: uma ficha LIGADA de um par que o conector nao le^, e a conta dela -------------------------
// A ficha e' a do sigma, com a CONTA e o INSTRUMENTO trocados (o resto — bandas, prazos, constantes — e' o do
// molde, e nao se inventa). `run: true`: e' o par LIGADO a' espera de uma leitura que nao vem.
const ficha = JSON.parse(readFileSync(FICHA_MOLDE, "utf8"));
ficha.cabecalho.conta = CONTA_DE_TESTE;
ficha.cabecalho.instrumento = "SOL";
ficha.cabecalho.run = true;
writeFileSync(FICHA_DA_BANCADA, JSON.stringify(ficha, null, 1) + "\n");
cpSync(CONTA_MOLDE, CONTA_DA_BANCADA);

// ---- A CORRIDA ---------------------------------------------------------------------------------------------
// `--voltas 50`: o processo NAO pode terminar pelo limite de voltas — a unica saida legitima desta corrida e' o
// prazo. Sem `--mercado`, o operador tambem nao puxa velas nenhumas (nem uma linha de rede).
const LIMITE_MS = 25_000;
const inicio = Date.now();
const proc = spawn("bun", [
  "run", join(RAIZ, "vigia", "operador.ts"),
  "--conta", CONTA_DE_TESTE,
  "--para", para,
  "--tick", "4000", // LEITURAS_INUTEIS = max(3, ceil(10000/4000)) = 3: tres leituras inuteis bastam
  "--voltas", "50",
  "--conector", conectorFalso,
], { cwd: RAIZ, stdio: ["pipe", "pipe", "pipe"] });

let bruto = "";
let erros = "";
proc.stdout.setEncoding("utf8");
proc.stderr.setEncoding("utf8");
proc.stdout.on("data", (p: string) => { bruto += p; });
proc.stderr.on("data", (p: string) => { erros += p; });

const saiu = new Promise<{ porSi: boolean }>((resolver) => {
  proc.on("exit", () => resolver({ porSi: true }));
  setTimeout(() => resolver({ porSi: false }), LIMITE_MS);
});

const { porSi } = await saiu;
const demorou_ms = Date.now() - inicio;
if (!porSi) {
  try { proc.kill("SIGKILL"); } catch { /* ja' morreu */ }
}

// A LEITURA DO QUE SAIU — a operacao (o stdout do operador e' o diagnostico; a operacao vai no ficheiro).
let operacao: any = null;
try { operacao = JSON.parse(readFileSync(para, "utf8")); } catch { /* ausente = o defeito */ }
const linhas = bruto.split("\n").filter((l) => l.trim() !== "").map((l) => { try { return JSON.parse(l); } catch { return null; } });
const prazo = linhas.find((l) => l?.veredicto === "prazo");
const substituicao = linhas.find((l) => l?.veredicto === "conector_substituto");
const instrumentos: Record<string, any> = operacao?.instrumentos ?? {};

conferir("D-017: o operador TERMINA sozinho (nao fica a' espera da leitura que nao vem)",
  porSi, `terminou_sozinho=${porSi} · ${demorou_ms} ms de um limite de ${LIMITE_MS} ms`);
conferir("D-017: e termina pelo PRAZO, com o numero das leituras inuteis",
  prazo !== undefined && Number(prazo.leituras_inuteis) >= 3,
  `prazo=${JSON.stringify(prazo)} · stderr=${erros.trim().slice(-120)}`);
conferir("D-017: a operacao fica ESCRITA (era isto que faltava: 240 s sem ficheiro nenhum)",
  operacao !== null, `operacao=${operacao === null ? "AUSENTE" : "escrita"}`);
conferir("D-017: escrita com `ligacao: \"sem_leitura\"` — a verdade, e nao a leitura anterior",
  operacao?.ligacao === "sem_leitura", `ligacao=${JSON.stringify(operacao?.ligacao)}`);
conferir("D-017: o par LIGADO entra na operacao — com o prazo dito, e SEM `leitura`",
  instrumentos.SOL !== undefined && instrumentos.SOL.leitura === undefined &&
    String(instrumentos.SOL.erro_do_setup ?? "").includes("prazo esgotado"),
  `SOL=${JSON.stringify(instrumentos.SOL)?.slice(0, 220)}`);
conferir("D-017: a corrida diz que o conector foi um SUBSTITUTO (nenhuma corrida a serio se le^ assim)",
  substituicao !== undefined, `linhas=${linhas.length}`);

rmSync(dir, { recursive: true, force: true });
limpar();

for (const f of falhas) console.log("FALHA " + f);
console.log(`\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · 1 cenario (o par ligado que o conector nao le^)` +
  ` · prazo em ${demorou_ms} ms`);
process.exit(divergentes === 0 ? 0 : 1);
