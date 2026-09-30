#!/usr/bin/env bash
# O TIPO CONFERE: `tsc` sobre o produto e as bancadas.
#
# Existe por uma medicao, e nao por gosto: `bun` corre TypeScript SEM conferir tipos, e um campo escrito com
# a letra trocada (`caminhoDoRegistro` contra `caminhoDoRegisto`) passa a correr e rebenta em execucao - foi
# o que aconteceu, e custou uma corrida. Na mesma sessao, o `tsc` apanhou duas coisas que nenhuma bancada
# apanhou: o `baseUrl` removido no tsc 7 e uma bancada do recorte 002 que deixou de receber os conectores.
#
# Corre por DIRECTORIO, e nao de uma vez: `tools/` nao importa `vigia/` (a bancada do vigia corre-o como
# PROCESSO, que e o que esta em causa), e um `tsc` so sobre `tools/` nao olharia para dentro do vigia.
#
# Nao substitui bancada nenhuma: isto mede FORMA. Quem mede COMPORTAMENTO sao elas, e as duas sao precisas.

set -u
cd "$(dirname "$0")/../.." || exit 1

TSC="$PWD/tools/node_modules/.bin/tsc"  # pinado no lockfile: a porta corre sem rede
falhas=0
conferidos=0

for dir in core vigia tools contracts brokers setups; do
  if [ ! -f "$dir/tsconfig.json" ]; then
    # Um directorio LISTADO sem tsconfig e uma porta que se salta em silencio: o `tsc` nao confere nada e
    # a contagem final nao o acusa. Era assim que `brokers/` ficava de fora — o conector nunca passou por
    # um portao de tipos. Falha, em vez de seguir.
    falhas=$((falhas + 1))
    printf '  %s: ERRO — directorio listado e SEM tsconfig.json (o portao nao o confere)\n' "$dir"
    continue
  fi
  if (cd "$dir" && "$TSC" -p tsconfig.json --noEmit > /tmp/tipos-$dir.txt 2>&1); then
    conferidos=$((conferidos + 1))
    printf '  %s: 0 erros de tipo\n' "$dir"
  else
    falhas=$((falhas + 1))
    printf '  %s: ERROS de tipo:\n' "$dir"
    sed 's/^/    /' /tmp/tipos-$dir.txt | head -12
  fi
done

if [ "$falhas" -eq 0 ]; then
  printf 'tipos: 0 erros em %s directorios (o tsc confere o produto e as bancadas)\n' "$conferidos"
  exit 0
fi
printf 'tipos: %s directorio(s) com erros\n' "$falhas"
exit 1
