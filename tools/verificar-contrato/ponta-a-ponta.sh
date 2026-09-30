#!/usr/bin/env bash
# Prova de ponta-a-ponta das duas fronteiras, sem corretora e sem chave.
#
#   tools/verificar-contrato/ponta-a-ponta.sh
#
# Mede duas coisas diferentes, e as duas sao precisas:
#   1. o que cada ponta ENVIA passa o contrato (nenhuma ponta fala fora do contrato);
#   2. o que cada ponta DECIDE e o que se esperava dela (recusar quando deve recusar, silenciar
#      quando deve silenciar). Sem (2), uma mensagem valida dava por bom um comportamento errado.
#
# O venue simulado comeca LIMPO: sem isto, uma ordem de uma corrida anterior responde por
# idempotencia e o caso da recusa passa sem recusar. Aconteceu — o verde era do estado, nao do
# codigo — e e por isso que a limpeza esta aqui, e nao no script do reenvio.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts"

# A versao do contrato NAO se escreve aqui: LE-SE de contracts/versao.json. Escrita a mao, estas mensagens
# envelheceriam em silencio na proxima emenda — e todas passariam a ser recusadas por
# `versao_do_contrato_divergente`, medindo o contrario do que dizem medir.
CONTRATO="$(jq -r .contrato "$RAIZ/contracts/versao.json")"

MERCADO_ABERTO='{"contrato":"'"$CONTRATO"'","tipo":"mercado","id":"e2e-m1","carga":{"instrumento":"EURUSD","tempo_do_venue_ms":1759000000000,"idade_do_dado_ms":95,"estado":"aberto","bid":"1.08541","ask":"1.08543","ultimo":"1.08542","equity":"1000.00"}}'
MERCADO_FECHADO='{"contrato":"'"$CONTRATO"'","tipo":"mercado","id":"e2e-m2","carga":{"instrumento":"EURUSD","tempo_do_venue_ms":1759000000000,"idade_do_dado_ms":300,"estado":"fechado","equity":"1000.00"}}'
BOLETA='{"contrato":"'"$CONTRATO"'","tipo":"boleta","id":"e2e-b1","carga":{"instrumento":"EURUSD","lado":"buy","tipo":"mercado","saldo_pct":"2","alavancagem":"1","parcial":"o_que_der","desvio_maximo":"0.1","prazo_da_passiva_ms":3000,"destino_do_resto":"agressivo","reduce_only":false,"referencia_do_cliente":"r-e2e-1","marca_de_posse":1694498816}}'
# Referencias proprias por caso: uma boleta que partilhasse a referencia com outra responderia por
# idempotencia, e o caso deixava de medir o que diz medir.
BOLETA_ICEBERG="${BOLETA/\"tipo\":\"mercado\"/\"tipo\":\"iceberg\"}"
BOLETA_ICEBERG="${BOLETA_ICEBERG/e2e-b1/e2e-b-iceberg}"
BOLETA_ICEBERG="${BOLETA_ICEBERG/r-e2e-1/r-e2e-iceberg}"
# Banda pequena: 0,5% do saldo. A quantidade que cabe e menor que o minimo do instrumento,
# e o conector tem de RECUSAR — nao de arredondar para cima.
BOLETA_BANDA_PEQUENA="${BOLETA/\"saldo_pct\":\"2\"/\"saldo_pct\":\"0.5\"}"
BOLETA_BANDA_PEQUENA="${BOLETA_BANDA_PEQUENA/e2e-b1/e2e-b-minimo}"
BOLETA_BANDA_PEQUENA="${BOLETA_BANDA_PEQUENA/r-e2e-1/r-e2e-minimo}"

falhas=0

