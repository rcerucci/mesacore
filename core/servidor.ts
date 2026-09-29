#!/usr/bin/env bun
// A PORTA DE PROCESSO DA MESA: uma linha entra, uma linha sai. Nada mais.
//
// O que esta porta NAO faz, e por que:
//
//   - NAO decide. Valida a MENSAGEM (o contrato: enquadramento, versao, forma) e entrega a carga ao
//     interprete da mesa (`Mesa.receber`), que e quem conhece a tabela. Nao ha aqui um `if` de regra.
//   - NAO tem log proprio. A transicao vai na resposta; quem guarda e quem comanda (`.vigia.json`).
//     Duas contabilidades do mesmo facto divergem - e a que fica escondida e a que mente.
//   - NAO le configuracao. A mesa le a que precisa; uma segunda leitura e uma segunda verdade.
//   - NAO se cala. Mensagem invalida, versao errada, verbo desconhecido: sai SEMPRE resposta com motivo.
//     Silencio obrigaria o vigia a adivinhar - e adivinhar e a unica forma de comandar uma mesa errada.
//
// O instante da resposta e carimbado AQUI, com o relogio da mesa (RN-M4.9: quem recebe e que carimba).
//
// DUAS VERDADES QUE A MESA NAO TIRA DE SI - e o que esta porta faz quando nao as tem:
//
//   1. AS SEIS PORTAS DO ARRANQUE. Elas precisam da configuracao, do manifesto, do registo de operacao e
//      do conferidor de inventario - quarto coisas que nao nascem dentro desta porta. Enquanto o vigia
//      nao as trouxer na lingua das portas (T021), entram por `--portas <ficheiro.json>`. SEM esse
//      ficheiro o `start` RECUSA, nomeando a porta "(nao conferidas)": a tabela trata "nao sei" como "as
//      portas passaram" (`portas_do_arranque_falham` exige `passam === false`), e por isso o desconhecido
//      NAO pode chegar la como vazio.
//   2. A POSICAO VIVA. Ela le-se da corretora, e as marcas nao tem posicao de propositio (RN-T16.1). Por
//      `--posicao-viva true|false`: e o unico jeito de a mesa saber. Sem ela, ou com `true`, o `stop`
//      RECUSA com `posicao_desconhecida` - porque o caminho `encerrando` (o resumo e a pergunta) e o US3,
//      e entrar em `encerrando` sem perguntar seria pior do que nao parar.
//
// O RELOGIO. A mesa NAO vive da costura: uma mesa em operacao continua a operar com o vigia morto
// (FR-006/RN-V6), e por isso tem um relogio proprio (`--tick`), armado no arranque e NAO desligado pelo fim
// da entrada. Quem o desliga e o estado: `parada` nao tem operacao para defender, e a volta nao decide.
// `pausada` CICLA - a pausa suspende abrir e mais nada (RN-V2.1).
//
// Uso:  echo '<mensagem>' | bun run core/servidor.ts [--uma-linha] [--portas f.json] [--posicao-viva false]
//                                                  [--marcas f.json] [--registo f.jsonl]
//        [--tick <ms> --operacao f.json --config f.json]   # liga o relogio (a mesa opera sozinha)

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { validar, versaoVigente } from "../contracts/esqueleto/framing.ts";
import { Mesa, type ContextoDaMesa } from "./mesa.ts";
import { aplicar, verbosDeclarados } from "./estados/maquina.ts";
import { haInibicao, lerMarcas } from "./estado/marcas.ts";
import { motivoConhecido } from "./livro-de-motivos.ts";
import { conferirMandatos, correrUmCiclo, lerOperacao } from "./ciclo/relogio.ts";

