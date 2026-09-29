#!/usr/bin/env bash
# Reenvio com a mesma referencia nao cria segunda ordem (SC-008).
#
#   tools/verificar-contrato/reenvio.sh
#
# Mede os dois lados da regra:
#   A. a DECISAO da mesa (bun run esqueleto/referencia.ts): quando reenviar, quando reconciliar;
#   B. o VENUE: reenviar a mesma referencia devolve a ordem que ja la esta, e nao abre outra;
#      uma referencia DIFERENTE abre ordem nova (senao este teste passava por nao fazer nada).
#
# Sai com 1 se o venue ficar com duas ordens para a mesma referencia.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts"

# A versao do contrato NAO se escreve aqui: LE-SE de contracts/versao.json. Escrita a mao, esta boleta
# envelheceria em silencio na proxima emenda — e o reenvio passaria a medir uma recusa por versao.
CONTRATO="$(jq -r .contrato "$RAIZ/contracts/versao.json")"

base='{"contrato":"'"$CONTRATO"'","tipo":"boleta","id":"reenvio-b1","carga":{"instrumento":"EURUSD","lado":"buy","tipo":"mercado","saldo_pct":"2","alavancagem":"1","parcial":"o_que_der","desvio_maximo":"0.1","prazo_da_passiva_ms":3000,"destino_do_resto":"agressivo","reduce_only":false,"referencia_do_cliente":"REF-UNICA","marca_de_posse":1694498816}}'
outra="${base/REF-UNICA/REF-DIFERENTE}"
outra="${outra/reenvio-b1/reenvio-b2}"

falhas=0
conferir() {
  if [ "$2" = "1" ]; then printf 'ok      %-52s %s\n' "$1" "$3"; else printf 'FALHOU  %-52s %s\n' "$1" "$3"; falhas=$((falhas + 1)); fi
}

echo "== A. a decisao da mesa =="
bun run esqueleto/referencia.ts
[ $? -eq 0 ] && conferir "a bateria de decisoes passa" 1 "10 verificacoes" || conferir "a bateria de decisoes passa" 0 "ver acima"

echo
echo "== B. o venue, com o manifesto a declarar idempotencia =="
cd mocks/conector
uv run python -c "
import sys; sys.path.insert(0, '.')
import venue; venue.limpar()" >/dev/null

primeira=$(printf '%s\n' "$base" | uv run python main.py 2>/dev/null | tail -1)
segunda=$(printf '%s\n' "$base" | uv run python main.py 2>/dev/null | tail -1)
terceira=$(printf '%s\n' "$outra" | uv run python main.py 2>/dev/null | tail -1)

ordens=$(python3 -c "
import sys, json; sys.path.insert(0, '.')
import venue
print(len(json.loads(venue.ESTADO.read_text())['ordens']))")

id1=$(printf '%s' "$primeira" | python3 -c "import json,sys; print(json.load(sys.stdin)['carga']['resposta_do_venue']['order_id'])")
id2=$(printf '%s' "$segunda" | python3 -c "import json,sys; print(json.load(sys.stdin)['carga']['resposta_do_venue']['order_id'])")
dup=$(printf '%s' "$segunda" | python3 -c "import json,sys; print(json.load(sys.stdin)['carga']['resposta_do_venue'].get('duplicado', False))")

conferir "primeira referencia: ordem criada" "$(printf '%s' "$primeira" | grep -q '\"classificacao\":\"aceite\"' && echo 1 || echo 0)" "order_id $id1"
conferir "reenvio da MESMA referencia devolve a mesma ordem" "$([ "$id1" = "$id2" ] && echo 1 || echo 0)" "$id1 = $id2"
conferir "e o venue diz que foi duplicado, em vez de o esconder" "$([ "$dup" = "True" ] && echo 1 || echo 0)" "duplicado=$dup"
conferir "referencia DIFERENTE abre ordem nova" "$(printf '%s' "$terceira" | grep -q '\"classificacao\":\"aceite\"' && echo 1 || echo 0)" "$(printf '%s' "$terceira" | python3 -c "import json,sys; print(json.load(sys.stdin)['carga']['resposta_do_venue']['order_id'])")"
conferir "o venue ficou com 2 ordens (e nao 3)" "$([ "$ordens" -eq 2 ] && echo 1 || echo 0)" "ordens no venue: $ordens"

echo
if [ "$falhas" -eq 0 ]; then
  echo "reenvio: 0 falhas — a mesma referencia nao produz segunda ordem"
  exit 0
fi
echo "reenvio: $falhas falhas"
exit 1
