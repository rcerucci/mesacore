#!/usr/bin/env bash
# O PAINEL A CORRER COM O SISTEMA — o retrato a renovar-se, a tela servida na rede local, e a porta de escrita.
#
# O QUE ELE FAZ, e são três coisas:
#   1. regenera `web/painel/painel.json` a cada `INTERVALO` segundos (por omissão 60 — o relógio do motor é a
#      barra horária, e um retrato por minuto chega de sobra para o dono ver o que está vivo);
#   2. serve `web/painel/` em `ENDERECO:PORTA`, **amarrado só ao endereço da LAN** (nunca a `0.0.0.0`): o painel
#      lê posição, equity e decisões, e não se publica para fora da rede de casa;
#   3. aceita o **pedido de escrita de uma ficha** (`POST /api/ficha`) — e não escreve: quem escreve é
#      `tools/escrever-ficha`, que **valida o candidato com o conferidor do portão antes de tocar no ficheiro** e
#      deixa a mudança registada com a origem e a hora (RN-E12/RN-M2). Ver `tools/painel/servidor.ts`.
#
# E NÃO OPERA NADA: o ciclo do retrato é um leitor, e um pedido de escrita é um gesto do dono, não da mesa. Se este
# serviço estiver parado, a mesa opera igual — é essa a propriedade que o torna seguro de deixar ligado.
#
# Uso:  bash tools/painel/servir.sh [--porta 8788] [--endereco 192.168.15.24] [--corrida <dir>] [--intervalo 60]
#
# Parar: Ctrl-C (mata o ciclo do retrato e o servidor juntos).
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORTA="${PORTA:-8788}"
INTERVALO="${INTERVALO:-60}"
# O «AGORA» tem relogio proprio, e por isso e' outro numero. Ver o ciclo la' em baixo.
INTERVALO_VIVO="${INTERVALO_VIVO:-2}"
ENDERECO="${ENDERECO:-}"
DIR_DA_CORRIDA="${DIR_DE_OBSERVACAO:-$HOME/.hermes/profiles/appbuilder/cache/scratch/corrida-de-risco}"

while [ $# -gt 0 ]; do
  case "$1" in
    --porta) PORTA="$2"; shift 2 ;;
    --endereco) ENDERECO="$2"; shift 2 ;;
    --corrida) DIR_DA_CORRIDA="$2"; shift 2 ;;
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

echo "painel: retrato a cada ${INTERVALO}s · vivo a cada ${INTERVALO_VIVO}s · tela em http://${ENDERECO}:${PORTA}/index.html"
echo "painel: corrida ${DIR_DA_CORRIDA}"

# O CICLO DO RETRATO. Um primeiro retrato À MÃO, para a tela não abrir vazia se alguém chegar antes do minuto.
bun run "$RAIZ/tools/painel/retrato.ts" --corrida "$DIR_DA_CORRIDA" || echo "painel: o primeiro retrato falhou (a tela diz o que falta)"

(
  while true; do
    sleep "$INTERVALO"
    bun run "$RAIZ/tools/painel/retrato.ts" --corrida "$DIR_DA_CORRIDA" >/dev/null 2>&1 \
      || echo "painel: retrato falhou nesta volta (o anterior fica na tela)"
  done
) &
CICLO=$!

# O CICLO DO «AGORA» — e é este que dá a sensação de vivo, e é por isso que tem relógio próprio.
#
# MEDIDO: o retrato completo custa 0,43 s e pesa 2,7 MB (1,67 MB só de séries), porque pergunta a cada setup a sua
# série — e a série muda por BARRA, não a cada segundo. O modo leve (`--sem-serie`) custa 0,11 s e pesa 28 KB (98×
# menos) e traz o que se move a cada segundo no motor: a leitura (com o preço e a idade do dado), a posição, a
# proposta, a última decisão, o risco e as faltas.
#
# São DOIS relógios porque são duas coisas: o gráfico ao minuto, o «agora» ao segundo. A tela segue os dois — o
# `vivo.json` renova os números, o `painel.json` redesenha o gráfico.
bun run "$RAIZ/tools/painel/retrato.ts" --sem-serie --para web/painel/vivo.json --corrida "$DIR_DA_CORRIDA" \
  || echo "painel: o primeiro retrato vivo falhou (a tela mantem o que tem)"
(
  while true; do
    sleep "$INTERVALO_VIVO"
    bun run "$RAIZ/tools/painel/retrato.ts" --sem-serie --para web/painel/vivo.json --corrida "$DIR_DA_CORRIDA" >/dev/null 2>&1 \
      || echo "painel: retrato vivo falhou nesta volta (o anterior fica na tela)"
  done
) &
VIVO=$!

# Os ciclos morrem com o servidor — nunca fica um `bun` órfão a ler ficheiros depois de a tela sair.
trap 'kill "$CICLO" "$VIVO" 2>/dev/null; wait "$CICLO" "$VIVO" 2>/dev/null' EXIT INT TERM

# O SERVIDOR — a tela E a porta de escrita, no mesmo processo (`Bun.serve`).
#
# SEM `exec`, de propósito: com `exec` o servidor substituía esta shell, o `trap` nunca corria, e o ciclo do
# retrato ficava órfão a ler ficheiros depois de a tela sair.
bun run "$RAIZ/tools/painel/servidor.ts" --porta "$PORTA" --endereco "$ENDERECO" --corrida "$DIR_DA_CORRIDA"
