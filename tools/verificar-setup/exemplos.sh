#!/usr/bin/env bash
# OS DOIS SETUPS DE EXEMPLO, CORRIDOS A SERIO — e a sua proposta julgada pelo CONTRATO.
#
# PORQUE EXISTE. Os exemplos (`setups/cruzamento_de_media/plugin.ts` e `plugin.py`) sao MOLDE para o proximo
# setup, e NAO estavam em bancada nenhuma: medido a 30/09/2026, os dois tinham apodrecido sem que nada o
# dissesse — a versao do contrato escrita a mao (1.8.0 no TS, 1.9.0 no Python) e o Python sem a `barra_ms`, que
# e' OBRIGATORIA desde a 1.8.0. Quem copiasse o molde copiava uma proposta que o contrato recusa.
#
# O que se mede aqui, e sao duas coisas diferentes:
#   1. o exemplo CORRE com o ambiente que o operador lhe da' e produz uma `proposta`;
#   2. essa proposta PASSA o contrato (e' o contrato, e nao o exemplo, que a julga).
#
# Uso:  bash tools/verificar-setup/exemplos.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
RAIZ="$(pwd)"
CONTRATO="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contrato"])' "$RAIZ/contracts/versao.json")"
CONSTANTES='{"rapida":5,"lenta":20}'
INSTRUMENTO=BTC
RELOGIO=1h
PASTA_DE_MERCADO="$RAIZ/setups/cruzamento_de_media/mercado"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A LEITURA: a ultima barra do ficheiro de velas ja' FECHOU, e o `tempo_do_venue_ms` e' o instante do venue.
AGORA="$(python3 - "$PASTA_DE_MERCADO/velas-BTC-1h.jsonl" <<'PY'
import json, sys
velas = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
print(int(velas[-1]["t"]) + 3_600_000 + 1000)
PY
)"
LEITURA="$(python3 - "$CONTRATO" "$AGORA" <<'PY'
import json, sys
print(json.dumps({"contrato": sys.argv[1], "tipo": "mercado", "id": "exemplos/1", "carga": {
    "instrumento": "BTC", "tempo_do_venue_ms": int(sys.argv[2]), "idade_do_dado_ms": 900,
    "estado": "aberto", "bid": "60000.0", "ask": "60001.0", "ultimo": "60000.5", "equity": "1000.00"}}))
PY
)"

falhas=0
correr() { # nome, comando...
  local nome="$1"; shift
  local saida saida_erro veredicto
  saida="$(printf '%s\n' "$LEITURA" | env CONSTANTES="$CONSTANTES" INSTRUMENTO="$INSTRUMENTO" RELOGIO="$RELOGIO" \
      PASTA_DE_MERCADO="$PASTA_DE_MERCADO" PASTA_DE_ESTADO="$TMP/estado" "$@" 2>"$TMP/erro")"
  saida_erro="$(tail -1 "$TMP/erro")"
  if [ -z "$saida" ]; then
    printf 'FALHOU  %-46s nenhuma proposta saiu (diagnostico: %s)\n' "$nome" "$saida_erro"
    falhas=$((falhas + 1)); return
  fi
  veredicto="$(printf '%s\n' "$saida" | (cd contracts && uv run python esqueleto/validar_linha.py 2>/dev/null) | tail -1)"
  if printf '%s' "$veredicto" | grep -q '"veredicto":"aceite"'; then
    printf 'ok      %-46s %s\n' "$nome" "$(printf '%s' "$saida" | head -c 120)"
  else
    printf 'FALHOU  %-46s a proposta nao passa o contrato: %s\n' "$nome" "$veredicto"
    falhas=$((falhas + 1))
  fi
}

echo "== os setups de exemplo (contrato $CONTRATO) =="
correr "exemplo/cruzamento_de_media (typescript)" bun run setups/cruzamento_de_media/plugin.ts
correr "exemplo/cruzamento_de_media (python)" uv run python setups/cruzamento_de_media/plugin.py

echo
if [ "$falhas" -eq 0 ]; then
  echo "exemplos: 0 falhas — os dois moldes correm, e a proposta deles passa o contrato"
  exit 0
fi
echo "exemplos: $falhas falhas"
exit 1