/** O contrato recusa a MENSAGEM; a mesa fala dos seus motivos. Nada atravessa sem nome de um dos dois. */
export const TRADUCAO: Record<string, string> = {
  versao_do_contrato_divergente: "versao_do_contrato_divergente",
  enquadramento_invalido: "comando_com_tipo_invalido",
  campo_obrigatorio_ausente: "comando_incompleto",
  valor_nulo_nao_permitido: "comando_com_tipo_invalido",
  campo_desconhecido: "comando_com_campo_a_mais",
  campo_em_unidade_de_corretora: "comando_com_tipo_invalido",
  parcial_nao_declarada: "comando_com_tipo_invalido",
  formato_invalido: "comando_com_tipo_invalido",
  tipo_invalido: "comando_com_tipo_invalido",
  valor_fora_do_conjunto: "comando_com_tipo_invalido",
  valor_fora_da_banda: "comando_com_tipo_invalido",
  capacidade_nao_declarada: "comando_com_tipo_invalido",
  instrumento_desconhecido_no_manifesto: "comando_com_tipo_invalido",
  minimo_do_instrumento_acima_da_banda: "comando_com_tipo_invalido",
  prazo_excedido: "comando_com_tipo_invalido",
  desfecho_nao_reconhecido: "comando_com_tipo_invalido",
};

export interface Opcoes {
  caminhoDasMarcas?: string;
  caminhoDoRegisto?: string;
  /** O CAMINHO do desfecho das sete portas, escrito por quem as corre (o vigia). Le-se a cada `start`:
   *  fixado no arranque do processo, um segundo `start` usaria as portas de uma corrida antiga - e o
   *  vigia teria de reiniciar a mesa para cada arranque, perdendo o estado dela. */
  caminhoDasPortas?: string;
  posicaoViva?: boolean;
  /** O periodo do relogio da mesa, em ms. Sem ele a mesa so age quando lhe falam - e a morte do vigia
   *  pararia a operacao, que e o contrario da FR-006. */
  tickMs?: number;
  /** A operacao (o que o conector e o setup reportam) e a configuracao do dono, para o relogio. */
  caminhoDaOperacao?: string;
  caminhoDaConfig?: string;
}

function lerArgumentos(argv: string[]): Opcoes {
  const o: Opcoes = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--marcas") o.caminhoDasMarcas = argv[++i];
    else if (a === "--registo") o.caminhoDoRegisto = argv[++i];
    else if (a === "--portas") o.caminhoDasPortas = argv[++i];
    else if (a === "--posicao-viva") o.posicaoViva = argv[++i] === "true";
    else if (a === "--tick") o.tickMs = Number(argv[++i]);
    else if (a === "--operacao") o.caminhoDaOperacao = argv[++i];
    else if (a === "--config") o.caminhoDaConfig = argv[++i];
  }
  return o;
}

/** O desfecho das sete portas, como quem as correu o escreveu. Nao se le: RECUSA - e a unica leitura
 *  honesta, porque a tabela trata "nao sei" como "as portas passaram". */
function lerPortas(caminho: string | undefined): { passam: boolean; porta?: string; motivo?: string } | null {
  if (caminho === undefined) return null;
  try {
    const lido = JSON.parse(readFileSync(caminho, "utf8"));
    if (typeof lido?.passam !== "boolean") return null;
    return lido;
  } catch {
    return { passam: false, porta: "(nao se leu o desfecho)", motivo: `${caminho} nao se leu` };
  }
}

/** A resposta do contrato, montada a partir do que a mesa decidiu. */
function resposta(
  id: unknown,
  pedidoId: string | null,
  estadoAnterior: string,
  estadoNovo: string,
  instante_ms: number,
  resto: { efeito?: string; motivo?: string },
) {
  const carga: Record<string, unknown> = {
    // Um `pedido_id` inventado tem de ser ele proprio uma correlacao VALIDA (o contrato confere o
    // formato na resposta): `sem_pedido` e a declaracao honesta de que o pedido nao trouxe correlacao.
    pedido_id: pedidoId ?? "sem_pedido",
    aceito: resto.motivo === undefined,
    transicao: { de: estadoAnterior, para: estadoNovo },
    instante_ms,
  };
  if (resto.efeito !== undefined) carga.efeito = resto.efeito;
  if (resto.motivo !== undefined) carga.motivo = resto.motivo;
  return JSON.stringify({
    contrato: versaoVigente(),
    tipo: "resposta_de_comando",
    id: typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(id) ? id : "sem_id",
    carga,
  });
}

