#!/usr/bin/env bash
# O SISTEMA EM OBSERVACAO — a mesa e o operador a correr sozinhos, por horas, na conta de TESTE.
#
# O QUE ISTO FAZ, sem arredondar:
#   * o OPERADOR lê as fichas ligadas da conta (`fichas/<setup>/<par>-<conta>.json` com `run: true`), puxa as
#     velas no relógio de cada ficha, arranca o conector ao vivo, corre o SETUP e escreve a OPERACAO;
#   * a MESA lê a operação a cada volta e DECIDE (registo);
#   * tudo o que ambos dizem vai para ficheiros de log e para o REGISTO.
#
# O QUE ISTO NÃO FAZ — e é a razão de ser dito aqui, em cima, sem prometer o que nao cumpre:
#   ** quem trava (ou nao) o envio ao venue e' a FICHA, e so' ela. ** Uma ficha com `enviar: true` faz o
#   carteiro ENTREGAR a boleta ao conector e o conector manda-a ao venue; uma ficha com `enviar: false` faz o
#   carteiro registar que NAO a enviou. Isto e' OPERACAO EM OBSERVACAO NESSE SENTIDO: a mesa e o setup correm
#   com numeros reais e a decisao e' tomada a serio — mas o que sai para o venue depende das fichas ARMADAS.
#   (O cabecalho anterior dizia «nenhuma ficha do repositorio diz enviar:true» e era FALSO desde que o dono
#   armou o ETH/BTC/SOL a 02/10/2026 — medido no arranque de primeira vez, 04/10/2026. Uma promessa errada num
#   lancador e' pior do que nenhuma: por isso este script CALCULA e DIZ quais estao armadas, antes de arrancar.)
#
# E O ARRANQUE NAO CAlA: antes de levantar o operador, diz o que FALTA — a conta, a credencial, as fichas
# ligadas — e conta as fichas ARMADAS ao venue. Assim uma primeira execucao que nao sobe diz PORQUE, em vez de
# deixar o dono a adivinhar.
#
# Uso:  bash tools/operar-em-observacao.sh <conta> [par]
# Parar: o ficheiro de PID que este script escreve (`<dir>/operacao-em-observacao.pid`) — `kill $(cat ...)`.

set -uo pipefail
CONTA="${1:-hl-teste-plugin}"
PAR="${2:-}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${DIR_DE_OBSERVACAO:-/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/observacao}"
cd "$RAIZ" || exit 1

# ================================ O QUE FALTA, DITO ANTES DE ARRANCAR ==================================
# A VERIFICACAO VIVE NUM COMANDO PROPRIO (`tools/checar-o-arranque.sh`): o mesmo que a bancada prova. Ele diz o
# que falta (a conta, a credencial, as fichas ligadas) e conta as fichas ARMADAS ao venue — e nao abre o valor
# da credencial, so' confere que ela existe. Se faltar algo, NAO se arranca processo nenhum.
if ! bash "$RAIZ/tools/checar-o-arranque.sh" "$CONTA" "$PAR"; then
  echo
  echo "operacao em observacao: NAO arrancou — resolva o que FALTA acima."
  exit 1
fi
echo

# ========================================= O ARRANQUE ==================================================
mkdir -p "$DIR"

echo "$$" > "$DIR/operacao-em-observacao.pid"
: > "$DIR/operador.log"
: > "$DIR/mesa.log"

# A VERSAO DO CONTRATO le'-se do ficheiro, NUNCA se escreve aqui a mao: o `start` carimbava 1.7.0 e a mesa
# recusou-o com `versao_do_contrato_divergente` depois das emendas de 30/09/2026 (1.8.0 e 1.9.0) — a porta fez o
# que devia, e o defeito era do script. Uma versao escrita a mao num script envelhece sozinha.
OP="$DIR/operacao.json"
echo "[$(date -Iseconds)] a arrancar: conta=$CONTA par=${PAR:-todos os ligados} dir=$DIR"

# the operator: writes the operation every turn; the connector streams the readings.
# A VOLTA E' DE 1 s (padrao do proprio operador desde 02/10/2026, e o que o dono pediu): com 60 s, uma proposta
# do ETH a 1 m era vista pela mesa quase um minuto depois do fecho da barra, e 2 propostas perderam-se por
# `proposta_de_barra_antiga`. O que NAO herda este numero e' a leitura do VENUE (`--leitura-a-cada`, 10 s por
# omissao): foi medido que ler no ritmo da volta da' `429 Too Many Requests` (253 em menos de dois minutos).
( cd "$RAIZ" && exec bun run vigia/operador.ts --conta "$CONTA" ${PAR:+--par "$PAR"} \
    --para "$OP" --tick 1000 --voltas 100000 \
    --mercado "$DIR/mercado" --dias 21 ) >> "$DIR/operador.log" 2>&1 &
OPERADOR_PID=$!

# wait for the first operation (the connector's arranque takes ~30-60 s before the first reading)
for _ in $(seq 1 60); do
  [ -f "$OP" ] && break
  kill -0 "$OPERADOR_PID" 2>/dev/null || break   # o operador morreu: nao se espera por um morto
  sleep 5
done
if [ ! -f "$OP" ]; then
  echo "[$(date -Iseconds)] a operacao nao apareceu: o conector nao entregou leitura. o que ele disse:" >> "$DIR/mesa.log"
  tail -n 8 "$DIR/operador.log" | sed 's/^/    /' >> "$DIR/mesa.log"
  echo "operacao em observacao: NAO subiu — o operador nao escreveu a operacao (conector sem leitura ou credencial recusada)."
  echo "o que ele disse (fim do operador.log):"
  tail -n 8 "$DIR/operador.log" | sed 's/^/    /'
  kill "$OPERADOR_PID" 2>/dev/null
  exit 1
fi
echo "[$(date -Iseconds)] operacao escrita: $OP" >> "$DIR/mesa.log"

# the mesa: receives `start` (with the ports the operator collected) and keeps its clock beating.
# O stdin fica ABERTO (`sleep`) porque o processo acaba no fim da entrada — e o relogio morre com ele.
( cd "$RAIZ" && { printf '{"contrato":"%s","tipo":"comando","id":"observacao-1","carga":{"verbo":"start","autor":"observacao","pedido_id":"observacao-1"}}\n' "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contrato"])' "$RAIZ/contracts/versao.json")"; sleep 100000; } \
    | bun run core/servidor.ts --tick 60000 --operacao "$OP" --config "$OP.config.json" \
        --portas "$OP.portas.json" --registo "$DIR/registo.jsonl" ) >> "$DIR/mesa.log" 2>&1 &
MESA_PID=$!
echo "$MESA_PID" >> "$DIR/operacao-em-observacao.pid"

echo "operacao em observacao: NO AR — operador pid=$OPERADOR_PID · mesa pid=$MESA_PID · operacao=$OP"
echo "para parar:  kill \$(cat $DIR/operacao-em-observacao.pid)"

wait "$OPERADOR_PID" "$MESA_PID"
echo "[$(date -Iseconds)] fim" >> "$DIR/operador.log"
