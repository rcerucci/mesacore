// Mock de setup — a ponta que decide o LADO, e so isso (RN-T15).
//
// Le um objecto de mercado (uma linha JSON) e responde com uma proposta. Sabe ser invalido
// DE PROPOSITO, porque e metade do valor da bateria: um mock que so sabe ser valido prova
// metade do contrato.
//
//   echo '<mercado>' | bun run mocks/setup/main.ts --lado buy
//   echo '<mercado>' | bun run mocks/setup/main.ts --invalido limpar|vazio|numero
//
// O mock NAO sabe o tamanho, o risco nem a corretora: nao ve boleta, nao ve conta. Se um dia
// precisar de ver, o contrato esta errado.

import { RAIZ, versaoVigente } from "../../esqueleto/framing.ts";

const args = process.argv.slice(2);
function argumento(nome: string): string | null {
  const i = args.indexOf(nome);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? null) : null;
}

const invalido = argumento("--invalido");
const ladoPedido = argumento("--lado") ?? "hold";

const texto = (await new Response(Bun.stdin.stream()).text()).trim();
if (texto === "") {
  console.error("[mock-setup] sem mensagem na entrada");
  process.exit(2);
}

let mercado: any;
try {
  mercado = JSON.parse(texto);
} catch {
  console.error("[mock-setup] a entrada nao e uma linha de JSON");
  process.exit(2);
}

if (mercado?.tipo !== "mercado") {
  console.error(`[mock-setup] esperava um objecto de mercado, recebi tipo=${mercado?.tipo}`);
  process.exit(2);
}

// Decisao do mock: mercado fechado faz caixa; caso contrario, o lado pedido. SEMPRE uma das
// quatro palavras — e quando o modo invalido esta ligado, NENHUMA delas (e isso que se testa).
function decidirLado(): unknown {
  switch (invalido) {
    case "limpar":
      return "limpar";
    case "vazio":
      return undefined;
    case "numero":
      return 1;
    default:
      return mercado?.carga?.estado === "fechado" ? "caixa" : ladoPedido;
  }
}

const lado = decidirLado();
const carga: Record<string, unknown> = { setup: { nome: "mock_setup", versao: "1.0.0" } };
if (lado !== undefined) carga["lado"] = lado;

const proposta = {
  contrato: versaoVigente(),
  tipo: "proposta",
  id: `${mercado.id}/proposta`,
  carga,
};

console.log(JSON.stringify(proposta));
void RAIZ;
