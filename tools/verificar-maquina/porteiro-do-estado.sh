#!/usr/bin/env bash
# O porteiro do estado, em forma de comando (é assim que o quickstart o chama).
#
# Corre a conferência e a prova negativa. Saída 1 se alguma coisa passar que não devia.
set -euo pipefail
cd "$(dirname "$0")/../.."

bun run tools/verificar-maquina/porteiro-do-estado.ts --prova-negativa
