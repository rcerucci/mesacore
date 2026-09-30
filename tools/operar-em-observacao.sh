#!/usr/bin/env bash
# O SISTEMA EM OBSERVAÇÃO — a mesa e o operador a correr sozinhos, por horas, na conta de TESTE.
#
# O QUE ISTO FAZ, sem arredondar:
#   * o OPERADOR lê as fichas ligadas da conta (`fichas/<setup>/<par>-<conta>.json` com `run: true`), puxa as
#     velas no relógio de cada ficha, arranca o conector ao vivo, corre o SETUP e escreve a OPERAÇÃO;
#   * a MESA lê a operação a cada volta e DECIDE (registo);
#   * tudo o que ambos dizem vai para ficheiros de log e para o REGISTO.
#
# O QUE ISTO NÃO FAZ — e é a razão de ser dito aqui, em cima:
#   ** nenhuma ordem sai para o venue. ** A decisão é tomada e registada; a boleta não é enviada, porque o
#   caminho mesa -> conector (a mão que aperta o gatilho) ainda não está fechado, e um gatilho a meio não se
#   improvisa: foi assim que se encheu uma posição de ~400x o equity na testnet (P16, 29/09).
#   Isto é OPERAÇÃO EM OBSERVAÇÃO: junta o que o sistema decidiria, com números reais, sem risco.
#
# Uso:  bash tools/operar-em-observacao.sh <conta> [par]
# Parar: o ficheiro de PID que este script escreve (`<dir>/operacao-em-observacao.pid`) — `kill $(cat ...)`.

set -uo pipefail
CONTA="${1:-hl-teste-plugin}"
PAR="${2:-}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${DIR_DE_OBSERVACAO:-/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/observacao}"
mkdir -p "$DIR"

echo "$$" > "$DIR/operacao-em-observacao.pid"
: > "$DIR/operador.log"
: > "$DIR/mesa.log"

OP="$DIR/operacao.json"
echo "[$(date -Iseconds)] a arrancar: conta=$CONTA par=${PAR:-todos os ligados} dir=$DIR"

# the operator: writes the operation every turn; the connector streams the readings.
( cd "$RAIZ" && exec bun run vigia/operador.ts --conta "$CONTA" ${PAR:+--par "$PAR"} \
    --para "$OP" --tick 60000 --voltas 100000 \
    --mercado "$DIR/mercado" --dias 21 ) >> "$DIR/operador.log" 2>&1 &
OPERADOR_PID=$!

# wait for the first operation (the connector's arranque takes ~30-60 s before the first reading)
for _ in $(seq 1 60); do
  [ -f "$OP" ] && break
  sleep 5
done
if [ ! -f "$OP" ]; then
  echo "[$(date -Iseconds)] a operacao nao apareceu: o conector nao entregou leitura. nada a decidir." >> "$DIR/mesa.log"
  kill "$OPERADOR_PID" 2>/dev/null
  exit 1
fi
echo "[$(date -Iseconds)] operacao escrita: $OP" >> "$DIR/mesa.log"

# the mesa: receives `start` (with the ports the operator collected) and keeps its clock beating.
# O stdin fica ABERTO (`sleep`) porque o processo acaba no fim da entrada — e o relogio morre com ele.
( cd "$RAIZ" && { echo '{"contrato":"1.7.0","tipo":"comando","id":"observacao-1","carga":{"verbo":"start","autor":"observacao","pedido_id":"observacao-1"}}'; sleep 100000; } \
    | bun run core/servidor.ts --tick 60000 --operacao "$OP" --config "$OP.config.json" \
        --portas "$OP.portas.json" --registo "$DIR/registo.jsonl" ) >> "$DIR/mesa.log" 2>&1 &
MESA_PID=$!
echo "$MESA_PID" >> "$DIR/operacao-em-observacao.pid"

wait "$OPERADOR_PID" "$MESA_PID"
echo "[$(date -Iseconds)] fim" >> "$DIR/operador.log"
