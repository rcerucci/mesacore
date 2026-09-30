// A mesa: a fachada que junta o comando, o interprete, as marcas e o registo.
//
// Ordem, e a ordem importa:
//   1. o comando e VALIDADO (campo a mais e recusado, nao ignorado)
//   2. as marcas sao LIDAS (a inibicao entra no contexto - e ela que manda no start)
//   3. o verbo e APLICADO pela tabela (dado, R1) - nao ha decisao escrita aqui
//   4. o efeito persistente e gravado (sessao nova; o reset nao grava nada, e isso e explicito)
//   5. o acontecimento vai para o registo, com motivo
//
// O estado da mesa NAO persiste (R3): ao arrancar, a mesa esta sempre `parada`. O que sobrevive sao
// as marcas - e e por isso que `reset` nao lhes toca.

import { join } from "node:path";
import { aplicar, type Contexto, type Estado, type Resposta } from "./estados/maquina.ts";
import { validarComando } from "./estados/comando.ts";
import * as marcas_mod from "./estado/marcas.ts";
import * as sessao_mod from "./estado/sessao.ts";
import { instanteDaUltimaTransicaoPara, registarRecusa, registarTransicao } from "./estado/registo.ts";
import { correrPedidoDeParada, type PedidoDeParada, type ResultadoDoEncerramento } from "./ciclo/encerramento.ts";

export const RAIZ_DO_CORE = join(import.meta.dir);

export interface ContextoDaMesa extends Contexto {
  /** O relogio e o do VENUE (RN-D3): quem chama traz o instante de la. */
  instante_ms: number;
  /** So no encerramento: o prazo declarado pela ficha e a configuracao que o decide. */
  prazo_de_resposta_ms?: number;
  configuracao?: import("./config/configuracao.ts").ConfiguracaoDaConta;
  /** Só em `nova_sessao`: o que a mesa leu e a configuracao que passa a valer. */
  sessao_nova?: {
    equity_de_partida: string;
    configuracao_em_vigor: marcas_mod.ConfiguracaoEmVigor;
  };
}

export interface RespostaDaMesa extends Resposta {
  pedido_id: string | null;
  detalhe?: string;
}

export interface OpcoesDaMesa {
  caminhoDasMarcas?: string;
  caminhoDoRegisto?: string;
  /**
   * `conta.identificador` da configuracao - de que conta fala esta mesa (residuo do D-004: a atribuicao por
   * conta no registo). Ausente = a mesa nao sabe qual e'; nesse caso escreve as linhas SEM conta, e isso
   * fica dito na linha em vez de ser adivinhado aqui.
   */
  conta?: string;
}

/** O motivo de uma sessao nova, ou recusa: uma sessao sem razao declarada e' uma sessao que ninguem explica. */
function exigirMotivo(comando: { motivo?: string }): string {
  if (typeof comando.motivo !== "string" || comando.motivo === "") {
    throw new Error(
      "`nova_sessao` sem `motivo`: a sessao e' a unidade de comparacao (RN-M3.5), e uma sessao que nao diz porque' " +
        "comecou nao se compara com nada",
    );
  }
  return comando.motivo;
}

export class Mesa {
  estado: Estado = "parada";
  private readonly caminhoDasMarcas: string;
  private readonly caminhoDoRegisto: string;
  private readonly conta: string | undefined;

  constructor(opcoes: OpcoesDaMesa = {}) {
    this.caminhoDasMarcas = opcoes.caminhoDasMarcas ?? marcas_mod.CAMINHO_DAS_MARCAS;
    this.caminhoDoRegisto = opcoes.caminhoDoRegisto ?? join(RAIZ_DO_CORE, "estado", ".registo.jsonl");
    this.conta = opcoes.conta;
  }

  marcas(): marcas_mod.Marcas {
    return marcas_mod.lerMarcas(this.caminhoDasMarcas);
  }

  /**
   * A DECISAO DO DONO ao resumo do encerramento (T034/T035). Nao e um verbo - nao entra pela tabela.
   *
   * O instante em que a pergunta foi apresentada vem do REGISTO (a ultima transicao para `encerrando`), e nao
   * de memoria: a mesa nao guarda estado que sobreviva (R3), e um prazo contado a partir de um instante
   * inventado decidiria por quem o declarou. Sem essa transicao nao ha pergunta datavel - e devolve-se
   * `null`, para quem chamou recusar com o motivo proprio em vez de responder a uma pergunta que nao existe.
   *
   * A transicao da decisao entra no registo com o verbo `stop`: e o `stop` pendente que ela resolve, com o
   * motivo/efeito que a decisao produziu (`parada_com_posicao_viva`, `liquidacao_em_curso`).
   */
  receberDecisaoDoEncerramento(resposta: "fechar_a_mercado" | "manter", contexto: ContextoDaMesa & { avaliacao?: string | null }) {
    return this.aplicarEncerramento(resposta, contexto, `decisao do dono: ${resposta}`);
  }

