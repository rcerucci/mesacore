// A POSIÇÃO E A ORDEM QUE A ABRIU — a MARCA de posse ligada à linha do desfecho que a enviou.
//
// PORQUE EXISTE: quem abre o painel vê uma posição e não sabe de que ordem dela veio — e sem o `oid` do venue não
// se consegue comparar a tela com o UI da Hyperliquid LINHA A LINHA (medido a 04/10/2026: o dono comparou, viu a
// posição ETH, e perguntou se o painel estava a acompanhar; e a ligação já era requisito).
//
// Puro e sem efeitos ao carregar, para a bancada o poder provar directamente (`prova-da-ordem.ts`) — a lição do
// `buracos.ts` e do `travado.ts`: uma regra que só corre dentro de um script inteiro não se mede sozinha.
//
// O QUE A LIGAÇÃO NÃO FAZ: INVENTAR. Sem desfecho para a marca, diz-se o que falta (`encontrada: false` + o porquê)
// — nunca um `oid` a fingir.

/** O MAPA DAS MARCAS — de `marca` para a linha do desfecho que a enviou.
 *
 * Recebe as linhas JÁ LIDAS (uma lista por ficheiro), e não caminhos: quem lê ficheiros é o `retrato.ts`, e a
 * regra fica pura. Uma marca pode ter mais do que uma linha — uma recusa e um reenvio, como na colisão de
 * referências de 04/10/2026 —, e fica a ÚLTIMA, que é a que valeu. */
export function marcadorDosDesfechos(porFicheiro: any[][]): Map<number, any> {
  const mapa = new Map<number, any>();
  for (const linhas of porFicheiro) {
    for (const l of linhas) {
      const marca = Number(l?.marca);
      if (!Number.isFinite(marca)) continue;
      const d = l.desfecho ?? {};
      const r = d.resposta_do_venue ?? {};
      const bruto = r.bruto ?? {};
      mapa.set(marca, {
        marca,
        referencia: l.referencia ?? null,
        quando: l.quando ?? null,
        classificacao: d.classificacao ?? null,
        recusado: l.recusado === true,
        oid: bruto.oid ?? r.order_id ?? null,
        cloid: bruto.cloid ?? null,
        preco_medio: r.preco_medio ?? null,
        preenchido: r.preenchido ?? null,
      });
    }
  }
  return mapa;
}

/** A ORDEM QUE ABRIU UMA POSIÇÃO, ligada pela marca de posse.
 *
 * Sem marca na posição, ou sem desfecho para a marca, devolve `encontrada: false` com o PORQUÊ — a tela diz o que
 * falta em vez de mostrar um vazio com cara de zero. */
export function ordemDaPosicao(mapa: Map<number, any>, posicao: any): any {
  if (posicao === null || posicao === undefined) return null;
  const marca = Number(posicao.marca_de_posse);
  if (!Number.isFinite(marca)) {
    return { encontrada: false, marca: null, porque: "a posição não traz marca de posse — não há como ligá-la a uma ordem" };
  }
  const d = mapa.get(marca);
  if (d === undefined) {
    return { encontrada: false, marca, porque: `não há desfecho desta corrida com a marca ${marca} (a ordem veio de outra corrida, ou o desfecho não foi escrito)` };
  }
  return { encontrada: true, ...d };
}
