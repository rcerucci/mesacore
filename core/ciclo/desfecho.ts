// O desfecho: o que se sabe (e o que se aceita nao saber) depois de a boleta sair.
//
// A regra que este ficheiro existe para cumprir e uma so, e e a que doi:
//
//   UM DESFECHO SEM CONFIRMACAO NAO E UM SUCESSO NEM UMA FALHA. E DESCONHECIDO.
//
// Promover o silencio a `aceite` manda uma segunda ordem sobre uma posicao que talvez exista; rebaixa-lo
// a `recusado` deixa uma posicao orfa que ninguem defende. As duas coisas sao piores do que nao saber -
// e por isso a classificacao `desconhecido` existe no contrato, e nao e um estado de erro.
//
// O `desconhecido` fica MARCADO (marcas.ts): sobrevive ao processo morrer, bloqueia ordem nova naquele
// instrumento, e SO sai por reconciliacao que decida (reconciliacao.ts). `reset` nao o limpa.
//
// Terceira regra, e a mais facil de esquecer: uma confirmacao que o contrato RECUSA nao e uma
// confirmacao. `desfecho_ilegivel` e desconhecido - nunca um desfecho. Falhar para o lado de "nao sei"
// e o unico lado seguro.

import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { deveAvisar, type ConfiguracaoDaConta } from "../config/configuracao.ts";
import type { Desconhecido } from "../estado/marcas.ts";
import { conferirBanda, type ConferenciaDaBanda, type EntradaDaConferencia } from "./banda.ts";

export type Classificacao = "aceite" | "parcial" | "desconhecido" | "recusado";

export interface Envio {
  instrumento: string;
  referencia_do_cliente: string;
  enviado_em_ms: number;
  /** O prazo vem da config (`setup.prazo_de_resposta_ms`): em setup manual e prazo humano. */
  prazo_de_resposta_ms: number;
}

export interface ResultadoDoDesfecho {
  /**
   * `null` = ainda dentro do prazo. Nao e uma classificacao por omissao: e a AUSENCIA de classificacao,
   * e a mesa nao inventa uma.
   */
  classificacao: Classificacao | null;
  /** Motivo da mesa (`core/estados/motivos.json`), ou `null` quando nao ha nada a assinalar. */
  motivo: string | null;
  /** O motivo do CONTRATO, quando foi ele a recusar o desfecho. */
  motivo_do_contrato: string | null;
  /** A marca a gravar, quando o desfecho fica desconhecido. */
  marca_a_gravar: Omit<Desconhecido, "instante_ms"> | null;
  /** O que a mesa passa a saber sobre a posicao daquele instrumento. */
  estado_da_posicao: "nenhuma" | "abrindo" | "aberta";
  /** Calculado da config do dono (FR-042), nunca escrito aqui. */
  avisa: boolean;
  /**
   * A conferencia da banda (D-001), quando o chamador traz o que ela precisa (a banda da ficha, o
   * equity e a marca). `null` = nao se conferiu - e "nao se conferiu" nao e "esta dentro".
   */
  banda: ConferenciaDaBanda | null;
  porque: string;
}

/**
 * Classifica o desfecho de UMA boleta.
 *
 * A ordem das verificacoes e a ordem dos perigos: primeiro se ja se sabe alguma coisa (a chegada), e so
 * depois o tempo. Nunca ao contrario - um desfecho que chegou nao vira desconhecido por ter demorado.
 */
