#!/usr/bin/env bash
# A porta unica da maquina: corre TUDO o que prova o recorte 002, e sai 1 se alguma coisa falhar.
#
# Existe porque "corri as baterias" e uma frase que nao se verifica. Uma porta so, com uma saida so:
# ou passa, ou nao passa - e quando nao passa, diz qual.
#
# Uso:  bash tools/verificar-maquina/provar.sh [--rapido]
#       --rapido  salta a bateria do contrato (001), que e a mais lenta

set -u
cd "$(dirname "$0")/../.." || exit 1
RAIZ="$(pwd)"
RAPIDO=0
[ "${1:-}" = "--rapido" ] && RAPIDO=1

# ---------------------------------------------------------------------------------------------
# UMA BATERIA DE CADA VEZ. Duas ao mesmo tempo pisam-se: a prova negativa da frescura reescreve
# ficheiros gerados e o vigia escreve estado de runtime — e a segunda mede a sujeira da primeira.
# Quem chega depois RECUSA: nao espera, nao corre a meias. Uma bateria mede-se com o repositorio
# so para ela (foi assim que uma corrida concorrente deu "fronteira: 1 falhas" em codigo verde).
# A trava e um pid: se o processo ja morreu, a trava velha e limpa em vez de bloquear para sempre.
TRAVA=".provar.lock"
if [ -f "$TRAVA" ]; then
  outro=$(cat "$TRAVA" 2>/dev/null || echo "")
  if [ -n "$outro" ] && kill -0 "$outro" 2>/dev/null; then
    echo "provar: RECUSADO — outra bateria esta a correr (pid $outro); uma bateria mede-se sozinha"
    exit 1
  fi
  echo "provar: (trava do pid $outro, que ja nao existe — a limpar)"
fi
echo $$ > "$TRAVA"
trap 'rm -f "$TRAVA"' EXIT

falhas=0
corridas=0
declarar() {
  local nome="$1"; shift
  printf '%-42s ' "$nome"
  saida="$("$@" 2>&1)"
  if [ $? -eq 0 ]; then
    corridas=$((corridas + 1))
    echo "OK   $(echo "$saida" | tail -1)"
  else
    corridas=$((corridas + 1))
    falhas=$((falhas + 1))
    echo "FALHOU"
    echo "$saida" | tail -6 | sed 's/^/      /'
  fi
}

echo "=== a maquina dos recortes 001-003, do principio ao fim ==="
echo

declarar "tabela de transicoes"          bun run tools/verificar-maquina/tabela.ts
declarar "porteiro do estado (negativo)" bun run tools/verificar-maquina/tabela.ts --prova-negativa
declarar "a mesa (maquina + marcas)"     bun run core/mesa.prova.ts
declarar "maquina de estados"            bun run core/estados/provar.ts
declarar "condicoes, ciclo, desfecho"    bun run core/ciclo/provar.ts
declarar "arranque (sete portas)"        bun run tools/verificar-maquina/arranque.ts
declarar "tipos (tsc)"                   bash tools/verificar-maquina/tipos.sh
declarar "sessao e CB"                   bun run tools/verificar-maquina/sessao.ts
declarar "pausa e encerramento"          bun run tools/verificar-maquina/pausa.ts
declarar "registo (SC-011)"              bun run tools/verificar-maquina/registo.ts
declarar "contenda (T066)"      bun run tools/verificar-maquina/contenda.ts  "resumo"
declarar "chaves do core (SC-012)"       bun run tools/verificar-maquina/chaves.ts
declarar "porteiro do estado (script)"   bash tools/verificar-maquina/porteiro-do-estado.sh
declarar "marcas sobrevivem ao reinicio" bash tools/verificar-maquina/reiniciar.sh
declarar "porta da mesa (T014-T016)"      bun run tools/verificar-maquina/servidor.ts
declarar "preparar contas (script + questionario)" bash tools/preparar-contas/provas.sh
declarar "conector hyperliquid (offline, US1)" bash tools/verificar-conector/provas-offline.sh

# As bancadas da camada de OPERACAO (003): correm processos a serio (vigia + mesa), por isso ficam na porta
# completa - a `--rapido` e a que se corre a cada passo.
if [ "$RAPIDO" -eq 0 ]; then
  declarar "vigia + mesa (--arranque)"     bash tools/verificar-maquina/vigia.sh --arranque
  declarar "vigia: orfandade (--orfandade)" bash tools/verificar-maquina/vigia.sh --orfandade
  declarar "encerramento (--encerramento)" bash tools/verificar-maquina/vigia.sh --encerramento
  declarar "verbos (--verbos, T044)"       bash tools/verificar-maquina/vigia.sh --verbos
  declarar "contrato neutro (recorte 001)" bash tools/verificar-contrato/ponta-a-ponta.sh
  declarar "frescura do contrato"          bash tools/verificar-contrato/frescura.sh
  declarar "frescura (prova negativa, T057)" bash tools/verificar-contrato/frescura.sh --prova-negativa
  declarar "fronteira (SC-003, T046-T049)" bash tools/verificar-contrato/fronteira.sh
  declarar "duble de mesa (US6, SC-004)"   bash tools/verificar-contrato/duble-de-mesa.sh
  declarar "inventario de chaves (SC-012)" bash tools/verificar-contrato/inventario.sh
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "provar: $corridas de $corridas passaram — a maquina decide o que devia, e explica o que nao fez"
  exit 0
fi
echo "provar: $falhas de $corridas FALHARAM"
exit 1
