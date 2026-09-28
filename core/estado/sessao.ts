// A sessao: a unidade de comparacao.
//
// Uma sessao tem comeco (instante, equity de partida, autor, motivo) e uma CONFIGURACAO EM VIGOR (ficha,
// versao do setup, versao do mandato). E a configuracao em vigor que fecha a unidade: sem ela, dois
// numeros da mesma mesa podem vir de duas estrategias diferentes, e comparar um com o outro nao diz nada
// sobre nenhum (FR-034).
//
// Daqui saem duas coisas, e mais nada:
//
//   `novaSessao`          - grava a sessao nova e LEVANTA a inibicao. E o unico caminho fora dela
//                           (FR-038), e por isso nao ha neste ficheiro nenhuma outra funcao que mexa na
//                           inibicao.
//   `trocarConfiguracao`  - recusa trocar ficha ou setup com uma sessao em curso (FR-039). Duas
//                           configuracoes no mesmo numero nao se comparam - e a troca silenciosa e o
//                           caminho mais curto para nunca mais se saber o que estava em vigor.
//
// O `reset` nao aparece aqui: o reset reinicia sem mexer em nada, e a inibicao so sai por decisao do dono.

import { gravarSessao, type ConfiguracaoEmVigor, type Marcas, type Sessao } from "./marcas.ts";

export interface PedidoDeSessaoNova {
  instante_ms: number;
  equity_de_partida: string;
  autor: string;
  motivo: string;
  configuracao_em_vigor: ConfiguracaoEmVigor;
}

export interface Resultado {
  marcas: Marcas;
  aceite: boolean;
  motivo: string | null;
  porque: string;
  /** A inibicao que existia antes, para o registo poder dizer o que a sessao nova levantou. */
  inibicao_levantada: boolean;
}

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function conferirConfiguracao(emVigor: ConfiguracaoEmVigor, onde: string): void {
  for (const [campo, valor] of Object.entries(emVigor)) {
    if (typeof valor !== "string" || valor.length === 0) {
      throw new Error(`${onde}: a configuracao em vigor tem '${campo}' vazio - uma unidade sem nome nao se compara`);
    }
  }
}

export function novaSessao(m: Marcas, pedido: PedidoDeSessaoNova): Resultado {
  if (typeof pedido.equity_de_partida !== "string" || !DECIMAL.test(pedido.equity_de_partida)) {
    throw new Error(
      `equity de partida invalido: '${String(pedido.equity_de_partida)}'. Um ponto de partida inventado ` +
        "faz o CB medir a perda contra uma base que ninguem teve (D4).",
    );
  }
  conferirConfiguracao(pedido.configuracao_em_vigor, "configuracao_em_vigor");

  const sessao: Sessao = {
    instante_ms: pedido.instante_ms,
    equity_de_partida: pedido.equity_de_partida,
    autor: pedido.autor,
    motivo: pedido.motivo,
    configuracao_em_vigor: pedido.configuracao_em_vigor,
  };

  const tinhaInibicao = m.inibicao_cb !== null;

  // `gravarSessao` escreve a sessao E limpa a inibicao - as duas coisas no mesmo passo, para nao existir
  // um instante em que ha sessao nova com a inibicao velha, nem inibicao levantada sem sessao que a
  // justifique.
  return {
    marcas: gravarSessao(m, sessao),
    aceite: true,
    motivo: "sessao_nova_gravada",
    porque: tinhaInibicao
      ? "Sessao nova gravada com a configuracao em vigor, e a inibicao do CB levantada - por decisao do dono, que e a unica que a pode levantar."
      : "Sessao nova gravada com a configuracao em vigor.",
    inibicao_levantada: tinhaInibicao,
  };
}

export function trocarConfiguracao(m: Marcas, nova: ConfiguracaoEmVigor): Resultado {
  conferirConfiguracao(nova, "configuracao_pedida");

  const emVigor = m.sessao?.configuracao_em_vigor ?? null;
  if (emVigor === null) {
    return {
      marcas: m,
      aceite: true,
      motivo: "troca_sem_sessao",
      porque: "Nao ha sessao em curso: nao ha unidade de comparacao para proteger, e a troca vale para a proxima sessao.",
      inibicao_levantada: false,
    };
  }

  const igual =
    emVigor.ficha === nova.ficha &&
    emVigor.versao_do_setup === nova.versao_do_setup &&
    emVigor.versao_do_mandato === nova.versao_do_mandato;

  if (igual) {
    return {
      marcas: m,
      aceite: true,
      motivo: "troca_sem_mudanca",
      porque: "A configuracao pedida e a que esta em vigor: nada muda, nada se grava, e a unidade de comparacao fica intacta.",
      inibicao_levantada: false,
    };
  }

  return {
    marcas: m,
    aceite: false,
    motivo: "troca_de_configuracao_sem_sessao_nova",
    porque:
      `Esta sessao corre com ficha ${emVigor.ficha}, setup ${emVigor.versao_do_setup}, mandato ${emVigor.versao_do_mandato}` +
      `; pediu-se ficha ${nova.ficha}, setup ${nova.versao_do_setup}, mandato ${nova.versao_do_mandato}. ` +
      "Duas configuracoes no mesmo numero nao se comparam: a troca exige uma sessao nova (FR-039).",
    inibicao_levantada: false,
  };
}
