#!/usr/bin/env bash
# LIGAR OU DESLIGAR UM PAR A QUENTE — o gesto do dono, numa linha.
#
# Desligar um par (`nao`) e' uma RETIRADA: a partir de 30/09/2026 o sistema fecha a posicao desse par com a
# retirada (`ao_desligar`, lido pelo operador). O par fica na operacao enquanto a posicao nao estiver plana, e sai
# quando estiver — com linha no log em cada passo. Nada disto precisa de reiniciar processo nenhum: as fichas sao
# relidas a cada leitura.
#
# Uso:  bash tools/ligar-par.sh <INSTRUMENTO> <sim|nao> [conta]
#       bash tools/ligar-par.sh BTC nao
#       bash tools/ligar-par.sh SOL sim hl-teste-plugin
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAR="${1:-}"
ESTADO="${2:-}"
CONTA="${3:-${CONTA_DE_PROVA:-hl-teste-plugin}}"

if [ -z "$PAR" ] || [ -z "$ESTADO" ]; then
  echo "uso: bash tools/ligar-par.sh <INSTRUMENTO> <sim|nao> [conta]" >&2
  exit 2
fi
case "$ESTADO" in
  sim) RUN=true ;;
  nao) RUN=false ;;
  *) echo "o estado e' 'sim' ou 'nao' (veio '$ESTADO')" >&2; exit 2 ;;
esac

# AS FICHAS QUE EXISTEM PARA ESTE PAR NESTA CONTA, seja qual for o setup: ligar um par e' liga'-lo em todas.
mapfile -t FICHAS < <(ls "$RAIZ"/fichas/*/"$PAR"-"$CONTA".json 2>/dev/null)
if [ "${#FICHAS[@]}" -eq 0 ]; then
  echo "nao ha ficha de $PAR na conta $CONTA (procurei em fichas/*/$PAR-$CONTA.json)" >&2
  exit 1
fi

for f in "${FICHAS[@]}"; do
  python3 - "$f" "$RUN" <<'PY'
import json, sys
caminho, run = sys.argv[1], sys.argv[2] == "true"
f = json.load(open(caminho, encoding="utf-8"))
antes = f["cabecalho"].get("run")
f["cabecalho"]["run"] = run
open(caminho, "w", encoding="utf-8").write(json.dumps(f, indent=1, ensure_ascii=False) + "\n")
print(f"  {caminho.split('fichas/')[-1]}: run {antes} -> {run}")
PY
done

if [ "$ESTADO" = "nao" ]; then
  echo "retirado: se houver posicao viva, o sistema fecha-a com a retirada (ao_desligar) e so' depois larga o par."
  echo "para ver o que esta' a acontecer: bash tools/relatar-corrida.sh"
fi