  /**
   * A VOLTA DO RELOGIO DURANTE O ENCERRAMENTO (T036/RN-V9.1), sem resposta ainda.
   *
   * E aqui que o prazo se cumpre: dentro dele a mesa espera; fora dele VOLTA A OPERAR - a abrir incluido -
   * com o `stop` arquivado como PENDENTE. A tentacao era esperar para sempre; uma mesa congelada a espera de
   * uma resposta que nao vem nao defende nada, e nem sequer se sabe que parou.
   */
  esperarPeloEncerramento(contexto: ContextoDaMesa & { avaliacao?: string | null }) {
    return this.aplicarEncerramento(null, contexto, "prazo do encerramento");
  }

  private aplicarEncerramento(
    resposta: "fechar_a_mercado" | "manter" | null,
    contexto: ContextoDaMesa & { avaliacao?: string | null },
    nota: string,
  ): {
    resultado: "aceite" | "recusado";
    estado_anterior: Estado;
    estado_novo: Estado;
    efeito: string | null;
    motivo: string | null;
    resumo: ResultadoDoEncerramento["resumo"] | null;
    nota: string;
  } {
    if (this.estado !== "encerrando") {
      return {
        resultado: "recusado",
        estado_anterior: this.estado,
        estado_novo: this.estado,
        efeito: null,
        motivo: "decisao_sem_pergunta",
        resumo: null,
        nota: `Nao ha pergunta do encerramento em aberto: a mesa esta ${this.estado}.`,
      };
    }

    const inicio = instanteDaUltimaTransicaoPara("encerrando", this.caminhoDoRegisto);
    if (inicio === null) {
      return {
        resultado: "recusado",
        estado_anterior: this.estado,
        estado_novo: this.estado,
        efeito: null,
        motivo: "decisao_sem_pergunta",
        resumo: null,
        nota: "A mesa esta em `encerrando` mas o registo nao tem a transicao que data a pergunta.",
      };
    }

    if (contexto.configuracao === undefined) {
      throw new Error(
        "receberDecisaoDoEncerramento sem configuracao: a lista de eventos que avisam e do dono (RN-A3) e " +
          "sem ela nao se decide se o desfecho avisa - decide-se de menos ou decide-se por ele.",
      );
    }

    if (resposta !== null && contexto.prazo_de_resposta_ms === undefined) {
      throw new Error("decisao do encerramento sem o prazo declarado: o prazo e do dono (RN-V9.1)");
    }

    const m = this.marcas();
    const pedido: PedidoDeParada = {
      inicio_ms: inicio,
      agora_ms: contexto.instante_ms,
      // SEM PRAZO NAO HA «ZERO»: ha ausencia declarada, e a maquina de estados tem o motivo proprio para isso
      // (`prazo_de_resposta_nao_declarado`). Zero seria «responde ja'» — uma decisao que ninguem tomou.
      prazo_de_resposta_ms: contexto.prazo_de_resposta_ms,
      resposta,
    };
    const anterior = this.estado;
    const r = correrPedidoDeParada(m, pedido, contexto.posicao_viva === true, contexto.avaliacao ?? null, contexto.configuracao);

    // A VOLTA QUE ESPERA NAO E UM ACONTECIMENTO. Dentro do prazo a mesa nao fez nada de novo: escrever uma
    // transicao `encerrando -> encerrando` a cada volta enchia o registo de ruido E - pior - reiniciava o
    // prazo: o instante que data a pergunta e o da ultima transicao para `encerrando`, e cada linha dessas
    // empurrava-o para a frente. Medido: a mesa esperava para sempre. Uma recusa de COMANDO transita X->X
    // (T022), porque responder a um pedido e um acto; uma volta de relogio que nada mudou, nao.
    if (resposta === null && r.estado === anterior) {
      return {
        resultado: "aceite",
        estado_anterior: anterior,
        estado_novo: r.estado,
        efeito: r.motivo,
        motivo: null,
        resumo: r.resumo,
        nota: `${nota}: nada mudou - ${r.porque}`,
      };
    }

    this.estado = r.estado;
    marcas_mod.gravarMarcas(r.marcas, this.caminhoDasMarcas);
    registarTransicao(
      contexto.instante_ms,
      anterior,
      r.estado,
      "stop",
      "dono",
      r.motivo,
      `${nota}: ${r.porque}`,
      this.caminhoDoRegisto,
      this.conta,
    );

    return {
      resultado: "aceite",
      estado_anterior: anterior,
      estado_novo: r.estado,
      efeito: r.motivo,
      motivo: null,
      resumo: r.resumo,
      nota: r.porque,
    };
  }

