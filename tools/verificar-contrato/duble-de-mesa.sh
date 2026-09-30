#!/usr/bin/env bash
# O duble de mesa (US6 / T051-T054, SC-004, SC-008): a mesa DE MENTIRA virada a um plugin.
#
#   bash tools/verificar-contrato/duble-de-mesa.sh
#
# Mede quatro coisas, e cada uma e precisa por si:
#   1. os casos declarados, no papel `setup`    — o duble confere a proposta;
#   2. os casos declarados, no papel `conector` — o duble confere o desfecho (as quatro classificacoes);
#   3. os MESMOS casos contra os mocks de verdade do recorte 001 (FR-031: estendidos, nao substituidos);
#   4. a FIDELIDADE (SC-004): os mesmos casos contra o MOTOR DO CONTRATO, nas DUAS linguagens. Uma
#      divergencia entre o duble e o motor e defeito de um dos dois, e sai como FALHA - foi assim que
#      apareceu a primeira: o duble dizia `aceita` e o motor diz `aceite`.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
falhas=0

correr() { # nome, comando
  local nome="$1"; shift
  local saida
  saida="$("$@" 2>&1)" || { printf 'FALHOU  %-46s %s\n' "$nome" "$(printf '%s' "$saida" | tail -2 | tr '\n' ' ')"; falhas=$((falhas + 1)); return; }
  printf 'ok      %-46s %s\n' "$nome" "$(printf '%s' "$saida" | tail -1)"
}

cd "$RAIZ/contracts"

correr "duble/setup (casos declarados)"     uv run python mocks/mesa/main.py --papel setup --casos setup.casos.json
correr "duble/conector (casos declarados)"  uv run python mocks/mesa/main.py --papel conector --casos conector.casos.json

# 3. contra os mocks de verdade: o duble fala com o plugin a serio, pelo cano dele.
correr "duble/setup x mock de setup (001)" \
  uv run python mocks/mesa/main.py --papel setup --casos setup.casos.json \
  --plugin "bun run contracts/mocks/setup/main.ts --barra 1730001600000 --lado buy"
correr "duble/conector x mock de conector (001)" \
  uv run python mocks/mesa/main.py --papel conector --casos conector.casos.json \
  --plugin "uv run python contracts/mocks/conector/main.py"

# 4. a fidelidade: os mesmos casos contra o motor do contrato, nas duas linguagens.
correr "fidelidade/setup (SC-004)"     uv run python mocks/mesa/main.py --papel setup    --casos setup.casos.json    --fidelidade
correr "fidelidade/conector (SC-004)"  uv run python mocks/mesa/main.py --papel conector --casos conector.casos.json --fidelidade

# 5. o duble escreve-se DO CONTRATO: nenhum `import` do core dentro dele (RN-E17, RN-E24). Um duble copiado
#    do core prova compatibilidade com a nossa implementacao, e esconde o defeito dos dois lados ao mesmo tempo.
if grep -rnE '^[[:space:]]*(from|import)[[:space:]].*core' contracts/mocks/mesa/*.py >/dev/null 2>&1; then
  printf 'FALHOU  %-46s %s\n' "duble/lido do contrato (RN-E17)" "ha um import do core no duble"
  falhas=$((falhas + 1))
else
  printf 'ok      %-46s %s\n' "duble/lido do contrato (RN-E17)" "nenhum import do core; os motivos vem dos esquemas"
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "duble de mesa: 0 falhas — os casos declarados, contra os mocks do 001 e contra o motor do contrato"
  exit 0
fi
echo "duble de mesa: $falhas falhas"
exit 1
