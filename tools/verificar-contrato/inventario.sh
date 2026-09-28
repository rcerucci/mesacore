#!/usr/bin/env bash
# O inventario confere — e o conferidor sabe reprovar (T054).
#
#   tools/verificar-contrato/inventario.sh
#
# Corre as duas coisas de que um instrumento se compoe: a medicao, e a prova de que a medicao sabe
# ficar vermelha. Um conferidor que nunca reprovou nao mediu nada ainda.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

falhas=0
if uv run python tools/verificar-contrato/py/inventario.py; then
  :
else
  falhas=$((falhas + 1))
fi

echo
if uv run python tools/verificar-contrato/py/prova-negativa-inventario.py; then
  :
else
  falhas=$((falhas + 1))
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "inventario: 0 falhas — toda grandeza tem dono, e o conferidor reprova quando falta"
  exit 0
fi
echo "inventario: $falhas falhas"
exit 1
