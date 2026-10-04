#!/usr/bin/env bash
# CHECAR O ARRANQUE — o que FALTA para a observacao subir, dito por nome, antes de se arrancar nada.
#
# PORQUE E' UM COMANDO PROPRIO. O arranque de primeira vez nao pode calar: uma conta que nao existe, uma
# credencial em falta, nenhuma ficha ligada — cada uma e' uma razao para nao subir, e o dono tem de a ler. Este
# comando faz SO' a verificacao (nao arranca processo nenhum), e o lancador (`tools/operar-em-observacao.sh`)
# corre-o primeiro: e' a MESMA contingencia nos dois sitios, nunca duas (uma conta, um dono).
#
# O QUE ELE NAO FAZ: nao abre o ficheiro da credencial (so' confere que existe e o modo), e nao le' o valor.
# A conta aponta para o segredo POR REFERENCIA (`conexao.credencial.valor_em = ficheiro:<caminho>`, RN-E14).
#
# Uso:  bash tools/checar-o-arranque.sh <conta> [par]
# Saida: 0 = pode arrancar (com os AVISOS ja' ditos) · 1 = FALTA algo (a razao vai dita em cada linha)
# O repositorio de onde le' `config/contas/` e `fichas/` pode ser apontado por MESA_RAIZ (bancada).

set -uo pipefail
CONTA="${1:-hl-teste-plugin}"
PAR="${2:-}"
RAIZ="${MESA_RAIZ:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FALTA=0

CONFIG="$RAIZ/config/contas/$CONTA.json"
if [ ! -f "$CONFIG" ]; then
  echo "FALTA: a conta '$CONTA' nao existe ($CONFIG) — crie-a antes de a por a observar."
  FALTA=1
fi

# A CREDENCIAL: a conta aponta para ela POR REFERENCIA. Confere-se a existencia e o modo (600); o valor nunca se le'.
if [ -f "$CONFIG" ]; then
  REF="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("conexao",{}).get("credencial",{}).get("valor_em",""))' "$CONFIG" 2>/dev/null || echo "")"
  CAMINHO_DA_CRED="${REF#ficheiro:}"
  if [ -z "$CAMINHO_DA_CRED" ] || [ "$CAMINHO_DA_CRED" = "$REF" ]; then
    echo "FALTA: a conta '$CONTA' nao aponta a credencial por ficheiro (conexao.credencial.valor_em = '$REF')."
    FALTA=1
  elif [ ! -f "$CAMINHO_DA_CRED" ]; then
    echo "FALTA: a credencial nao existe em $CAMINHO_DA_CRED (a conta aponta para la')."
    FALTA=1
  else
    MODO="$(stat -c '%a' "$CAMINHO_DA_CRED")"
    [ "$MODO" = "600" ] || echo "AVISO: a credencial $CAMINHO_DA_CRED esta' com modo $MODO (a casa exige 600)."
  fi
fi

# AS FICHAS: quantas estao LIGADAS (o operador nao corre par nenhum) e quantas estao ARMADAS ao venue.
RESUMO_DE_FICHAS="$(python3 - "$RAIZ" "$CONTA" "$PAR" <<'PY'
import glob, json, os, sys
raiz, conta, par = sys.argv[1], sys.argv[2], (sys.argv[3] or None)
ligadas, armadas = [], []
for caminho in sorted(glob.glob(os.path.join(raiz, "fichas", "*", "*-%s.json" % conta))):
    instrumento = os.path.basename(caminho)[:-5].rsplit("-", 1)[0]
    if par is not None and instrumento != par:
        continue
    try:
        cab = json.load(open(caminho)).get("cabecalho", {})
    except Exception:
        continue
    if cab.get("run") is True:
        ligadas.append(instrumento)
        if cab.get("enviar") is True:
            armadas.append(instrumento)
print("%s|%s" % (",".join(ligadas) or "-", ",".join(armadas) or "-"))
PY
)"
LIGADAS="${RESUMO_DE_FICHAS%%|*}"
ARMADAS="${RESUMO_DE_FICHAS##*|}"
if [ "$LIGADAS" = "-" ]; then
  echo "FALTA: nenhuma ficha ligada (run: true) para a conta '$CONTA'${PAR:+ no par '$PAR'} — o operador nao tem o que correr."
  FALTA=1
fi
if [ "$ARMADAS" != "-" ]; then
  echo "ATENCAO: fichas ARMADAS ao venue (enviar: true): $ARMADAS — os sinais destes pares vao SAIR para o venue."
fi
echo "arranque: conta=$CONTA · pares ligados: $LIGADAS · armados ao venue: $ARMADAS"

if [ "$FALTA" -ne 0 ]; then
  echo
  echo "arranque: NAO pode subir — resolva o que FALTA acima."
  exit 1
fi
exit 0
