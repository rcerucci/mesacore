#!/usr/bin/env bash
# O reinicio: marcar, reiniciar, reencontrar (SC-006).
#
#   tools/verificar-contrato/reinicio.sh
#
# O cenario, medido:
#   1. limpa o venue simulado
#   2. manda uma boleta a serio -> o venue guarda a ordem COM a marca
#   3. semeia no venue uma posicao que NAO e da mesa
#   4. "reinicia" a mesa (que nao guarda estado nenhum) e le as posicoes DO VENUE
#   5. confere: a nossa e reencontrada pela marca; a outra e relatada como alheia e NAO e gerida
#
# Sai com 1 se a marca nao reencontrar o que e nosso, ou se a posicao alheia for dada como gerida.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts/mocks/conector"

MARCA=1694498816          # ficha 3232, ciclo 0 — composta pelo layout declarado no vocabulario
BOLETA='{"contrato":"1.3.0","tipo":"boleta","id":"reinicio-b1","carga":{"instrumento":"EURUSD","lado":"buy","tipo":"mercado","saldo_pct":"2","alavancagem":"1","parcial":"o_que_der","desvio_maximo":"0.1","prazo_da_passiva_ms":3000,"destino_do_resto":"agressivo","reduce_only":false,"referencia_do_cliente":"r-reinicio-1","marca_de_posse":1694498816}}'

falhas=0
conferir() { # nome, condicao, detalhe
  if [ "$2" = "1" ]; then
    printf 'ok      %-46s %s\n' "$1" "$3"
  else
    printf 'FALHOU  %-46s %s\n' "$1" "$3"
    falhas=$((falhas + 1))
  fi
}

uv run python -c "
import sys; sys.path.insert(0, '.')
import venue; venue.limpar()
print('venue limpo')"

echo "== 1. a mesa manda uma boleta (a marca vai na ordem) =="
printf '%s\n' "$BOLETA" | uv run python main.py >/dev/null 2>&1
ordens=$(python3 -c "
import sys; sys.path.insert(0, '.')
import venue, json
estado = json.loads(venue.ESTADO.read_text())
print(json.dumps(estado['ordens'], ensure_ascii=False))")
conferir "a ordem ficou no venue com a forma declarada" "$(printf '%s' "$ordens" | grep -qE '"comment": *1694498816' && echo 1 || echo 0)" "$(printf '%s' "$ordens" | head -c 160)"

echo
echo "== 2. o dono abre uma posicao a mao nesta conta (nao e da mesa) =="
uv run python posicoes.py --semear-alheia 2>/dev/null

echo
echo "== 3. reinicio: a mesa nao guarda estado nenhum, e le tudo do venue =="
saida=$(uv run python posicoes.py --reiniciar --instrumento EURUSD --marca "$MARCA" 2>/dev/null)
printf '%s\n' "$saida"

nossa=$(printf '%s\n' "$saida" | grep -c "\"marca_de_posse\":$MARCA" || true)
conferir "a posicao com a nossa marca foi reencontrada" "$([ "$nossa" -ge 1 ] && echo 1 || echo 0)" "linhas com a marca $MARCA: $nossa"
gerida=$(printf '%s\n' "$saida" | grep -c '"gerida":true' || true)
conferir "exactamente uma posicao e gerida" "$([ "$gerida" -eq 1 ] && echo 1 || echo 0)" "geridas: $gerida"
alheia=$(printf '%s\n' "$saida" | grep -c '"posse":"alheia","gerida":false' || true)
conferir "a posicao sem a marca e alheia e NAO gerida" "$([ "$alheia" -ge 1 ] && echo 1 || echo 0)" "alheias nao geridas: $alheia"

echo
echo "== 4. nenhuma ordem de fecho saiu por iniciativa da mesa =="
final=$(python3 -c "
import sys; sys.path.insert(0, '.')
import venue, json
estado = json.loads(venue.ESTADO.read_text())
print(len(estado['ordens']))")
conferir "o venue tem 1 ordem (a da mesa), nao mais" "$([ "$final" -eq 1 ] && echo 1 || echo 0)" "ordens no venue: $final"
conferir "a posicao alheia continua no venue, intacta" "$(python3 -c "
import sys; sys.path.insert(0, '.')
import venue, json
estado = json.loads(venue.ESTADO.read_text())
print(1 if len(estado['posicoes_alheias']) == 1 else 0)")" "posicoes alheias: 1"

echo
if [ "$falhas" -eq 0 ]; then
  echo "reinicio: 0 falhas — a posse le-se do venue, pela marca"
  exit 0
fi
echo "reinicio: $falhas falhas"
exit 1
