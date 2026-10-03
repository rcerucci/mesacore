#!/usr/bin/env bash
# A PROVA NEGATIVA DO ENCERRAMENTO (D-007): a bancada tem de REPROVAR quando o defeito volta.
#
# PORQUE ISTO EXISTE. Uma bancada que nunca reprovou nao mediu nada: os casos novos do encerramento (a
# liquidacao em curso a nao se interromper) passam tambem se a guarda estiver morta por OUTRA razao — e era
# exactamente esse o defeito (D-007): a linha da tabela existia e a guarda nunca valia `true`. Uma prova que so
# medisse o verde nao distinguiria «a regra governa» de «a regra nunca dispara».
#
# O QUE SE INJECTA, e nao se inventa: em `core/mesa.ts`, o contexto do verbo deixa de trazer a liquidacao em
# curso — o campo `liquidacao_em_curso` sai do contexto. E' o defeito medido (o campo declarado em
# `core/estados/maquina.ts` e nunca escrito por ninguem) posto outra vez no lugar.
#
# O VERMELHO TEM DE NOMEAR O CASO. Um corredor pode cair por outra razao (a rede, um ficheiro, um processo);
# vermelho sem nome nao prova que foi ESTE defeito que a bancada apanhou — e a casa aceita a prova declarada
# mais fraca, nunca a prova que finge ser o que nao e'.
#
# O FICHEIRO VOLTA PELO `sha256`: a copia e' comparada com o original ANTES de a prova correr, e o que fica no
# fim e' comparado com o que estava antes. Se outro escritor tocar no ficheiro durante a prova, a reposicao
# RECUSA em vez de escrever por cima do trabalho de outro.
#
# Uso:  bash tools/verificar-maquina/prova-negativa-do-encerramento.sh
# Sai 1 se o defeito nao reprovar, se reprovar sem nomear o caso, ou se a reposicao nao for exacta.

set -u
cd "$(dirname "$0")/../.." || exit 1

ALVO="core/mesa.ts"
FRAGMENTO='      liquidacao_em_curso: liquidacaoEmCurso,'
CASO="liquidacao-em-curso/D-007"

falhas=0
echo "=== prova negativa do encerramento (D-007): o defeito tem de reprovar, e a bancada tem de o NOMEAR ==="
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
open(p, "w", encoding="utf-8").write(
    t.replace(fragmento, "      // DEFEITO INJECTADO (D-007): o contexto deixa de dizer que a liquidacao corre", 1)
)
PY
injetado=$(sha256sum "$ALVO" | cut -d' ' -f1)

saida=$(bash tools/verificar-maquina/vigia.sh --encerramento 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then
  echo "FALHOU   sem o contexto, a bancada PASSOU: ela nao mede o que diz medir"
  falhas=$((falhas + 1))
elif printf '%s\n' "$saida" | grep -q "$CASO"; then
  echo "OK   o defeito foi REPROVADO e o caso nomeado:"
  printf '%s\n' "$saida" | grep -m1 "FALHA $CASO" | cut -c1-140 | sed 's/^/      /'
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
  echo "prova negativa do encerramento: o defeito reprova, e a bancada nomeia-o"
  exit 0
fi
echo "prova negativa do encerramento: $falhas falha(s)"
exit 1
