// O REGISTRO DO VIGIA: o que ele recebeu, o que decidiu e o que a mesa respondeu.
//
// Vive em `vigia/.vigia.json` e NAO no ledger da mesa. O ledger e da conta e do dinheiro; este e da
// OPERACAO. Misturar os dois faria o extrato do dono contar arranques de processo - e um extrato que conta
// outra coisa deixa de ser extrato.
//
// A escrita e ATOMICA (ficheiro temporario + rename): um vigia morto a meio de uma gravacao nao pode deixar
// um registro pela metade. Um registro ilegivel e o mesmo que um registro ausente, e quem vier depois le-o
// como "nao houve nada" - que e exactamente a conclusao errada.
//
// Uma linha por TRANSICAO, e nao por comando: um comando recusado tambem transita (de X para X), e um
// registro que so guardasse o que mudou de estado esconderia justamente as recusas.

import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface TransicaoDoVigia {
  instante_ms: number;
  verbo: string;
  autor: string;
  pedido_id: string;
  aceito: boolean;
  de: string;
  para: string;
  motivo: string | null;
  efeito: string | null;
  /** Só quando as portas recusaram: QUAL das seis, e o motivo dela. E este o "detalhe" da T021. */
  porta: string | null;
  motivo_da_porta: string | null;
  /** O NOME do que faltou naquela porta (o conector que nao esta de pe - T027). */
  detalhe_da_porta: string | null;
  /** O que se chegou a olhar no arranque - nao o que se diz que se olhou. */
  portas_conferidas: string[];
}

/**
 * Uma LEITURA do vigia: o que ele olhou sem mandar nada.
 *
 * Fica em lista propria, e nao nas transicoes, porque uma transicao responde a um VERBO - e uma leitura
 * nao obedece verbo nenhum. Misturar as duas faria o registro mostrar um sexto verbo que ninguem tem
 * (FR-002: sao cinco) e a auditoria perder-se a contar comandos que nunca foram dados.
 *
 * Existe por causa da T029: no regresso, o vigia LE o estado da mesa e nao arranca nada por conta propria -
 * e a prova disso e uma leitura com o estado, e zero transicoes novas.
 */
export interface LeituraDoVigia {
  instante_ms: number;
  estado_da_mesa: string;
  /** Onde se leu: o registo da mesa (o ledger), que e dela. Nunca a memoria do vigia. */
  de: string;
  porque: string;
}

/**
 * Um PROCESSO que o vigia levantou. Fica no registro porque a RN-V4 quer o vigia auditavel por leitura do
 * seu registro - e "o que ele arrancou" faz parte disso: um pid que ninguem escreveu e uma ligacao que
 * ninguem sabe de quem e. Serve tambem a bancada da orfandade, que precisa de saber quem matar no fim.
 */
export interface ProcessoLevantado {
  instante_ms: number;
  papel: "mesa" | "conector";
  nome: string;
  pid: number | undefined;
}

export interface Registro {
  nota: string;
  transicoes: TransicaoDoVigia[];
  leituras: LeituraDoVigia[];
  processos: ProcessoLevantado[];
}

export function registoVazio(): Registro {
  return {
    nota:
      "O registro do vigia: uma linha por transicao, com o que foi pedido, o que a mesa respondeu e - no " +
      "arranque - ate onde as sete portas foram conferidas. Nao guarda valores de conta nem preco: isso e " +
      "do ledger, e o ledger e do dinheiro.",
    transicoes: [],
    leituras: [],
    processos: [],
  };
}

/**
 * O CAMINHO E OBRIGATORIO, e a recusa e alta.
 *
 * Medido, e nao por gosto: uma chamada com o caminho a `undefined` escreveu um ficheiro chamado
 * `undefined.tmp` na raiz do repositorio - o registro da OPERACAO passou a existir num sitio que ninguem
 * escolheu, e sem erro nenhum. Um ficheiro com o nome errado e pior do que uma recusa: quem procura o
 * registro nao o encontra e conclui que nao houve operacao.
 */
function exigirCaminho(caminho: string, quem: string): void {
  if (typeof caminho !== "string" || caminho.trim() === "") {
    throw new Error(`${quem}: o caminho do registro do vigia e obrigatorio (recebido: ${JSON.stringify(caminho)})`);
  }
}

export function lerRegisto(caminho: string): Registro {
  exigirCaminho(caminho, "lerRegisto");
  try {
    const lido = JSON.parse(readFileSync(caminho, "utf8")) as Registro;
    // Um registro gravado antes de existirem leituras nao tem a chave: completa-se VAZIA, para quem le nao
    // ter de saber a idade do ficheiro para o ler.
    if (!Array.isArray(lido.leituras)) lido.leituras = [];
    if (!Array.isArray(lido.processos)) lido.processos = [];
    return lido;
  } catch {
    return registoVazio();
  }
}

/** Acrescenta um processo levantado e grava (mesma escrita atomica das transicoes). */
export function anotarProcesso(caminho: string, p: ProcessoLevantado): void {
  exigirCaminho(caminho, "anotarProcesso");
  const registro = lerRegisto(caminho);
  registro.processos.push(p);
  const temporario = caminho + ".tmp";
  writeFileSync(temporario, JSON.stringify(registro, null, 2) + "\n");
  renameSync(temporario, caminho);
}

/** Acrescenta uma leitura e grava (mesma escrita atomica das transicoes). */
export function anotarLeitura(caminho: string, l: LeituraDoVigia): Registro {
  exigirCaminho(caminho, "anotarLeitura");
  const registro = lerRegisto(caminho);
  registro.leituras.push(l);
  const temporario = caminho + ".tmp";
  writeFileSync(temporario, JSON.stringify(registro, null, 2) + "\n");
  renameSync(temporario, caminho);
  return registro;
}

/** Acrescenta uma transicao e grava. Devolve o registro como ficou. */
export function acrescentar(caminho: string, t: TransicaoDoVigia): Registro {
  exigirCaminho(caminho, "acrescentar");
  const registro = lerRegisto(caminho);
  registro.transicoes.push(t);
  const temporario = caminho + ".tmp";
  writeFileSync(temporario, JSON.stringify(registro, null, 2) + "\n");
  renameSync(temporario, caminho);
  return registro;
}
