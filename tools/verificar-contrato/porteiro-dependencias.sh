#!/usr/bin/env bash
# Porteiro de dependencias (Principio VII; RN-E1).
#
#   tools/verificar-contrato/porteiro-dependencias.sh
#
# O contrato nao pode depender de quem o cumpre. Se um ficheiro de /contracts importar de
# core/, setups/ ou brokers/, o contrato deixou de ser neutro: passou a ser um detalhe de uma
# das pontas. Os mocks FICAM DE FORA da regra — e o trabalho deles falar com o mundo.
#
# Sai com 1 se encontrar uma dependencia proibida.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

proibidos='(^|[^a-z])(core|setups|brokers)/'
violacoes=0

while IFS= read -r ficheiro; do
  # os mocks sao a excepcao declarada: existem para falar com o mundo
  case "$ficheiro" in
    contracts/mocks/*) continue ;;
  esac
  if grep -nE "(from|import|require\()" "$ficheiro" | grep -qE "$proibidos"; then
    echo "DEPENDENCIA PROIBIDA em $ficheiro:"
    grep -nE "(from|import|require\()" "$ficheiro" | grep -E "$proibidos" | sed 's/^/  /'
    violacoes=$((violacoes + 1))
  fi
done < <(find contracts -type d \( -name node_modules -o -name .venv -o -name __pycache__ \) -prune -o -type f \( -name '*.ts' -o -name '*.py' \) -print | sort)

medidos=$(find contracts -type d \( -name node_modules -o -name .venv -o -name __pycache__ \) -prune -o -type f \( -name '*.ts' -o -name '*.py' \) -print | wc -l)
if [ "$violacoes" -eq 0 ]; then
  echo "porteiro: 0 dependencias proibidas em $medidos ficheiros de /contracts (os mocks contam a parte)"
  exit 0
fi
echo "porteiro: $violacoes ficheiros com dependencia proibida"
exit 1
