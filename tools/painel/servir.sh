#!/usr/bin/env bash
# O LANCADOR DO PAINEL — a linha que a unit do host corre. UMA porta de entrada, UM processo.
#
# O QUE ELE FAZ: descobre o endereco da LAN (se nao lhe derem um) e entrega tudo ao `servidor.ts`, que passa a ser
# O processo do painel — serve a tela, aceita o pedido de escrita (`POST /api/ficha`) e GERA o fio que serve
# (`web/painel/painel.json` ao minuto, `vivo.json` aos dois segundos).
#
# PORQUE E' SO' ISTO, quando antes tinha dois lacos `while` em segundo plano: aqueles lacos faziam do `servir.sh` a
# METADE que gerava e do `servidor.ts` a metade que servia, e a tela dependia de os dois coexistirem. Um
# `servidor.ts` arrancado sozinho servia a pasta sem nunca renovar o fio — duas metades, dois sitios onde o
# comportamento pode divergir. Agora o gerador e' o proprio servidor (com `exec`, a unit ve um so' processo, e os
# ciclos morrem com ele — nunca fica um `bun` orfao a ler ficheiros depois de a tela sair).
#
# E NAO OPERA NADA: gerar o fio e' um leitor, e um pedido de escrita e' um gesto do dono, nao da mesa. Se este
# servico estiver parado, a mesa opera igual — e' essa a propriedade que o torna seguro de deixar ligado.
#
# Uso:  bash tools/painel/servir.sh [--porta 8788] [--endereco 192.168.15.24] [--corrida <dir>]... [--intervalo 60] [--intervalo-vivo 2]
#
# AS INSTALACOES. O painel olha para N corridas: `--corrida` repete-se (uma por instalacao), e sem nenhuma ele
# DESCOBRE as que estao vivas (a `operacao.json` reescrita ha' menos de 5 min) sob a raiz das corridas.
#
# Parar: Ctrl-C.
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORTA="${PORTA:-8788}"
INTERVALO="${INTERVALO:-60}"
INTERVALO_VIVO="${INTERVALO_VIVO:-2}"
ENDERECO="${ENDERECO:-}"
# As corridas explicitas (pode repetir-se). Uma so' continua a servir: `--corrida <dir>`.
DIRS_DA_CORRIDA=()
# A descoberta procura aqui quando nao ha `--corrida` nenhuma.
RAIZ_DAS_CORRIDAS="${RAIZ_DAS_CORRIDAS:-${DIR_DE_OBSERVACAO:-$HOME/.hermes/profiles/appbuilder/cache/scratch}}"

while [ $# -gt 0 ]; do
  case "$1" in
    --porta) PORTA="$2"; shift 2 ;;
    --endereco) ENDERECO="$2"; shift 2 ;;
    --corrida) DIRS_DA_CORRIDA+=("$2"); shift 2 ;;
    --raiz-das-corridas) RAIZ_DAS_CORRIDAS="$2"; shift 2 ;;
    --intervalo) INTERVALO="$2"; shift 2 ;;
    --intervalo-vivo) INTERVALO_VIVO="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

# SEM ENDEREÇO EXPLÍCITO, DESCOBRE-SE O DA LAN. `hostname -I` traz também os endereços da tailnet e IPv6; o que
# se quer é o primeiro IPv4 privado da interface física.
if [ -z "$ENDERECO" ]; then
  ENDERECO="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(tailscale|docker|veth|br-)/ {print $4}' | cut -d/ -f1 | head -1)"
fi
if [ -z "$ENDERECO" ]; then
  echo "nao consegui descobrir o endereco da LAN: passe --endereco" >&2
  exit 1
fi

# OS ARGUMENTOS DAS INSTALACOES, num so' sitio: o mesmo conjunto vai ao servidor (que gera o fio e o refaz a seguir
# a uma escrita). Sem `--corrida`, so' a raiz viaja — e o retrato DESCOBRE as vivas.
ARGS_DAS_CORRIDAS=()
for d in "${DIRS_DA_CORRIDA[@]:-}"; do [ -n "$d" ] && ARGS_DAS_CORRIDAS+=(--corrida "$d"); done
[ -n "$RAIZ_DAS_CORRIDAS" ] && ARGS_DAS_CORRIDAS+=(--raiz-das-corridas "$RAIZ_DAS_CORRIDAS")

echo "painel: retrato a cada ${INTERVALO}s · vivo a cada ${INTERVALO_VIVO}s · tela em http://${ENDERECO}:${PORTA}/index.html"
if [ "${#DIRS_DA_CORRIDA[@]}" -gt 0 ]; then
  echo "painel: instalacoes (explicitas): ${DIRS_DA_CORRIDA[*]}"
else
  echo "painel: instalacoes: a descobrir as vivas sob ${RAIZ_DAS_CORRIDAS}"
fi

# O SERVIDOR — a tela, a porta de escrita E o gerador do fio, num so' processo. `exec` para a unit ter este pid.
exec bun run "$RAIZ/tools/painel/servidor.ts" --porta "$PORTA" --endereco "$ENDERECO" \
  --intervalo "$INTERVALO" --intervalo-vivo "$INTERVALO_VIVO" "${ARGS_DAS_CORRIDAS[@]}"