  /**
   * A LIQUIDACAO ACABOU: a posicao fechou e a mesa fica `parada`.
   *
   * A transicao vai para o registo com o motivo a `null` - e uma transicao, e nao uma recusa (so as recusas
   * exigem motivo), e na nota fica dito o que a fechou. O desfecho da liquidacao (o que o venue confirmou)
   * entra pela reconciliacao, como todos os outros.
   */
  terminarLiquidacao(contexto: { instante_ms: number }): void {
    const anterior = this.estado;
    this.estado = "parada";
    registarTransicao(
      contexto.instante_ms,
      anterior,
      "parada",
      "stop",
      "dono",
      null,
      "liquidacao cumprida: nao ha posicao nossa para fechar em instrumento nenhum - a mesa fica parada",
      this.caminhoDoRegisto,
      this.conta,
    );
  }

  /** Recebe uma linha de comando. Devolve sempre resposta: aceite com estado novo, ou recusa com motivo. */
  receber(cru: unknown, contexto: ContextoDaMesa): RespostaDaMesa {
    const validacao = validarComando(cru);
    if (!validacao.ok) {
      const verbo = (cru as { verbo?: unknown })?.verbo;
      registarRecusa(
        contexto.instante_ms,
        this.estado,
        typeof verbo === "string" ? verbo : "(sem verbo)",
        "(comando invalido)",
        validacao.motivo,
        validacao.detalhe,
        this.caminhoDoRegisto,
        this.conta,
      );
      return {
        verbo: typeof verbo === "string" ? verbo : "(sem verbo)",
        resultado: "recusado",
        estado_anterior: this.estado,
        estado_novo: this.estado,
        motivo: validacao.motivo,
        motivo_da_porta: null,
        nao_tocado: null,
        nota: validacao.detalhe,
        detalhe: validacao.detalhe,
        pedido_id:
          typeof (cru as { pedido_id?: unknown })?.pedido_id === "string"
            ? ((cru as { pedido_id: string }).pedido_id as string)
            : null,
      };
    }

    const comando = validacao.comando;
    const m = this.marcas();
    const presentes = marcas_mod.marcasPresentes(m);

    const contextoDoVerbo: Contexto = { ...contexto, inibicao_cb: marcas_mod.haInibicao(m) };
    const resposta = aplicar(this.estado, comando.verbo, contextoDoVerbo, presentes);

    if (resposta.resultado === "aceite") {
      this.estado = resposta.estado_novo;

      if (comando.verbo === "reset") {
        // Explicito: o reset NAO escreve marcas (FR-005). Se um dia alguem o mudar, muda aqui.
        marcas_mod.gravarMarcas(marcas_mod.reset(m), this.caminhoDasMarcas);
      }

      if (comando.verbo === "nova_sessao") {
        // A SESSAO TEM UMA SO IMPLEMENTACAO (`estado/sessao.ts`, `novaSessao`): ela confere o ponto de
        // partida e a unidade, e LEVANTA a inibicao no mesmo passo.
        //
        // Escrever a sessao aqui a mao foi o defeito que a T042 apanhou: com o portao a nao ler o equity, a
        // mesa gravava `equity_de_partida: ""` - em SILENCIO - e o CB passava a medir a perda contra o nada
        // (o `cb.ts` compara com o equity de partida da sessao). Uma base vazia nao e uma base pequena.
        const partida = contexto.sessao_nova;
        if (partida === undefined) {
          throw new Error(
            "nova_sessao sem ponto de partida: faltam o equity da corretora ou a unidade de comparacao, e " +
              "nenhum dos dois se inventa aqui. Quem os le e a porta (as duas verdades que a mesa nao tira de " +
              "si); sem eles a sessao nasceria com uma base que ninguem teve.",
          );
        }
        const resultado = sessao_mod.novaSessao(m, {
          instante_ms: contexto.instante_ms,
          equity_de_partida: partida.equity_de_partida,
          autor: comando.autor,
          motivo: exigirMotivo(comando),
          configuracao_em_vigor: partida.configuracao_em_vigor,
        });
        marcas_mod.gravarMarcas(resultado.marcas, this.caminhoDasMarcas);
      }

      registarTransicao(
        contexto.instante_ms,
        resposta.estado_anterior,
        resposta.estado_novo,
        comando.verbo,
        comando.autor,
        null,
        resposta.nota,
        this.caminhoDoRegisto,
        this.conta,
      );
    } else {
      registarRecusa(
        contexto.instante_ms,
        this.estado,
        comando.verbo,
        comando.autor,
        (() => {
          // UMA RECUSA SEM MOTIVO E' UM DEFEITO DA PROPRIA MESA, e grita. O que estava aqui era `?? "(sem motivo)"`:
          // uma frase inventada no registo, a passar por razao.
          if (resposta.motivo === undefined || resposta.motivo === null) {
            throw new Error(
              `a mesa recusou o verbo \`${comando.verbo}\` sem dizer porque': o registo nao pode guardar uma recusa muda`,
            );
          }
          return resposta.motivo;
        })(),
        resposta.nota,
        this.caminhoDoRegisto,
        this.conta,
      );
    }

    return { ...resposta, pedido_id: comando.pedido_id };
  }
}