/** Uma linha entra, uma linha sai. Devolve SEMPRE uma linha. */
function marcasPresentes(m: ReturnType<typeof lerMarcas>): string[] {
  return [...(m.sessao ? ["sessao"] : []), ...(m.inibicao_cb ? ["inibicao_cb"] : []),
          ...m.desconhecido.map((d) => `desconhecido:${d.instrumento}`), ...m.pedidos.map((p) => `pedido:${p.verbo}`)];
}

export function atender(linha: string, mesa: Mesa, opcoes: Opcoes): string {
  const instante = Date.now();
  const estado = mesa.estado;

  // 1. a mensagem, pelo contrato (enquadramento, versao, forma)
  const decisao = validar(linha);
  if (decisao.veredicto !== "aceite") {
    let id: unknown = null;
    let verbo: unknown = null;
    try {
      const cru = JSON.parse(linha) as { id?: unknown; carga?: { verbo?: unknown } };
      id = cru?.id ?? null;
      verbo = cru?.carga?.verbo ?? null;
    } catch { /* nem e JSON: o motivo do contrato ja o disse */ }
    // Um verbo fora dos cinco tem nome no livro (`verbo_desconhecido`) e nao se afoga num generico: o
    // que o vigia precisa de saber e que aquele verbo nao existe, nao que "o tipo estava mal".
    const foraDosCinco = typeof verbo === "string" && !verbosDeclarados().includes(verbo as never);
    const motivo = foraDosCinco
      ? "verbo_desconhecido"
      : (TRADUCAO[decisao.motivo ?? ""] ?? "comando_com_tipo_invalido");
    return resposta(id, null, estado, estado, instante, { motivo });
  }

  let envelope: { id?: unknown; carga?: unknown; tipo?: string };
  try { envelope = JSON.parse(linha); } catch { return resposta(null, null, estado, estado, instante, { motivo: "comando_com_tipo_invalido" }); }
  const carga = envelope.carga as Record<string, unknown> | undefined;
  const pedidoId = typeof carga?.pedido_id === "string" ? carga.pedido_id : null;

  // 2. o tipo: a porta so fala comando. Outro tipo e recusado, nao encaminhado em silencio.
  if (envelope.tipo !== "comando") {
    return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "comando_com_tipo_invalido" });
  }

  // 3. as duas verdades que a mesa nao tira de si
  const verbo = carga?.verbo;
  const portas = verbo === "start" ? lerPortas(opcoes.caminhoDasPortas) : null;
  if (verbo === "start" && portas === null) {
    return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "porta_do_arranque_falhou" });
  }
  // A POSICAO VIVA: nao se recusa por nao a saber - recusa-se se o que nao se sabe MUDAR a resposta.
  // A pergunta faz-se a TABELA (funcao pura), e nao a mesa: `Mesa.receber` grava marcas e registo, e
  // uma sonda que gravasse seria uma operacao que nunca aconteceu. Se a resposta e a mesma com e sem
  // posicao, a mesa decidiu sem precisar dela - e um `stop` numa mesa ja parada da `mesa_ja_parada`.
  if (verbo === "stop" && opcoes.posicaoViva === undefined) {
    const m = lerMarcas(opcoes.caminhoDasMarcas);
    const base = { inibicao_cb: haInibicao(m) };
    const semPosicao = aplicar(estado, "stop", { ...base, posicao_viva: false }, marcasPresentes(m));
    const comPosicao = aplicar(estado, "stop", { ...base, posicao_viva: true }, marcasPresentes(m));
    if (semPosicao.estado_novo !== comPosicao.estado_novo || semPosicao.resultado !== comPosicao.resultado) {
      return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "posicao_desconhecida" });
    }
  }

  // 4. o comando, pelo interprete da mesa. A mesa decide - a porta nao.
  const contexto: ContextoDaMesa = { instante_ms: instante };
  if (portas !== null) contexto.portas_do_arranque = portas;
  if (opcoes.posicaoViva !== undefined) contexto.posicao_viva = opcoes.posicaoViva;

  const r = mesa.receber(carga, contexto);
  if (r.resultado !== "aceite") {
    const motivo = r.motivo && motivoConhecido(r.motivo) ? r.motivo : "comando_com_tipo_invalido";
    return resposta(envelope.id, pedidoId, r.estado_anterior, r.estado_novo, instante, { motivo });
  }

  // O efeito existe quando ACONTECEU algo alem da transicao (um `start` comum nao tem efeito proprio).
  let efeito: string | undefined;
  if (r.verbo === "reset") efeito = "reset_nao_toca_em_nada";
  else if (r.verbo === "nova_sessao") efeito = "sessao_nova_gravada";
  return resposta(envelope.id, pedidoId, r.estado_anterior, r.estado_novo, instante, { efeito });
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const umaLinha = process.argv.includes("--uma-linha");
  const mesa = new Mesa({
    caminhoDasMarcas: opcoes.caminhoDasMarcas,
    caminhoDoRegisto: opcoes.caminhoDoRegisto,
  });
  // Escrever para um cano fechado (o vigia morreu) NAO pode matar a mesa: seria a morte a chegar pela
  // costura, que e exactamente o que a FR-006 proibe.
  process.stdout.on("error", () => {
    /* a costura fechou; o registo continua a ser escrito */
  });
  // O `stderr` tambem e um cano de quem chamou: sem isto, a linha "a costura fechou" (escrita DEPOIS de a
  // costura fechar) rebentava a mesa - a morte a chegar pela costura, que e o que a FR-006 proibe.
  process.stderr.on("error", () => {
    /* idem */
  });

  // O RELOGIO, armado no arranque. Quem o desliga e o ESTADO, nunca o fim da entrada.
  let relogio: ReturnType<typeof setInterval> | null = null;
  if (opcoes.tickMs !== undefined) {
    if (opcoes.caminhoDaOperacao === undefined || opcoes.caminhoDaConfig === undefined) {
      throw new Error(
        "`--tick` sem `--operacao` ou sem `--config`: um relogio sem operacao ciclaria em branco, e decidir " +
          "sem o mandato do dono seria decidir por ele.",
      );
    }
    const operacao = lerOperacao(opcoes.caminhoDaOperacao);
    const config = JSON.parse(readFileSync(opcoes.caminhoDaConfig, "utf8"));
    conferirMandatos(operacao, config);
    let ciclo = 0;
    relogio = setInterval(() => {
      if (mesa.estado === "parada") return; // sem operacao para defender, a volta nao decide
      ciclo += 1;
      try {
        correrUmCiclo({
          operacao,
          config,
          marcas: mesa.marcas(),
          estado: mesa.estado,
          ciclo,
          instante_ms: Date.now(),
          caminhoDoRegisto: opcoes.caminhoDoRegisto,
        });
      } catch (erro) {
        // Uma volta que rebenta e um defeito NOSSO (a linha do registo e obrigatoria em `registarCiclo`).
        // Grita e continua: parar o relogio deixaria a posicao sem defesa por causa de um erro de codigo -
        // e a contagem da bancada (N ciclos = N linhas) apanha a volta que faltou.
        console.error(`ciclo ${ciclo} rebentou: ${(erro as Error).message}`);
      }
    }, opcoes.tickMs);
  }

  const rl = createInterface({ input: process.stdin });
  for await (const linha of rl) {
    if (linha.trim() === "") continue;
    process.stdout.write(atender(linha, mesa, opcoes) + "\n");
    if (umaLinha) break;
  }

  // FIM DA ENTRADA: a costura fechou. Duas respostas, e a diferenca e o que a mesa tem para defender:
  //  - em operacao (ou pausada): NAO sai. Continua a defender com o vigia morto - e a FR-006 inteira;
  //  - parada: sai. Sem operacao, sem costura e sem ninguem que a possa arrancar, ficar seria um processo
  //    a segurar um estado que ninguem pode usar.
  if (relogio !== null) {
    if (mesa.estado === "parada") {
      clearInterval(relogio);
    } else {
      console.error(`a costura fechou; a mesa continua em operacao (FR-006), estado ${mesa.estado}`);
    }
  }
}

if (import.meta.main) await main();
