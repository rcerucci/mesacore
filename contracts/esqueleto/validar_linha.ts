// Valida mensagens que chegam pelo stdin, uma por linha, e diz o que decidiu.
//
//   echo '<mensagem>' | bun run esqueleto/validar_linha.ts
//
// Mesmo comportamento que validar_linha.py: o contrato nao pode depender da linguagem de quem
// o le.

import { validar } from "./framing.ts";

const texto = await new Response(Bun.stdin.stream()).text();
const linhas = texto.split("\n").filter((l) => l.trim() !== "");
if (linhas.length === 0) {
  console.error("nenhuma mensagem na entrada");
  process.exit(2);
}

let recusadas = 0;
for (const linha of linhas) {
  const decisao = validar(linha);
  if (decisao.veredicto !== "aceite") recusadas += 1;
  console.log(JSON.stringify({ veredicto: decisao.veredicto, motivo: decisao.motivo }));
}
console.error(`${linhas.length} mensagens · ${linhas.length - recusadas} aceites · ${recusadas} recusadas`);
