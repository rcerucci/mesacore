// O REGISTO DO VIGIA: ausente e' novo, ilegivel e' recusa.
//
// Medido antes desta bancada existir (01/10/2026): `lerRegisto` fazia `try { JSON.parse(readFileSync(...)) }
// `catch { return registoVazio() }` — um registo PRESENTE mas ILEGIVEL era lido como registo vazio, e como
// `anotarProcesso`/`anotarLeitura`/`acrescentar` leem ANTES de gravar, a gravacao seguinte passava por cima
// do historico e escrevia-se um registo novo. O dia da operacao desaparecia sem uma linha de aviso.
//
// A regra que esta bancada fixa e' a mesma que os outros ficheiros do vigia ja' seguem (`vigia/arranque.ts`
// recusa o desfecho e o mapa com linha ilegivel):
//
//   1. registo AUSENTE   -> registo novo (vazio), e quem le pode continuar;      [controlo]
//   2. registo ILEGIVEL  -> RECUSA, e a recusa nomeia o que nao se leu;          [o defeito]
//   3. a recusa VALE para a gravacao: nada se escreve por cima do ilegivel,     [a consequencia]
//      e o ficheiro no disco fica exactamente como estava;
//   4. forma errada (sem `transicoes` como lista) -> RECUSA, pela mesma razao;   [o gemeo]
//   5. registo antigo, sem `leituras`/`processos` -> completa-se VAZIO.          [o que se mantem]
//
// Uso: bun run tools/verificar-maquina/registo-do-vigia.ts   (sai 1 se algo divergir)

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { acrescentar, anotarLeitura, anotarProcesso, lerRegisto } from "../../vigia/registro.ts";

let verificacoes = 0;
let divergentes = 0;

function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) console.log(`ok    ${texto}`);
  else {
    divergentes += 1;
    console.log(`DIVERGE ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

function recusa(acao: () => unknown): { recusou: boolean; mensagem: string } {
  try {
    acao();
    return { recusou: false, mensagem: "" };
  } catch (erro) {
    return { recusou: true, mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}

const BASE = process.env.TMPDIR ?? "/tmp";
const caminho = `${BASE}/mesacore-registo-do-vigia-${process.pid}.json`;
rmSync(caminho, { force: true });
rmSync(`${caminho}.tmp`, { force: true });

// --- 1. AUSENTE e' registro NOVO (o controlo: a guarda nao pode recusar o caso normal)
const vazio = lerRegisto(caminho);
exigir(
  Array.isArray(vazio.transicoes) && vazio.transicoes.length === 0,
  "registo ausente: e' um registo NOVO (vazio), e nao uma recusa",
);

// --- 2. ILEGIVEL RECUSA — e a recusa diz o caminho
const partido = '{ "nota": "o registro", "transicoes": [ { "de": "parada", "para": "em_operacao" } ], "leituras": ';
writeFileSync(caminho, partido);
const r2 = recusa(() => lerRegisto(caminho));
exigir(
  r2.recusou && r2.mensagem.includes(caminho) && r2.mensagem.includes("nao e' JSON"),
  "registo partido: `lerRegisto` RECUSA e nomeia o ficheiro e a razao",
  [`recusou=${r2.recusou}`, `mensagem=${r2.mensagem.slice(0, 160)}`],
);

// --- 3. A RECUSA VALE PARA A GRAVACAO: nada se escreve por cima do ilegivel
const antes = readFileSync(caminho, "utf8");
const r3 = recusa(() => acrescentar(caminho, {
  instante_ms: 1, verbo: "start", autor: "dono", pedido_id: "p-1", aceito: true, de: "parada", para: "em_operacao",
  motivo: null, efeito: null, porta: null, motivo_da_porta: null, detalhe_da_porta: null,
  portas_conferidas: [], pergunta: null,
} as any));
const depois = readFileSync(caminho, "utf8");
exigir(
  r3.recusou && depois === antes,
  "registo partido: a gravacao seguinte RECUSA, e o ficheiro no disco fica INTEIRO (nao se reescreve o que nao se leu)",
  [`recusou=${r3.recusou}`, `ficheiro igual antes/depois=${depois === antes}`],
);
for (const [nome, acao] of [
  ["anotarProcesso", () => anotarProcesso(caminho, { instante_ms: 1, papel: "mesa", nome: "mesa", pid: 1 })],
  ["anotarLeitura", () => anotarLeitura(caminho, { instante_ms: 1, estado_da_mesa: "parada", de: "ledger", porque: "prova" })],
] as const) {
  const r = recusa(acao);
  exigir(r.recusou && readFileSync(caminho, "utf8") === antes, `registo partido: \`${nome}\` tambem RECUSA e nao toca no ficheiro`);
}

// --- 4. FORMA ERRADA (o gemeo): JSON valido, mas sem `transicoes` como lista — nao e' um registo vazio
writeFileSync(caminho, JSON.stringify({ nota: "isto e' um objecto, nao um registo" }));
const r4 = recusa(() => lerRegisto(caminho));
exigir(
  r4.recusou && r4.mensagem.includes("transicoes"),
  "JSON valido mas sem `transicoes` como lista: RECUSA (nao ha registo sem a lista das transicoes)",
  [`mensagem=${r4.mensagem.slice(0, 160)}`],
);

// --- 5. O QUE SE MANTEM: registo antigo, sem as chaves que nasceram depois, completa-se VAZIO
writeFileSync(caminho, JSON.stringify({ nota: "registo de antes", transicoes: [] }));
const antigo = lerRegisto(caminho);
exigir(
  Array.isArray(antigo.leituras) && antigo.leituras.length === 0 &&
    Array.isArray(antigo.processos) && antigo.processos.length === 0,
  "registo antigo (sem `leituras`/`processos`): completa-se VAZIO, e quem le nao precisa de saber a idade do ficheiro",
);

rmSync(caminho, { force: true });
rmSync(`${caminho}.tmp`, { force: true });
console.log(`\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · 1 registo partido recusado`);
process.exit(divergentes === 0 ? 0 : 1);
