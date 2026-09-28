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
import { registarRecusa, registarTransicao } from "./estado/registo.ts";

export const RAIZ_DO_CORE = join(import.meta.dir);

export interface ContextoDaMesa extends Contexto {
  /** O relogio e o do VENUE (RN-D3): quem chama traz o instante de la. */
  instante_ms: number;
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
}

export class Mesa {
  estado: Estado = "parada";
  private readonly caminhoDasMarcas: string;
  private readonly caminhoDoRegisto: string;

  constructor(opcoes: OpcoesDaMesa = {}) {
    this.caminhoDasMarcas = opcoes.caminhoDasMarcas ?? marcas_mod.CAMINHO_DAS_MARCAS;
    this.caminhoDoRegisto = opcoes.caminhoDoRegisto ?? join(RAIZ_DO_CORE, "estado", ".registo.jsonl");
  }

  marcas(): marcas_mod.Marcas {
    return marcas_mod.lerMarcas(this.caminhoDasMarcas);
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
        const sessao: marcas_mod.Sessao = {
          instante_ms: contexto.instante_ms,
          equity_de_partida: contexto.sessao_nova?.equity_de_partida ?? "",
          autor: comando.autor,
          motivo: comando.motivo ?? "",
          configuracao_em_vigor: contexto.sessao_nova?.configuracao_em_vigor ?? {
            ficha: "",
            versao_do_setup: "",
            versao_do_mandato: "",
          },
        };
        marcas_mod.gravarMarcas(marcas_mod.gravarSessao(m, sessao), this.caminhoDasMarcas);
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
      );
    } else {
      registarRecusa(
        contexto.instante_ms,
        this.estado,
        comando.verbo,
        comando.autor,
        resposta.motivo ?? "(sem motivo)",
        resposta.nota,
        this.caminhoDoRegisto,
      );
    }

    return { ...resposta, pedido_id: comando.pedido_id };
  }
}
