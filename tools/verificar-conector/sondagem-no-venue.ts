// SONDAGEM AO VENUE REAL (usa a rede). Primeira vez que o conector toca o venue.
//
// O que ele faz, e o que NAO faz:
//   * le a conta e a credencial pelo MESMO carregador que o conector vai usar (credencial.ts);
//   * deriva, da chave, o endereco do AGENTE que assina — e imprime o ENDERECO, nunca a chave;
//   * pergunta ao venue quem assina por aquela conta (`extraAgents`) e compara: a chave que temos
//     pertence mesmo a esta conta, e esta registada?
//   * le a conta com o endereco MASTER (a armadilha da doc: com o endereco do agente devolveria vazio);
//   * le a sonda publica (`meta`) e diz quantos instrumentos o venue oferece, com os numeros de um deles.
//
// Nada aqui assina nada: e leitura. Nenhum valor de chave entra na saida.
//
// Uso: bun tools/verificar-conector/sondagem-no-venue.ts config/contas/hl-teste-plugin.json

import { InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { carregarCredencial } from "../../brokers/hyperliquid/credencial.ts";
import { construirManifesto } from "../../brokers/hyperliquid/manifesto.ts";

const caminho = process.argv[2];
if (!caminho) { console.error("uso: bun tools/verificar-conector/sondagem-no-venue.ts <config/contas/x.json>"); process.exit(2); }
const conta = JSON.parse(readFileSync(caminho, "utf8"));
const corretora = conta?.conta?.corretora ?? "?";
const master = conta?.conta?.identificador ?? "";
const ambiente = conta?.conexao?.ambiente ?? "?";
const url = conta?.conexao?.url_da_api ?? "";
console.log(JSON.stringify({ etapa: "conta", corretora, ambiente, url, master, credencial: conta?.conta?.credencial }));

// 1. a credencial, pelo carregador do conector (nunca imprime o valor)
const r = carregarCredencial(conta?.conta?.credencial ?? "", conta?.conexao?.credencial?.valor_em ?? "");
if (!r.ok) { console.log(JSON.stringify({ etapa: "credencial", veredicto: "RECUSADA", motivo: r.motivo, porque: r.porque })); process.exit(1); }
console.log(JSON.stringify({ etapa: "credencial", veredicto: "carregada", de: r.de, protegido: r.protegido }));

// 2. o endereco do agente, derivado da chave (endereco publico; a chave nao sai daqui)
const agente = privateKeyToAccount(r.valor as `0x${string}`).address;
console.log(JSON.stringify({ etapa: "agente", endereco_derivado: agente }));

const isTestnet = ambiente !== "producao";
const transport = new HttpTransport({ isTestnet });
const info = new InfoClient({ transport });

try {
  // 3. quem assina por esta conta no venue
  const agentes = await (info as any).extraAgents({ user: master });
  const lista = Array.isArray(agentes) ? agentes : [];
  const eu = lista.find((a: any) => (a?.address ?? "").toLowerCase() === agente.toLowerCase());
  console.log(JSON.stringify({
    etapa: "identidade",
    agentes_registados_na_conta: lista.length,
    enderecos: lista.map((a: any) => ({ endereco: a?.address, nome: a?.name, valido_ate: a?.validUntil })),
    a_nossa_chave_esta_registada: eu !== undefined,
    validade: eu !== undefined ? { valido_ate: eu.validUntil } : null,
  }));

  // 4. o estado da conta, lido com o MASTER
  const estado = await (info as any).clearinghouseState({ user: master });
  const posicoes = Array.isArray(estado?.assetPositions) ? estado.assetPositions.length : 0;
  console.log(JSON.stringify({
    etapa: "conta_no_venue",
    margem_usada: estado?.marginSummary?.totalMarginUsed ?? null,
    valor_da_conta: estado?.marginSummary?.accountValue ?? null,
    posicoes_abertas: posicoes,
  }));
} catch (e) {
  console.log(JSON.stringify({ etapa: "leitura_da_conta", erro: (e as Error).message, dica: "se o erro for de assinatura/validacao, a conta pode nao existir ou o ambiente estar trocado" }));
}

try {
  // 5. a sonda publica: o que o venue oferece (isto e o que alimenta o manifesto)
  const meta = await (info as any).meta();
  const universo = meta?.universe ?? [];
  const btc = universo.find((u: any) => u.name === "BTC");
  console.log(JSON.stringify({
    etapa: "sonda",
    instrumentos_que_o_venue_oferece: universo.length,
    exemplo: btc ? { nome: btc.name, szDecimals: btc.szDecimals, maxLeverage: btc.maxLeverage } : null,
  }));
  // 6. a FUNCAO PURA do plugin, alimentada com a sonda VERDADEIRA: ele constroi o manifesto, ou
  //    recusa nomeando o que falta. As capacidades opcionais nao vao aqui de proposito — a sonda
  //    real ainda tem de as medir, e o manifesto tem de RECUSAR enquanto elas nao existirem.
  const sondaParcial = {
    venue: { nome: "hyperliquid", ambiente: isTestnet ? ("teste" as const) : ("producao" as const) },
    versao_do_conector: "0.0.0-sondagem",
    meta: { universe: universo.map((u: any) => ({ name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage })) },
    instrumentos_pedidos: ["BTC", "ETH"],
  };
  const m = construirManifesto(sondaParcial as any);
  console.log(JSON.stringify({
    etapa: "manifesto_da_sonda_real",
    veredicto: m.ok ? "construido" : "RECUSADO",
    ...(m.ok ? { manifesto: m.manifesto } : { motivo: m.motivo, porque: m.porque }),
  }));
} catch (e) {
  console.log(JSON.stringify({ etapa: "sonda", erro: (e as Error).message }));
}
