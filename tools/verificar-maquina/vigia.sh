#!/usr/bin/env bash
# A porta do recorte 003: o VIGIA a governar a mesa, contra dubleis.
#
# Uso:  bash tools/verificar-maquina/vigia.sh --arranque | --orfandade | --encerramento | --verbos
#
# Existe pela mesma razao da porta unica do 002: "corri as baterias" nao se verifica. Cada modo chama a
# bancada do vigia (tools/verificar-maquina/vigia.ts) com os casos declarados daquele assunto.
#
# Enquanto a bancada nao existir, o modo NAO finge: diz que nao esta implementado e sai 2. As duas
# respostas faceis mentiriam - sair 0 dava por provado o que ninguem correu, e sair 1 acusava um defeito
# que nao existe. "Nao implementado" e uma terceira resposta, e e a verdadeira.
#
# Nada aqui toca numa corretora e nada aqui pede chave: tudo corre contra dubleis (RN-E24).

set -u
cd "$(dirname "$0")/../.." || exit 1

MODO="${1:-}"
case "$MODO" in
  --arranque|--orfandade|--encerramento|--verbos) ;;
  *)
    echo "uso: bash tools/verificar-maquina/vigia.sh --arranque|--orfandade|--encerramento|--verbos" >&2
    exit 2
    ;;
esac

# O modo -> a tarefa que o implementa (specs/003-vigia-e-mesa/tasks.md). O mapa esta aqui, e nao na
# cabeca de quem le: um modo que existe sem tarefa era um modo que ninguem ia fazer.
case "$MODO" in
  --arranque)     TAREFA="T024" ;;
  --orfandade)    TAREFA="T031" ;;
  --encerramento) TAREFA="T038" ;;
  --verbos)       TAREFA="T044" ;;
esac

if [ ! -f tools/verificar-maquina/vigia.ts ]; then
  printf '%s: NAO IMPLEMENTADO (bancada tools/verificar-maquina/vigia.ts, tarefa %s)\n' "$MODO" "$TAREFA"
  exit 2
fi

exec bun run tools/verificar-maquina/vigia.ts "$MODO"
