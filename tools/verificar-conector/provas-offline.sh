#!/usr/bin/env bash
# Provas do conector que NAO precisam do venue: casos em dado + a porta das dependencias.
# Uso: provas-offline.sh [--prova-negativa]
set -uo pipefail
cd "$(dirname "$0")/../.."
falhas=0
declarar() { printf '%-52s' "$1"; }

# 1. Os casos do manifesto (em dado, contra a sonda — sem rede e sem chave)
declarar "casos da credencial (hyperliquid)"
saida_c=$(bun brokers/hyperliquid/casos/correr-credencial.ts 2>&1)
if printf '%s\n' "$saida_c" | tail -1 | grep -q "0 divergentes"; then
  echo "OK   $(printf '%s\n' "$saida_c" | tail -1)"
else
  echo "FALHOU"; printf '%s\n' "$saida_c" | grep divergente | head -5; falhas=$((falhas+1))
fi

declarar "casos do manifesto (hyperliquid)"
saida=$(bun brokers/hyperliquid/casos/correr.ts 2>&1)
if printf '%s\n' "$saida" | tail -1 | grep -q "0 divergentes"; then
  echo "OK   $(printf '%s\n' "$saida" | tail -1)"
else
  echo "FALHOU"; printf '%s\n' "$saida" | grep divergente | head -5; falhas=$((falhas+1))
fi

# 2. A porta das dependencias: o conector importa `contracts`, NUNCA `core` (RN-E1).
declarar "porta: importa contracts, nunca o core (RN-E1)"
maus=$(grep -rnE "^\s*(import|from)\s+.*core/" brokers/hyperliquid --include=*.ts 2>/dev/null | wc -l)
if [ "$maus" -eq 0 ]; then
  echo "OK   0 importacoes do core em brokers/hyperliquid"
else
  echo "FALHOU"; falhas=$((falhas+1))
fi

# 3. A prova negativa: o corredor SABE reprovar?
#    Duas licoes ja pagas, dentro do codigo:
#    (a) a reposicao NAO depende do `git` — num ficheiro ainda nao commitado o `git checkout`
#        falha, o defeito fica la dentro e a prova seguinte mede-o. Guarda-se uma COPIA e a cura
#        prova-se por HASH: byte a byte;
#    (b) um defeito injectado num campo SEM caso nao e apanhado — e ha um caso por capacidade.
if [ "${1:-}" = "--prova-negativa" ]; then
  declarar "prova negativa: defeito injectado tem de reprovar"
  alvo="brokers/hyperliquid/manifesto.ts"
  copia=$(mktemp); cp "$alvo" "$copia"
  antes=$(sha256sum "$copia" | cut -d' ' -f1)
  if python3 "$(dirname "$0")/py/injectar-defeito.py" "$alvo"; then
    if bun brokers/hyperliquid/casos/correr.ts >/dev/null 2>&1; then
      echo "FALHOU   o defeito passou despercebido — o corredor nao mede o que diz medir"
      falhas=$((falhas+1))
    else
      quantos=$(bun brokers/hyperliquid/casos/correr.ts 2>&1 | grep -c '"veredicto":"divergente"')
      echo "OK   o defeito foi apanhado ($quantos caso(s) divergente(s))"
    fi
    cp "$copia" "$alvo"; rm -f "$copia"
    depois=$(sha256sum "$alvo" | cut -d' ' -f1)
    if [ "$antes" = "$depois" ]; then
      echo "$(printf '%-52s' 'curado: o reposto e byte a byte o original')OK   sha256 ${antes:0:12}..."
    else
      echo "$(printf '%-52s' 'curado: o reposto e byte a byte o original')FALHOU — a reposicao deixou o ficheiro diferente"
      falhas=$((falhas+1))
    fi
  else
    echo "RECUSADO  o fragmento da prova mudou — o ficheiro nao foi tocado"
    rm -f "$copia"; falhas=$((falhas+1))
  fi
fi

echo
if [ "$falhas" -eq 0 ]; then echo "provas offline do conector: 0 falhas"; else echo "provas offline do conector: $falhas falhas"; fi
exit "$falhas"
