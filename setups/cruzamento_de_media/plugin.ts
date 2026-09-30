#!/usr/bin/env bun
// O PRIMEIRO SETUP DE REFERÊNCIA — cruzamento de médias.
//
// É um exemplo a SÉRIO, e não um esboço: fala o contrato, corre no operador, e serve de molde. O que ele faz é
// pouco de propósito — a política inteira vive aqui, e a mesa não sabe nada dela.
//
// O QUE ELE RECEBE, e por onde:
//   * a LEITURA do mercado, no `stdin`, como a mensagem `mercado` do contrato (instrumento, equity, bid, ask,
//     idade_do_dado_ms, estado) — é o seam da casa: uma linha JSON, e nada mais;
//   * as VELAS num ficheiro JSONL (o formato provado nas duas línguas), que o `setup.json` declara.
//
// O QUE ELE DEVOLVE: **uma** linha `proposta` no `stdout`, com o envelope do contrato e um dos quatro lados.
// Nada de tamanho, nada de preço, nada de corretora: quem compõe a boleta é a mesa (RN-S9).
//
// COMO SE LÊ A LEITURA: se ela estiver velha (`idade_do_dado_ms` grande) ou o mercado estiver fechado, a
// resposta honesta é `hold` — o setup não é obrigado a ter opinião, e `hold` é uma proposta (não é o mesmo que
// "proposta inválida", que a mesa registra como inválida).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const RAIZ = join(dirname(import.meta.dir), "..");
const manifesto = JSON.parse(readFileSync(join(import.meta.dir, "setup.json"), "utf8")) as {
  nome: string;
  versao: string;
  mercado?: { pasta: string; intervalo: string; ficheiro: string };
  parametros?: { rapida: number; lenta: number };
};

// OS PARAMETROS VEM DA FICHA DO PAR (por ambiente): o mesmo plugin, dois pares, dois relogios.
const ficha = JSON.parse(process.env.FICHA_DO_PAR ?? "{}") as Record<string, unknown>;
const rapidaN = Number(ficha.parametros_rapida ?? ficha["parametros.rapida"] ?? 5);
const lentaN = Number(ficha.parametros_lenta ?? ficha["parametros.lenta"] ?? 20);
const janela = String(ficha.janela ?? "1h");

// ---- a leitura, do stdin: uma linha do contrato ---------------------------------------------------------
const entrada = await new Promise<string>((resolve) => {
  let dados = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (b) => (dados += b));
  process.stdin.on("end", () => resolve(dados));
});
let leitura: any = null;
for (const linha of entrada.split("\n")) {
  if (linha.trim() === "") continue;
  try {
    const o = JSON.parse(linha);
    if (o?.tipo === "mercado") leitura = o.carga;
  } catch {
    // linha ilegivel nao vira leitura
  }
}

// ---- as velas, do ficheiro JSONL declarado --------------------------------------------------------------
function lerVelas(): any[] {
  // a pasta e o nome do ficheiro saem do RELOGIO da ficha: velas-<instrumento>-<janela>.jsonl
  const pasta = process.env.PASTA_DE_MERCADO ?? "";
  if (pasta === "") return [];
  const caminho = join(RAIZ, pasta, `velas-${process.env.INSTRUMENTO ?? "BTC"}-${janela}.jsonl`);
  if (!existsSync(caminho)) return [];
  return readFileSync(caminho, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

// ---- a decisão: o cruzamento, e mais nada --------------------------------------------------------------
function decidir(): { lado: string; porque: string } {
  if (leitura === null) return { lado: "hold", porque: "sem leitura do mercado: nao se decide sobre o que nao se leu" };
  if (leitura.estado !== "aberto") return { lado: "hold", porque: `o mercado esta' ${leitura.estado}` };
  const idade = Number(leitura.idade_do_dado_ms);
  if (!Number.isFinite(idade) || idade > 3 * 60 * 1000) return { lado: "hold", porque: `a leitura tem ${leitura.idade_do_dado_ms} ms: velha demais para decidir` };

  const velas = lerVelas();
  if (velas.length < lentaN) return { lado: "hold", porque: `so' ha' ${velas.length} velas e o cruzamento precisa de ${lentaN}` };
  // Os numeros do venue vem em TEXTO: converte-se para numero aqui, no plugin, que e' quem calcula.
  const fecho = velas.map((v) => Number(v.c));
  const media = (n: number) => fecho.slice(-n).reduce((s, x) => s + x, 0) / n;
  const rapida = media(rapidaN);
  const lenta = media(lentaN);
  const lado = rapida > lenta ? "buy" : rapida < lenta ? "sell" : "hold";
  return { lado, porque: `media ${rapidaN}=${rapida.toFixed(1)} contra ${lentaN}=${lenta.toFixed(1)}` };
}

const { lado } = decidir();
console.log(
  JSON.stringify({
    contrato: "1.7.0",
    tipo: "proposta",
    id: `cruzamento-${Date.now()}`,
    carga: { setup: { nome: manifesto.nome, versao: manifesto.versao }, lado },
  }),
);
