// O QUE TRAVA UM PAR — e o que NÃO trava.
//
// Vive num módulo próprio, sem efeitos ao carregar, para a bancada o poder provar directamente (a lição do
// `buracos.ts`: uma regra que só corre dentro de um script inteiro não se mede sozinha).
//
// A DISTINÇÃO: há DUAS razões para um par não fazer nada, e não valem o mesmo.
//
//   * ESPERA — o setup não tem nada a dizer nesta volta (não propôs nada, propôs sem lado, a proposta era de uma
//     barra antiga), ou o dono/o próprio sistema mandaram esperar (mesa pausada, sessão inibida, desfecho dentro do
//     prazo, troca de mandato sem mudança). Num sistema em observação este é o estado NORMAL: um sistema à espera de
//     uma viragem;
//   * ATENÇÃO — a mesa NÃO conseguiu fazer o que queria, ou algo está por resolver: sem leitura do venue, margem
//     insuficiente, risco por ordem excedido, desfecho recusado, posição desconhecida ou alheia, reconciliação
//     indecível, liquidação em curso, verbo ou registo ilegível. Isto é do dono.
//
// Três medições obrigaram a esta régua (04/10/2026):
//
//   1. `travado: quantos > 0` chamava «travado» a UMA volta sem ação — o ETH (1m, com 273 preenchimentos e uma ordem
//      preenchida 10 minutos antes) aparecia `travado` com `1 ciclo`, e o contador do painel oscilava entre 2 e 3 a
//      cada leitura;
//   2. a correcção seguinte — «abstenção de mais de uma barra do próprio par» — ainda oscilava num par de 1m, onde
//      «mais de uma barra» são DOIS MINUTOS, e ainda calava um defeito de uma só volta (pior que a oscilação);
//   3. a régua certa NÃO é o tempo: é a NATUREZA do motivo. O tempo continua a ser DITO (o `desde_ms`), mas não é
//      ele que escolhe a palavra.
//
// E o desconhecido NUNCA é uma espera: um motivo fora da lista conta como ATENÇÃO — na dúvida diz-se que o dono tem
// de olhar, e a tela mostra o motivo cru para a lista se poder corrigir.

/** Os motivos que são ESPERA (uma abstenção, não um defeito). A lista é FECHADA e explícita; tudo o que não está
 *  aqui — incluindo um motivo que nunca se viu — conta como ATENÇÃO. */
const MOTIVOS_DE_ESPERA = new Set([
  "proposta_ausente_tratada_como_hold",
  "proposta_sem_lado_a_executar",
  "proposta_de_barra_antiga",
  "entrada_ja_feita_nesta_barra",
  "desfecho_aguardado_dentro_do_prazo",
  "mesa_pausada_nao_abre",
  "parada_com_posicao_viva",
  "sessao_inibida",
  "troca_sem_mudanca",
  "troca_sem_sessao",
  "sessao_nova_gravada",
  "resumo_do_encerramento_apresentado",
]);

/** A NATUREZA de um motivo: `espera` (o setup não tem nada a dizer) ou `atencao` (precisa do dono).
 *  Um motivo desconhecido é `atencao` — nunca se esconde o que não se conhece. */
export function classeDoMotivo(motivo: string | null | undefined): "espera" | "atencao" {
  return motivo !== null && motivo !== undefined && MOTIVOS_DE_ESPERA.has(String(motivo)) ? "espera" : "atencao";
}

/** A corrente final de ciclos `nada` de um par — a natureza do motivo dominante, o motivo cru, desde quando e
 *  quantos ciclos leva.
 *
 *  `travado` = a natureza é ATENÇÃO, e só então. A ESPERA continua a ser dita, com a duração, mas não usa a palavra
 *  que faz o dono pensar que o sistema avariou. */
export function oQueTrava(
  meusCiclos: any[],
): { travado: boolean; classe: "espera" | "atencao"; porque: string | null; desde_ms: number | null; ciclos: number } {
  let porque: string | null = null;
  let desde: number | null = null;
  let quantos = 0;
  // A CORRENTE É DO MOTIVO VIGENTE, e não de todos os ciclos sem ação: conta-se do fim para trás enquanto o motivo
  // for o MESMO. Antes contavam-se todos os `nada` seguidos e ficava-se com o motivo do INÍCIO — um defeito que já
  // passou continuava a ser mostrado como o que trava agora, e o «há quanto tempo» media a coisa errada. É a
  // diferença entre «o que se passa agora» e «o que se passou desde a última vez que o par agiu».
  for (let k = meusCiclos.length - 1; k >= 0; k--) {
    const c = meusCiclos[k]!;
    if (c.acao !== "nada") break;
    const m = c.motivo ?? null;
    if (quantos === 0) porque = m;
    else if (m !== porque) break;
    desde = c.instante_ms ?? null;
    quantos++;
  }
  // SEM CORRENTE NÃO HÁ NATUREZA NENHUMA: se o par agiu no último ciclo (ou nunca disse nada), não está travado —
  // não se inventa uma atenção a partir de um vazio. É a diferença entre «não há corrente» e «há uma corrente cujo
  // motivo não se conhece» (essa é atenção, e é a regra seguinte).
  if (quantos === 0) return { travado: false, classe: "espera", porque: null, desde_ms: null, ciclos: 0 };
  const classe = classeDoMotivo(porque);
  return { travado: classe === "atencao", classe, porque, desde_ms: desde, ciclos: quantos };
}
