#!/usr/bin/env bash
# A conferencia da fronteira vigia<->mesa (SC-003), e a prova de que ela sabe reprovar (T046/T048/T049).
#
#   tools/verificar-contrato/fronteira.sh
#
# Duas coisas de que um instrumento se compoe: a medicao, e a prova de que a medicao fica vermelha. Um
# conferidor que nunca reprovou nao mediu nada ainda.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

falhas=0
uv run python tools/verificar-contrato/py/fronteira.py || falhas=$((falhas + 1))

echo
uv run python tools/verificar-contrato/py/prova-negativa-fronteira.py || falhas=$((falhas + 1))

echo
if [ "$falhas" -eq 0 ]; then
  echo "fronteira: 0 falhas — os motivos fecham nas duas direcoes, todo o campo tem leitor, e os casos somam"
  exit 0
fi
echo "fronteira: $falhas falhas"
exit 1
