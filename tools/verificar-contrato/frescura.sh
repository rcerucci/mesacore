#!/usr/bin/env bash
# Teste de frescura do codigo gerado (D8).
#
#   tools/verificar-contrato/frescura.sh
#
# Regenera tudo a partir dos schemas e compara com o que esta versionado. Diferenca = alguem
# editou o gerado a mao, ou mudou o schema sem regenerar. Nos dois casos o repositorio esta a
# mentir sobre o que o contrato diz, e a saida e 1.
# Se a PROPRIA geracao falhar, isto NAO devolve "0 divergencias": uma geracao falhada nao pode
# dar verde (foi assim que a primeira versao deste script passou com 4 de 8 ficheiros).
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# A PROVA NEGATIVA (T057): um gerado atrasado TEM de ser recusado, e a frescura seguinte tem de o curar.
# Vive dentro do proprio script (e nao num teste a parte) porque um portao que nunca falhou nao e um portao:
# guardada assim, ela corre sempre que alguem duvida do verde.
if [ "${1:-}" = "--prova-negativa" ]; then
  alvo="$RAIZ/contracts/gerado/ts/mercado.d.ts"
  [ -f "$alvo" ] || { echo "frescura/prova-negativa: nao ha $alvo para atrasar"; exit 2; }
  antes="$(cd "$RAIZ" && git status --porcelain contracts/gerado | wc -l)"
  [ "$antes" -eq 0 ] || { echo "frescura/prova-negativa: o gerado ja estava sujo antes da prova"; exit 2; }
  printf '\n// um gerado atrasado a mao, de proposito (T057)\n' >> "$alvo"
  if bash "$0" >/dev/null 2>&1; then
    echo "frescura/prova-negativa: FALHOU — o gerado atrasado passou como fresco"
    exit 1
  fi
  echo "ok    o gerado atrasado a mao foi REPROVADO pela frescura"
  # A frescura regenera por cima: o ficheiro tem de voltar ao que o schema diz, sozinho.
  if bash "$0" >/dev/null 2>&1; then
    echo "ok    e a frescura seguinte cura-o: o gerado voltou a corresponder aos schemas"
  else
    echo "frescura/prova-negativa: a frescura NAO curou o gerado"
    exit 1
  fi
  depois="$(cd "$RAIZ" && git status --porcelain contracts/gerado | wc -l)"
  if [ "$depois" -eq 0 ]; then
    echo "ok    e a arvore ficou limpa (0 ficheiros sujos em contracts/gerado)"
  else
    echo "frescura/prova-negativa: a arvore ficou com $depois ficheiros sujos em contracts/gerado"
    exit 1
  fi
  exit 0
fi

cd "$RAIZ/contracts"

ANTES="$(mktemp -d)"
trap 'rm -rf "$ANTES"' EXIT
cp -r gerado "$ANTES/gerado"

if ! bash "$RAIZ/tools/verificar-contrato/gerar.sh" >"$ANTES/geracao.txt" 2>&1; then
  echo "frescura: a GERACAO falhou — nao ha como comparar. Saida do gerador:"
  tail -20 "$ANTES/geracao.txt"
  exit 2
fi

if diff -r "$ANTES/gerado" gerado >"$ANTES/diff.txt" 2>&1; then
  ficheiros=$(find gerado -type f | wc -l)
  echo "frescura: 0 divergencias — o gerado corresponde aos schemas ($ficheiros ficheiros)"
  exit 0
fi

echo "frescura: o gerado NAO corresponde aos schemas"
head -40 "$ANTES/diff.txt"
exit 1
