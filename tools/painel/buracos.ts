// OS BURACOS DO HISTORICO — um vao REAL entre duas velas, NOMEADO (de/ate + quantas faltam).
//
// PORQUE ESTE FICHEIRO EXISTE, e nao a funcao dentro do `retrato.ts`: o `retrato.ts` e' um SCRIPT (corre ao ser
// carregado e escreve o fio). Importar de la' a funcao fazia uma bancada gerar o fio do REPOSITORIO como efeito
// colateral — medido a 04/10/2026, ao escrever a prova dos buracos. A funcao vive aqui, SEM EFEITOS AO CARREGAR, e
// o `retrato.ts` importa-a como qualquer outro modulo puro.
//
// O QUE ELA FAZ (medido a 04/10/2026). O dono viu um gap no grafico e nao sabia se era leitura falhada, duplicado
// ou paragem: mediu-se 0 duplicados e um vao REAL — a paragem da maquina — que o FEED ja' NOMEAVA
// (`buraco_no_historico`, com `faltam`) e que nunca chegava ao ecra. O vao passa a viajar no fio, MARCADO e
// NOMEADO; NUNCA se inventa a barra que faltou nem se atravessa o vao em silencio.
//
// O PASSO mede-se do PROPRIO dado (a diferenca mais frequente entre velas consecutivas), e nao de um mapa do
// relogio repetido aqui: uma segunda conta do relogio divergiria da primeira. Sem passo legivel, nao se inventa
// vao nenhum (devolve []).

export type Buraco = { de: number; ate: number; faltam: number };

export function buracosDeHistorico(velas: any[]): Buraco[] {
  const difs = new Map<number, number>();
  for (let i = 1; i < velas.length; i++) {
    const d = Number(velas[i]?.t) - Number(velas[i - 1]?.t);
    if (Number.isFinite(d) && d > 0) difs.set(d, (difs.get(d) ?? 0) + 1);
  }
  if (difs.size === 0) return [];
  // O PASSO e' a diferenca mais FREQUENTE (o relogio normal); empate resolve-se pelo menor passo.
  let passo = 0, venceu = -1;
  for (const [d, n] of difs) if (n > venceu || (n === venceu && d < passo)) { passo = d; venceu = n; }
  const buracos: Buraco[] = [];
  for (let i = 1; i < velas.length; i++) {
    const d = Number(velas[i]?.t) - Number(velas[i - 1]?.t);
    if (d > passo) buracos.push({ de: Number(velas[i - 1].t), ate: Number(velas[i].t), faltam: Math.round(d / passo) - 1 });
  }
  return buracos;
}
