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
#
# O QUE MUDOU A 03/10/2026, e porque. A comparacao era entre duas cópias do MESMO directório, e um ficheiro que o
# gerador JA' NAO PRODUZ ficava identico nos dois lados — invisivel. Medido: TRES `.d.ts` obsoletos rastreados em
# git (nomes COM HIFEN, de quando os schemas se chamavam de outra maneira), um deles a carregar contrato VELHO, e a
# frescura a dar 0 divergencias. O `gerar.sh` passou a ser DONO do que produz (gera numa pasta propria e substitui
# os directórios geridos), e o `diff` passou a vê-lo: um ficheiro obsoleto e' "Only in <guardado>", logo
# divergencia. A prova negativa abaixo cobre as DUAS classes: o gerado atrasado A MAO (T057) e o `.d.ts` obsoleto
# que o gerador nao produz.
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

  # (1) um gerado ATRASADO A MAO: editar o gerado tem de ser apanhado, e a frescura seguinte cura-o.
  printf '\n// um gerado atrasado a mao, de proposito (T057)\n' >> "$alvo"
  if bash "$0" >/dev/null 2>&1; then
    echo "frescura/prova-negativa: FALHOU — o gerado atrasado passou como fresco"
    exit 1
  fi
  echo "ok    o gerado atrasado a mao foi REPROVADO pela frescura"
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

  # (2) um `.d.ts` OBSOLETO — um nome que o gerador NAO PRODUZ (a classe que a frescura deixava passar a 03/10/2026:
  #     a comparacao via-o identico nos dois lados). TEM de reprovar, e a cura tem de o APAGAR — o gerador e' dono
  #     do que produz, e um ficheiro que ele nao produz nao tem por onde sobreviver.
  obsoleto="$RAIZ/contracts/gerado/ts/pergunta-velha.d.ts"
  echo "// obsoleto, de proposito: o gerador nao produz este nome (prova da frescura, 03/10/2026)" > "$obsoleto"
  if bash "$0" >/dev/null 2>&1; then
    echo "frescura/prova-negativa: FALHOU — o .d.ts obsoleto passou como fresco"
    rm -f "$obsoleto"
    exit 1
  fi
  echo "ok    o .d.ts obsoleto (que o gerador nao produz) foi REPROVADO pela frescura"
  if bash "$0" >/dev/null 2>&1; then
    echo "ok    e a frescura seguinte apaga-o (o gerador e' dono do que produz)"
  else
    echo "frescura/prova-negativa: a frescura NAO curou o gerado obsoleto"
    rm -f "$obsoleto"
    exit 1
  fi
  if [ -f "$obsoleto" ]; then
    echo "frescura/prova-negativa: o obsoleto FICOU no gerado depois da cura"
    rm -f "$obsoleto"
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

# `-x __pycache__`: o cache do Python e' derivado dos `.py` gerados, nao e' gerado pelo gerador, e nao entra na
# comparacao (senao um `__pycache__` deixado por um import fazia a frescura mentir).
if diff -r -x '__pycache__' "$ANTES/gerado" gerado >"$ANTES/diff.txt" 2>&1; then
  ficheiros=$(find gerado -type f -not -path '*__pycache__*' | wc -l)
  echo "frescura: 0 divergencias — o gerado corresponde aos schemas ($ficheiros ficheiros)"
  exit 0
fi

echo "frescura: o gerado NAO corresponde aos schemas"
head -40 "$ANTES/diff.txt"
exit 1