# 1. a mensagem passa o contrato
verificar() { # nome, mensagem, veredicto_esperado, motivo_esperado
  local nome="$1" mensagem="$2" veredicto="$3" motivo="$4"
  local saida obtido_v obtido_m
  saida="$(printf '%s\n' "$mensagem" | uv run python esqueleto/validar_linha.py 2>/dev/null | tail -1)"
  obtido_v="$(printf '%s' "$saida" | sed -E 's/.*"veredicto":"([^"]*)".*/\1/')"
  obtido_m="$(printf '%s' "$saida" | sed -E 's/.*"motivo":(null|"[^"]*").*/\1/')"
  local esperado_m="null"; [ "$motivo" != "-" ] && esperado_m="\"$motivo\""
  if [ "$obtido_v" = "$veredicto" ] && [ "$obtido_m" = "$esperado_m" ]; then
    printf 'ok      %-46s %s %s\n' "$nome" "$obtido_v" "$obtido_m"
  else
    printf 'FALHOU  %-46s obtive %s %s, esperava %s %s\n' "$nome" "$obtido_v" "$obtido_m" "$veredicto" "$esperado_m"
    falhas=$((falhas + 1))
  fi
}

# 2. o que a ponta DECIDIU (na ultima mensagem que enviou)
decidiu() { # nome, saida_do_conector, classificacao_esperada, motivo_esperado
  local nome="$1" saida="$2" esperada="$3" motivo="$4"
  local ultima c m
  ultima="$(printf '%s' "$saida" | tail -1)"
  c="$(printf '%s' "$ultima" | python3 -c "
import json, sys
d = json.load(sys.stdin)['carga']
print(d.get('classificacao', ''))" 2>/dev/null)"
  m="$(printf '%s' "$ultima" | python3 -c "
import json, sys
d = json.load(sys.stdin)['carga']
print(d.get('motivo') or '-')" 2>/dev/null)"
  if [ "$c" = "$esperada" ] && [ "$m" = "$motivo" ]; then
    printf 'ok      %-46s %s %s\n' "$nome" "$c" "$m"
  else
    printf 'FALHOU  %-46s decidiu %s %s, esperava %s %s\n' "$nome" "$c" "$m" "$esperada" "$motivo"
    falhas=$((falhas + 1))
  fi
}

uv run python -c "
import sys; sys.path.insert(0, 'mocks/conector')
import venue; venue.limpar()" >/dev/null

echo "== setup (TypeScript) fala com a mesa =="
verificar "setup/mercado-aberto-propoe-lado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --barra 1730001600000 --lado buy 2>/dev/null)" aceite -
verificar "setup/mercado-fechado-vai-para-caixa" "$(printf '%s\n' "$MERCADO_FECHADO" | bun run mocks/setup/main.ts --barra 1730001600000 --lado buy 2>/dev/null)" aceite -
verificar "setup/invalido-limpar-e-recusado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --barra 1730001600000 --invalido limpar 2>/dev/null)" recusado valor_fora_do_conjunto
verificar "setup/invalido-vazio-e-recusado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --barra 1730001600000 --invalido vazio 2>/dev/null)" recusado campo_obrigatorio_ausente
verificar "setup/invalido-numero-e-recusado" "$(printf '%s\n' "$MERCADO_ABERTO" | bun run mocks/setup/main.ts --barra 1730001600000 --invalido numero 2>/dev/null)" recusado tipo_invalido

echo
echo "== conector (Python) fala com a mesa =="
saida_ok="$(printf '%s\n' "$BOLETA" | uv run python mocks/conector/main.py 2>/dev/null)"
verificar "conector/resolucao-antes-de-executar" "$(printf '%s\n' "$saida_ok" | head -1)" aceite -
verificar "conector/desfecho-aceite" "$(printf '%s\n' "$saida_ok" | tail -1)" aceite -
decidiu  "conector/executou-a-boleta-valida" "$saida_ok" aceite -
decidiu  "conector/recusa-tipo-nao-declarado" "$(printf '%s\n' "$BOLETA_ICEBERG" | uv run python mocks/conector/main.py 2>/dev/null)" recusado capacidade_nao_declarada
decidiu  "conector/recusa-por-minimo-do-instrumento" "$(printf '%s\n' "$BOLETA_BANDA_PEQUENA" | uv run python mocks/conector/main.py --preco 900 2>/dev/null)" recusado minimo_do_instrumento_acima_da_banda

echo
echo "== o que o conector recusou, com os numeros =="
printf '%s\n' "$BOLETA_BANDA_PEQUENA" | uv run python mocks/conector/main.py --preco 900 2>/dev/null | tail -1

echo
echo "== o silencio nao inventa desfecho (RN-T7.1) =="
linhas_silencio="$(printf '%s\n' "$BOLETA" | uv run python mocks/conector/main.py --silencioso 2>/dev/null | wc -l)"
if [ "$linhas_silencio" -eq 1 ]; then
  printf 'ok      %-46s %s\n' "conector/silencio-devolve-so-a-resolucao" "linhas: 1"
else
  printf 'FALHOU  %-46s linhas: %s (esperava 1)\n' "conector/silencio-devolve-so-a-resolucao" "$linhas_silencio"
  falhas=$((falhas + 1))
fi

echo
echo "== historico: o trilho do dinheiro e do VENUE (RN-D6) =="
# O venue ja tem a ordem da boleta acima. O historico le-se dele, e nao se reconstroi.
saida_historico="$(uv run python mocks/conector/historico.py --instrumento EURUSD 2>/dev/null)"
verificar "conector/historico-passa-o-contrato" "$saida_historico" aceite -
uv run python mocks/conector/historico.py --instrumento EURUSD 2>&1 >/dev/null | sed 's/^/        /'
if printf '%s' "$saida_historico" | uv run python -c "
import json, sys
carga = json.load(sys.stdin)['carga']
e = carga['execucoes'][0]
assert 'taxa' in e, 'taxa em campo proprio'
assert 'funding' in e, 'funding em campo proprio'
assert 'resultado_por_execucao' not in e, 'nao ha resultado por execucao (somar e do venue)'
assert 'resultado_realizado' in carga, 'o resultado e o numero do venue, por inteiro'
" 2>/dev/null; then
  printf 'ok      %-46s %s\n' "historico/taxa-e-funding-em-campos-proprios" "sem resultado recalculado por execucao"
else
  printf 'FALHOU  %-46s %s\n' "historico/taxa-e-funding-em-campos-proprios" "ver acima"
  falhas=$((falhas + 1))
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "ponta-a-ponta: 0 falhas — as duas pontas falam o contrato, e decidem o que deviam"
  exit 0
fi
echo "ponta-a-ponta: $falhas falhas"
exit 1
