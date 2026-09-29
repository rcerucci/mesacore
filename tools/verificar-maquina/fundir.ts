// A fusao de um caso sobre o padrao: o que a mudanca diz sobrepoe-se, o resto fica.
//
// Vive num modulo proprio por uma razao que se aprendeu a bater com ela: `arranque.ts` e `vigia.ts` sao
// BANCADAS - correm ao serem carregadas -, e importar-lhes uma funcao corre a bancada inteira, a meio da
// outra. Uma funcao partilhada tem de viver fora de quem tem efeitos ao carregar.

export function fundir(base: any, mudanca: any): any {
  const saida: any = { ...(base ?? {}) };
  if (mudanca === undefined || mudanca === null) return saida;
  for (const [k, v] of Object.entries(mudanca)) {
    saida[k] = v !== null && typeof v === "object" && !Array.isArray(v) && typeof saida[k] === "object"
      ? fundir(saida[k] ?? {}, v)
      : v;
  }
  return saida;
}
