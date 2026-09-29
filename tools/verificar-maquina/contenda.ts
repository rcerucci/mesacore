// A bancada da contenda (T066): a fila de atendimento, medida caso a caso.
//
// A porta da contenda vive no arranque, mas a ORDEM nao - ela e uma funcao pura, e e aqui que ela e
// exercitada com instantes que o arranque ainda nao tem. Isto e dito em voz alta de proposito: no
// arranque: as fichas vem da config, ninguem as pediu, e nao ha hora de chegada para carimbar. O criterio
// registado e sempre o desempate por simbolo. O ramo FIFO fica medido e pronto para quando os pedidos
// chegarem a mesa carimbados no relogio DELA - que e trabalho da superficie, nao do conector.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolverContenda, type PedidoDeContenda } from "../../core/ciclo/contenda.ts";

const AQUI = import.meta.dir;
const casos = JSON.parse(readFileSync(join(AQUI, "..", "..", "core", "ciclo", "contenda.casos.json"), "utf8"));

let verificacoes = 0;
let divergentes = 0;
const exigir = (ok: boolean, texto: string) => {
  verificacoes += 1;
  if (ok) console.log(`ok    ${texto}`);
  else { divergentes += 1; console.log(`FALHA ${texto}`); }
};

console.log("\n=== a contenda (quem fica de fora, e por que criterio) ===\n");

for (const caso of casos.casos) {
  const t = resolverContenda(caso.pedidos as PedidoDeContenda[], caso.tecto);
  exigir(
    t.criterio === caso.criterio_esperado,
    `${caso.nome} -> criterio '${t.criterio}'`,
  );
  exigir(
    JSON.stringify(t.admitidos) === JSON.stringify(caso.admitidos_esperados),
    `${caso.nome} -> entram ${t.admitidos.join(", ") || "nenhuma"}`,
  );
  exigir(
    JSON.stringify(t.de_fora) === JSON.stringify(caso.de_fora_esperados),
    `${caso.nome} -> ficam de fora ${t.de_fora.join(", ") || "ninguem"}`,
  );
  exigir(t.porque.length > 20, `${caso.nome} -> a contenda sabe explicar-se a si propria`);
}

// A ordem publicada tem de ser a ordem usada: quem esta `de_fora` tem de ser a cauda da fila, e nunca
// um pedido que tenha passado por cima de outro. Sem esta conferencia estrutural, `admitidos` podia
// estar certa por acidente com uma ordem publicada errada.
for (const caso of casos.casos) {
  const t = resolverContenda(caso.pedidos as PedidoDeContenda[], caso.tecto);
  const cauda = t.ordem.slice(t.admitidos.length);
  exigir(
    JSON.stringify(cauda) === JSON.stringify(t.de_fora),
    `${caso.nome} -> a fila publicada bate com quem entrou (nada passa por cima)`,
  );
}

console.log(`\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${casos.casos.length} casos`);
process.exit(divergentes === 0 ? 0 : 1);
