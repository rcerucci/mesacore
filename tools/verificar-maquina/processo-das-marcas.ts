// Um PROCESSO da prova de reinicio (T035 / SC-010).
//
// Existe para ser corrido DUAS vezes, em processos separados, pelo `reiniciar.sh`:
//
//   marcar <caminho>   -> escreve as marcas e diz o que escreveu
//   reler  <caminho>   -> le as marcas DO FICHEIRO e diz o que leu
//   reset  <caminho>   -> aplica o reset e diz o que sobrou (nada muda para o desconhecido)
//
// A separacao em processos e o ponto: se a marca sobrevivesse apenas porque a variavel continuou viva na
// memoria do mesmo processo, a prova nao provaria nada. O que se quer e o que uma mesa reiniciada sabe.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  gravarMarcas,
  lerMarcas,
  marcarDesconhecido,
  marcarInibicao,
  gravarSessao,
  marcasVazias,
  reset,
  type Marcas,
} from "../../core/estado/marcas.ts";

const [modo, caminho] = process.argv.slice(2);

if (!modo || !caminho) {
  console.error("uso: processo-das-marcas.ts <marcar|reler|reset> <caminho>");
  process.exit(2);
}

if (modo === "marcar") {
  let m: Marcas = marcasVazias();
  m = gravarSessao(m, {
    instante_ms: 1790628000000,
    equity_de_partida: "1000.00",
    autor: "dono",
    motivo: "nova_sessao_do_dono",
    configuracao_em_vigor: { ficha: "3232", versao_do_setup: "1.0.0", versao_do_mandato: "1.0.0" },
  });
  m = marcarInibicao(m, { motivo: "perda_medida_acima_do_teto", instante_ms: 1790628001000, perda_medida: "5.20" });
  m = marcarDesconhecido(m, {
    instrumento: "EURUSD",
    motivo: "sem_confirmacao_dentro_do_prazo",
    instante_ms: 1790628005001,
    referencia_do_cliente: "mesa-3232-000030",
  });
  m = marcarDesconhecido(m, {
    instrumento: "GBPUSD",
    motivo: "desfecho_ilegivel",
    instante_ms: 1790628006000,
    referencia_do_cliente: "mesa-3232-000031",
  });
  gravarMarcas(m, caminho);
  console.log(JSON.stringify({ processo: "marcar", escrito: m }, null, 1));
} else if (modo === "reler") {
  const m = lerMarcas(caminho);
  console.log(JSON.stringify({ processo: "reler", lido: m }, null, 1));
} else if (modo === "reset") {
  const m = lerMarcas(caminho);
  const depois = reset(m);
  gravarMarcas(depois, caminho);
  console.log(JSON.stringify({ processo: "reset", depois }, null, 1));
} else {
  console.error(`modo desconhecido: ${modo}`);
  process.exit(2);
}

// Prova de que o ficheiro e legivel SEM interpretacao do codigo (FR-043): quem o abrir ve as chaves.
if (existsSync(caminho)) {
  const cru = JSON.parse(readFileSync(caminho, "utf8"));
  console.log(`ficheiro legivel: ${Object.keys(cru).join(", ")}`);
}
