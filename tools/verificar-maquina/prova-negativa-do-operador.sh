#!/usr/bin/env bash
# A PROVA NEGATIVA DO PRAZO DO OPERADOR (D-017): o caso tem de REPROVAR quando o defeito volta.
#
# PORQUE ISTO EXISTE. A bancada `operador-nao-espera.ts` passa quando o operador escreve a operacao e termina —
# mas passaria tambem por outra razao qualquer (um erro do proprio corredor, um ficheiro que apareceu de outro
# sitio). O que se quer medir e' que o PRAZO e' quem a fecha: repoe-se o defeito medido a 30/09/2026 (o operador
# fica a' espera indefinidamente) e o caso tem de ficar vermelho.
#
# O FRAGMENTO INJECTADO e' o que o defeito era: a guarda do prazo deixa de valer. Com ela morta, o operador le^
# o ADA para sempre, nunca escreve a operacao e nunca termina — e o corredor espera o limite dele e reprova.
#
# O VERMELHO TEM DE NOMEAR O CASO (`D-017: o operador TERMINA sozinho`) — um corredor pode cair por outra razao,
# e vermelho sem nome nao prova que foi ESTE defeito.
#
# O FICHEIRO VOLTA PELO `sha256`: a copia e' comparada com o original ANTES, e o que fica no fim e' comparado com
# o que estava antes. Se outro escritor tocar no ficheiro durante a prova, a reposicao RECUSA em vez de escrever
# por cima do trabalho de outro.
#
# Uso:  bash tools/verificar-maquina/prova-negativa-do-operador.sh
# Sai 1 se o defeito nao reprovar, se reprovar sem nomear o caso, ou se a reposicao nao for exacta.

set -u
cd "$(dirname "$0")/../.." || exit 1

ALVO="vigia/operador.ts"
FRAGMENTO='        if (inuteis >= LEITURAS_INUTEIS) {'
CASO="D-017: o operador TERMINA sozinho"

falhas=0
echo "=== prova negativa do prazo do operador (D-017): o defeito tem de reprovar, e a bancada tem de o NOMEAR ==="
echo

if ! grep -qF "$FRAGMENTO" "$ALVO"; then
  echo "RECUSADO  o fragmento da prova mudou ($ALVO): a prova tem de ser revista — o ficheiro nao foi tocado"
  exit 1
fi

copia=$(mktemp); cp "$ALVO" "$copia"
antes=$(sha256sum "$ALVO" | cut -d' ' -f1)

python3 - "$ALVO" "$FRAGMENTO" <<'PY'
import sys
p, fragmento = sys.argv[1], sys.argv[2]
t = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(t.replace(fragmento, "        if (false && inuteis >= LEITURAS_INUTEIS) { // DEFEITO INJECTADO (D-017): o prazo deixa de valer", 1))
PY
injetado=$(sha256sum "$ALVO" | cut -d' ' -f1)

saida=$(timeout 120 bun tools/verificar-maquina/operador-nao-espera.ts 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  echo "FALHOU   sem o prazo, a bancada PASSOU: ela nao mede o que diz medir"
  falhas=$((falhas + 1))
elif printf '%s\n' "$saida" | grep -q "$CASO"; then
  echo "OK   o defeito foi REPROVADO e o caso nomeado:"
  printf '%s\n' "$saida" | grep -m1 "^FALHA" | cut -c1-150 | sed 's/^/      /'
else
  echo "FALHOU   vermelho, mas SEM nomear o caso — e' inconclusivo:"
  printf '%s\n' "$saida" | tail -4 | sed 's/^/      /'
  falhas=$((falhas + 1))
fi

# A reposicao: so' se ninguem mais tocou no ficheiro depois da injectao.
agora=$(sha256sum "$ALVO" | cut -d' ' -f1)
if [ "$agora" != "$injetado" ]; then
  echo "RECUSADO  outro escritor tocou em $ALVO durante a prova: NAO reponho por cima"
  falhas=$((falhas + 1))
  rm -f "$copia"
else
  cp "$copia" "$ALVO"; rm -f "$copia"
  depois=$(sha256sum "$ALVO" | cut -d' ' -f1)
  if [ "$antes" = "$depois" ]; then
    echo "OK   curado: o ficheiro reposto e' byte a byte o original (sha256 ${antes:0:12}...)"
  else
    echo "FALHOU   a reposicao deixou o ficheiro diferente do original"
    falhas=$((falhas + 1))
  fi
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "prova negativa do operador: o defeito reprova, e a bancada nomeia-o"
  exit 0
fi
echo "prova negativa do operador: $falhas falha(s)"
exit 1
