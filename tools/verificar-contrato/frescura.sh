#!/usr/bin/env bash
# Teste de frescura do codigo gerado (D8).
#
#   tools/verificar-contrato/frescura.sh
#
# Regenera tudo a partir dos schemas e compara com o que esta versionado. Diferenca = alguem
# editou o gerado a mao, ou mudou o schema sem regenerar. Nos dois casos o repositorio esta a
# mentir sobre o que o contrato diz, e a saida e 1.
# Se a PROPRIA geracao falhar, isto NAO devolve "0 divergencias": uma geracao falhada nao pode
# dar verde (foi assim que a primeira versao deste script passou com 4 de 8 ficheiros).
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts"

ANTES="$(mktemp -d)"
trap 'rm -rf "$ANTES"' EXIT
cp -r gerado "$ANTES/gerado"

if ! bash "$RAIZ/tools/verificar-contrato/gerar.sh" >"$ANTES/geracao.txt" 2>&1; then
  echo "frescura: a GERACAO falhou — nao ha como comparar. Saida do gerador:"
  tail -20 "$ANTES/geracao.txt"
  exit 2
fi

if diff -r "$ANTES/gerado" gerado >"$ANTES/diff.txt" 2>&1; then
  ficheiros=$(find gerado -type f | wc -l)
  echo "frescura: 0 divergencias — o gerado corresponde aos schemas ($ficheiros ficheiros)"
  exit 0
fi

echo "frescura: o gerado NAO corresponde aos schemas"
head -40 "$ANTES/diff.txt"
exit 1