export function classificarDesfecho(
  envio: Envio,
  chegada: { desfecho: unknown } | null,
  agora_ms: number,
  config: ConfiguracaoDaConta,
  /**
   * O que a CONFERENCIA DA BANDA precisa (D-001): a banda da ficha, o equity e a marca. Ausente = nao se
   * confere - a mesa nao inventa um veredicto sobre uma resolucao que ninguem lhe deu como comparar.
   */
  conferencia?: EntradaDaConferencia | null,
): ResultadoDoDesfecho {
  // 1. Nao chegou nada.
  if (chegada === null) {
    const decorrido = agora_ms - envio.enviado_em_ms;
    const dentroDoPrazo = decorrido <= envio.prazo_de_resposta_ms;

    if (dentroDoPrazo) {
      return {
        classificacao: null,
        motivo: "desfecho_aguardado_dentro_do_prazo",
        motivo_do_contrato: null,
        marca_a_gravar: null,
        estado_da_posicao: "abrindo",
        avisa: false,
        banda: null,
        porque: `Passaram ${decorrido}ms de ${envio.prazo_de_resposta_ms}ms declarados: ainda e tempo de resposta, e nao um silencio.`,
      };
    }

    return desconhecido(
      envio,
      "sem_confirmacao_dentro_do_prazo",
      null,
      config,
      `Passaram ${decorrido}ms e o prazo declarado era ${envio.prazo_de_resposta_ms}ms. A ordem pode ter entrado: nao se promove a aceite nem se rebaixa a recusado.`,
    );
  }

  // 2. Chegou algo. Se o contrato o recusa, ficamos exactamente onde estavamos: sem saber.
  const decisao = validar(
    JSON.stringify({
      contrato: versaoVigente(),
      tipo: "desfecho",
      id: envio.referencia_do_cliente,
      carga: chegada.desfecho,
    }),
  );
  if (decisao.veredicto !== "aceite") {
    return desconhecido(
      envio,
      "desfecho_ilegivel",
      decisao.motivo ?? null,
      config,
      `A confirmacao nao passou o contrato (${decisao.veredicto}${decisao.motivo ? ` - ${decisao.motivo}` : ""}). Uma confirmacao ilegivel nao e uma confirmacao - falha-se para o lado de "nao sei".`,
    );
  }

  const desfecho = chegada.desfecho as any;
  const classificacao = desfecho.classificacao as Classificacao;

  // 3. Recusa: a mesa volta a `nenhuma` e o motivo do venue fica registrado (FR-024).
  if (classificacao === "recusado") {
    return {
      classificacao,
      motivo: "desfecho_recusado_pelo_venue",
      motivo_do_contrato: desfecho.motivo ?? null,
      marca_a_gravar: null,
      estado_da_posicao: "nenhuma",
      avisa: deveAvisar(config, "recusa"),
      // Nao houve resolucao: nao se confere o que nunca se chegou a resolver (RN-C10).
      banda: null,
      porque: "A corretora recusou: nao ha posicao. O motivo dela fica registrado para o dono o poder ler.",
    };
  }

  // 4. Aceite e parcial: ha posicao. O resto da parcial segue a politica do template (FR-023). E aqui,
  // com a resolucao na mao, corre a CONFERENCIA DA BANDA (D-001) - quando o chamador trouxe o que ela
  // precisa. Uma resolucao fora da banda nao se recusa (ja esta executado): registra-se a divergencia,
  // reduz-se, e nao se abre risco novo neste instrumento ate ela estar explicada.
  const banda = conferencia == null ? null : conferirBanda({ ...conferencia, resolucao: desfecho.resolucao });
  const foraDaBanda = banda !== null && banda.veredicto === "fora";
  return {
    classificacao,
    motivo: foraDaBanda ? "resolucao_fora_da_banda" : null,
    motivo_do_contrato: null,
    marca_a_gravar: null,
    estado_da_posicao: "aberta",
    // Nem `aceite` nem `parcial` tem evento de alarme: sao o desfecho que se pediu. Alarmar o que corre
    // bem e o caminho mais curto para o dono deixar de ler os avisos. Uma divergencia de banda NAO e o
    // desfecho que se pediu - essa avisa, e quem decide se o dono e avisado e a lista dele (FR-042).
    avisa: foraDaBanda ? deveAvisar(config, "divergencia") : false,
    banda,
    porque: foraDaBanda
      ? `A posicao existe, e a resolucao NAO cabe na banda declarada: ${banda!.porque}`
      : classificacao === "parcial"
        ? "Aceite parcial: a posicao existe e o resto segue a politica declarada na boleta. Nao e um desconhecido - sabe-se exactamente o que ficou."
        : "Aceite: a posicao existe, e a mesa sabe o que tem porque a corretora o disse.",
  };
}

function desconhecido(
  envio: Envio,
  motivo: string,
  motivoDoContrato: string | null,
  config: ConfiguracaoDaConta,
  porque: string,
): ResultadoDoDesfecho {
  return {
    classificacao: "desconhecido",
    motivo,
    motivo_do_contrato: motivoDoContrato,
    marca_a_gravar: {
      instrumento: envio.instrumento,
      motivo,
      referencia_do_cliente: envio.referencia_do_cliente,
    },
    // Nao se sabe se ha posicao: `abrindo` e o unico estado honesto - a ordem pode estar viva.
    estado_da_posicao: "abrindo",
    avisa: deveAvisar(config, "desconhecido"),
    banda: null,
    porque,
  };
}
