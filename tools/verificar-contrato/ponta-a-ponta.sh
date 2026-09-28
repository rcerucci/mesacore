#!/usr/bin/env bash
# Prova de ponta-a-ponta das duas fronteiras, sem corretora e sem chave.
#
#   tools/verificar-contrato/ponta-a-ponta.sh
#
# Escreve no fim o que mediu. Sai com 1 se alguma linha enviada por uma ponta for recusada
# pelo contrato — uma ponta que fala fora do contrato e um defeito, nao uma libertacao.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts"

MERCADO_ABERTO='{"contrato":"1.0.0","tipo":"mercado","id":"e2e-m1","carga":{"instrumento":"EURUSD","tempo_do_venue_ms":1759000000000,"idade_do_dado_ms":95,"estado":"aberto","bid":"1.08541","ask":"1.08543","ultimo":"1.08542","equity":"1000.00"}}'
MERCADO_FECHADO='{"contrato":"1.0.0","tipo":"mercado","id":"e2e-m2","carga":{"instrumento":"EURUSD","tempo_do_venue_ms":1759000000000,"idade_do_dado_ms":300,"estado":"fechado","equity":"1000.00"}}'
BOLETA='{"contrato":"1.0.0","tipo":"boleta","id":"e2e-b1","carga":{"instrumento":"EURUSD","lado":"buy","tipo":"mercado","saldo_pct":"2","alavancagem":"1","parcial":"o_que_der","desvio_maximo":"0.1","prazo_da_passiva_ms":3000,"destino_do_resto":"agressivo","reduce_only":false,"referencia_do_cliente":"r-e2e-1","marca_de_posse":1694498816}}'
BOLETA_ICEBERG="${BOLETA/\"tipo\":\"mercado\"/\"tipo\":\"iceberg\"}"
# Banda pequena: 0,5% do saldo. A quantidade que cabe e menor que o minimo do instrumento,
# e o conector tem de RECUSAR — nao de arredondar para cima.
BOLETA_BANDA_PEQUENA="${BOLETA/\"saldo_pct\":\"2\"/\"saldo_pct\":\"0.5\"}"

falhas=0

verificar() { # nome, mensagem, veredicto_esperado, motivo_esperado
  local nome="$1" mensagem="$2" veredicto="$3" motivo="$4"
  local saida
  saida="$(printf '%s\n' "$mensagem" | uv run python esqueleto/validar_linha.py 2>/dev/null | tail -1)"
  local obtido_v obtido_m
  obtido_v="$(printf '%s' "$saida" | sed -E 's/.*"veredicto":"([^"]*)".*/\1/')"
  obtido_m="$(printf '%s' "$saida" | sed -E 's/.*"motivo":(null|"[^"]*").*/\1/')"
  local esperado_m="null"; [ "$motivo" != "-" ] && esperado_m="\"$motivo\""
  if [ "$obtido_v" = "$veredicto" ] && [ "$obtido_m" = "$esperado_m" ]; then
    printf 'ok      %-42s %s %s\n' "$nome" "$obtido_v" "$obtido_m"
  else
    printf 'FALHOU  %-42s obtive %s %s, esperava %s %s\n' "$nome" "$obtido_v" "$obtido_m" "$veredicto" "$esperado_m"
    falhas=$((falhas + 1))
  fi
}

echo "== setup (TypeScript) fala com a mesa =="
verificar "setup/mercado-aberto-propoe-buy" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --lado buy 2>/dev/null)" aceite -
verificar "setup/mercado-fechado-vai-para-caixa" "$(printf '%s\n' "$MERCADO_FECHADO" | bun run mocks/setup/main.ts --lado buy 2>/dev/null)" aceite -
verificar "setup/invalido-limpar-e-recusado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --invalido limpar 2>/dev/null)" recusado valor_fora_do_conjunto
verificar "setup/invalido-vazio-e-recusado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --invalido vazio 2>/dev/null)" recusado campo_obrigatorio_ausente
verificar "setup/invalido-numero-e-recusado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --invalido numero 2>/dev/null)" recusado tipo_invalido

echo
echo "== conector (Python) fala com a mesa =="
saida_conector="$(printf '%s\n' "$BOLETA" | uv run python mocks/conector/main.py 2>/dev/null)"
verificar "conector/resolucao-antes-de-executar" "$(printf '%s\n' "$saida_conector" | head -1)" aceite -
verificar "conector/desfecho-aceite" "$(printf '%s\n' "$saida_conector" | tail -1)" aceite -
verificar "conector/capacidade-nao-declarada" "$(printf '%s\n' "$BOLETA_ICEBERG" | uv run python mocks/conector/main.py 2>/dev/null | tail -1)" aceite -
verificar "conector/recusa-por-minimo-do-instrumento" "$(printf '%s\n' "$BOLETA_BANDA_PEQUENA" | uv run python mocks/conector/main.py --preco 900 2>/dev/null | tail -1)" aceite -
verificar "conector/silencio-nao-inventa-desfecho" "$(printf '%s\n' "$BOLETA" | uv run python mocks/conector/main.py --silencioso 2>/dev/null | tail -1)" aceite -

echo
echo "== o que o conector recusou, e por que =="
printf '%s\n' "$BOLETA_BANDA_PEQUENA" | uv run python mocks/conector/main.py --preco 900 2>/dev/null | tail -1
printf '%s\n' "$BOLETA" | uv run python mocks/conector/main.py --silencioso 2>/dev/null | wc -l | sed 's/^/linhas com --silencioso: /'

echo
if [ "$falhas" -eq 0 ]; then
  echo "ponta-a-ponta: 0 falhas — as duas pontas falam o contrato"
  exit 0
fi
echo "ponta-a-ponta: $falhas falhas"
exit 1
