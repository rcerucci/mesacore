// O encerramento e a pergunta que pode ficar sem resposta.
//
// Em `encerrando` a mesa apresenta o resumo e PERGUNTA se fecha a mercado. Duas coisas podem acontecer, e
// a segunda e a que interessa:
//
//   a resposta chega        -> faz-se o que o dono respondeu
//   a resposta NAO chega    -> a mesa volta ao normal (a abrir incluido) e o `stop` fica PENDENTE
//
// A tentacao evidente e esperar. Esperar por uma resposta que nao vem deixa a mesa congelada: nao abre,
// nao fecha, e ninguem sabe que ela parou. Um pedido ignorado nao e uma ordem - e um pedido, e a mesa
// nao o transforma em imobilidade.
//
// O resumo existe por uma razao que tambem e uma divida: `manter` deixa a posicao viva numa mesa PARADA, e
// uma mesa parada NAO DEFENDE nada (nao corre ciclo, nao ve preco, nao fecha). Quem escolhe `manter` tem
// de o ler ANTES de escolher - e por isso o aviso e um campo do resumo, e nao uma nota de rodape.

import { arquivarPedido, type Marcas } from "../estado/marcas.ts";
import { deveAvisar, type ConfiguracaoDaConta } from "../config/configuracao.ts";

export interface ResumoDoEncerramento {
  posicao_viva: boolean;
  /** `null` quando nao ha posicao viva: nao ha nada a avisar. */
  aviso_de_manter: string | null;
  posicao_sem_defesa: boolean;
  opcoes: string[];
  porque: string;
}

export function resumoDoEncerramento(posicaoViva: boolean, avaliacao: string | null): ResumoDoEncerramento {
  if (!posicaoViva) {
    return {
      posicao_viva: false,
      aviso_de_manter: null,
      posicao_sem_defesa: false,
      opcoes: ["fechar_a_mercado", "manter"],
      porque: "Nao ha posicao viva: parar agora nao deixa nada por defender.",
    };
  }
  return {
    posicao_viva: true,
    aviso_de_manter:
      "Se escolher MANTER, a mesa fica parada e NADA DEFENDE a posicao: o ciclo nao corre, o preco nao e " +
      "vigiado e o CB nao dispara. A posicao fica a espera de que o dono volte.",
    posicao_sem_defesa: true,
    opcoes: ["fechar_a_mercado", "manter"],
    porque:
      `Ha posicao viva${avaliacao ? ` (${avaliacao})` : ""}. O resumo diz o que cada escolha custa antes de ela ser feita.`,
  };
}

export interface PedidoDeParada {
  inicio_ms: number;
  agora_ms: number;
  /** O prazo declarado (`setup.prazo_de_resposta_ms`): em setup manual e prazo humano. */
  prazo_de_resposta_ms: number;
  /** A resposta do dono, ou `null` enquanto nao chegou nenhuma. */
  resposta: "fechar_a_mercado" | "manter" | null;
}

export interface ResultadoDoEncerramento {
  /** O estado em que a mesa fica DEPOIS deste passo. */
  estado: "encerrando" | "em_operacao" | "parada";
  marcas: Marcas;
  motivo: string | null;
  avisa: boolean;
  pedido_pendente: boolean;
  resumo: ResumoDoEncerramento;
  porque: string;
}

export function correrPedidoDeParada(
  marcas: Marcas,
  pedido: PedidoDeParada,
  posicaoViva: boolean,
  avaliacao: string | null,
  config: ConfiguracaoDaConta,
): ResultadoDoEncerramento {
  const resumo = resumoDoEncerramento(posicaoViva, avaliacao);

  if (pedido.resposta === "manter") {
    return {
      estado: "parada",
      marcas,
      motivo: "parada_com_posicao_viva",
      avisa: false,
      pedido_pendente: false,
      resumo,
      porque: "O dono escolheu manter com o resumo a frente: fica parada, e a posicao fica sem defesa por decisao dele.",
    };
  }

  if (pedido.resposta === "fechar_a_mercado") {
    return {
      estado: "encerrando",
      marcas,
      motivo: "liquidacao_em_curso",
      avisa: deveAvisar(config, "encerramento"),
      pedido_pendente: false,
      resumo,
      porque: "O dono escolheu fechar a mercado: a mesa liquida e so depois fica parada.",
    };
  }

  // Sem resposta: dentro do prazo ainda se espera; fora do prazo a mesa VOLTA A OPERAR.
  const esperando = pedido.agora_ms - pedido.inicio_ms <= pedido.prazo_de_resposta_ms;
  if (esperando) {
    return {
      estado: "encerrando",
      marcas,
      motivo: "resumo_do_encerramento_apresentado",
      avisa: deveAvisar(config, "encerramento"),
      pedido_pendente: false,
      resumo,
      porque: `O resumo foi apresentado e o prazo declarado (${pedido.prazo_de_resposta_ms}ms) ainda corre.`,
    };
  }

  // Passou o prazo sem resposta: volta a operar, com o `stop` arquivado como PENDENTE.
  const marcasComPedido = arquivarPedido(marcas, {
    verbo: "stop",
    instante_ms: pedido.inicio_ms,
    motivo: "stop_pendente_por_prazo",
  });

  return {
    estado: "em_operacao",
    marcas: marcasComPedido,
    motivo: "stop_pendente_por_prazo",
    // O evento existe no vocabulario fechado e quem decide se avisa e a lista do dono (FR-042).
    avisa: deveAvisar(config, "pedido_ignorado"),
    pedido_pendente: true,
    resumo,
    porque:
      "O prazo passou sem resposta. A mesa volta ao normal - a abrir incluido - e o `stop` fica registrado " +
      "como PENDENTE: pedido ignorado nao e pedido cumprido, e tambem nao e motivo para deixar de operar.",
  };
}
