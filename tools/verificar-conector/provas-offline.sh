#!/usr/bin/env bash
# Provas do conector que NAO precisam do venue: casos em dado (credencial, manifesto, ORDENS+cloid, a
# LEITURA DA CONTA e o HISTORICO do venue) + a porta das dependencias + a BATERIA DE CONFORMIDADE (que
# corre o duble de mesa que ja existe, sem rede e sem chave).
# Uso: provas-offline.sh [--prova-negativa]
set -uo pipefail
cd "$(dirname "$0")/../.."
falhas=0
declarar() { printf '%-52s' "$1"; }

# ---------------------------------------------------------------------------------------------------
# UMA BATERIA DE CADA VEZ (a mesma trava de `tools/verificar-maquina/provar.sh`).
#
# Duas baterias ao mesmo tempo pisam-se: a prova negativa reescreve o manifesto, a mesa escreve estado
# de runtime e os ficheiros temporarios cruzam-se - a segunda mede a sujeira da primeira. Quem chega
# depois RECUSA; nao espera, nao corre a meias.
#
# A trava e um pid, e admite UMA excepcao: se o pid da trava for um ANTEPASSADO meu, a corrida e a
# MESMA - `provar.sh` chama esta bateria e ja segura a porta, e recusar-me aqui seria um impasse.
# Uma trava velha (pid que ja morreu) limpa-se em vez de bloquear para sempre.
# ---------------------------------------------------------------------------------------------------
TRAVA=".provar.lock"
dona="nao"
if [ -f "$TRAVA" ]; then
  outro=$(cat "$TRAVA" 2>/dev/null || echo "")
  if [ -n "$outro" ] && kill -0 "$outro" 2>/dev/null; then
    p=$PPID
    for _ in 1 2 3 4 5 6 7 8; do
      if [ "$p" = "$outro" ]; then dona="sim"; break; fi
      if [ -z "$p" ] || [ "$p" = "0" ] || [ "$p" = "1" ]; then break; fi
      p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    done
    if [ "$dona" != "sim" ]; then
      echo "provas-offline do conector: RECUSADO — outra bateria esta a correr (pid $outro); uma bateria mede-se sozinha"
      exit 1
    fi
  else
    echo "provas-offline: (trava do pid ${outro:-?}, que ja nao existe — a limpar)"
  fi
fi
if [ "$dona" != "sim" ]; then
  echo $$ > "$TRAVA"
  trap 'rm -f "$TRAVA"' EXIT
fi

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

# A BANCADA DE ORDENS: a traducao da boleta e o cloid, em dado (`ordens.casos.json`). Nao estava ligada a
# porta nenhuma — passava quando alguem se lembrava de a correr, que e o mesmo que nao passar. A condicao
# e a das outras linhas: a ULTIMA linha tem de dizer `0 divergentes`, senao a porta FALHA.
declarar "casos das ordens e do cloid (hyperliquid)"
saida_o=$(bun brokers/hyperliquid/casos/correr-ordens.ts 2>&1)
if printf '%s\n' "$saida_o" | tail -1 | grep -q "0 divergentes"; then
  echo "OK   $(printf '%s\n' "$saida_o" | tail -1)"
else
  echo "FALHOU"; printf '%s\n' "$saida_o" | grep divergente | head -5; falhas=$((falhas+1))
fi

# A LEITURA DA CONTA (T071): as duas carteiras, a carteira que falha dita `nao_lida`, as duas que falham
# a recusar, e a distancia de liquidacao — calculada, ou AUSENTE (nunca zero). Tudo em dado.
declarar "casos da leitura da conta (hyperliquid)"
saida_l=$(bun brokers/hyperliquid/casos/correr-leitura.ts 2>&1)
if printf '%s\n' "$saida_l" | tail -1 | grep -q "0 divergentes"; then
  echo "OK   $(printf '%s\n' "$saida_l" | tail -1)"
else
  echo "FALHOU"; printf '%s\n' "$saida_l" | grep divergente | head -5; falhas=$((falhas+1))
fi

# A LEITURA DO HISTORICO (T047/T060, FR-018/FR-019): as execucoes, as taxas, o funding e o resultado realizado
# do venue — em dado, com a captura CRUA do venue como base. O que o venue nao da fica `nao_publicado` (nunca
# zero), o que falha RECUSA nomeado, e a PROVA NEGATIVA soma os `closedPnl` do venue so para exigir que essa
# soma NAO apareca na leitura (somar execucoes seria reconstruir o resultado — o defeito que a regra proibe).
# Nao estava ligada a porta nenhuma: passava quando alguem se lembrava de a correr, que e o mesmo que nao passar.
declarar "casos do historico do venue (hyperliquid)"
saida_h=$(bun brokers/hyperliquid/casos/correr-historico.ts 2>&1)
if printf '%s\n' "$saida_h" | tail -1 | grep -q "0 divergentes"; then
  echo "OK   $(printf '%s\n' "$saida_h" | tail -1)"
else
  echo "FALHOU"; printf '%s\n' "$saida_h" | grep -i "diverge\|provocacao" | head -5; falhas=$((falhas+1))
fi

# A POSSE DO PREENCHIMENTO (regressao de 01/10/2026): a marca que o venue devolveu no preenchimento tem de
# ser registada como NOSSA, e a posicao com essa marca tem de ser GERIDA — nao relatada como alheia. O caso
# corre a cadeia inteira (desfecho -> mapa -> leitura -> ciclo) nos dois bracos: o antigo (a guarda
# `aceita`/`preenchida` e a chave derivada do NOME) tem de reproduzir a posicao ALHEIA; o novo, reconhece-la.
declarar "posse do preenchimento (defeito de 01/10/2026)"
saida_p=$(bun tools/verificar-conector/posse-do-preenchimento.ts 2>&1); p_rc=$?
if [ "$p_rc" -eq 0 ] && printf '%s\n' "$saida_p" | grep -qE "posse do preenchimento: [0-9]+ de [0-9]+ passaram"; then
  echo "OK   $(printf '%s\n' "$saida_p" | tail -1)"
else
  echo "FALHOU (exit $p_rc)"; printf '%s\n' "$saida_p" | grep -E "^FALHA" | head -5; falhas=$((falhas+1))
fi

# 2. A porta das dependencias: o conector importa `contracts`, NUNCA `core` (RN-E1).
declarar "porta: imports do conector declarados na raiz"
saida_d=$(bun tools/verificar-conector/porta-das-dependencias.ts 2>&1)
if printf '%s\n' "$saida_d" | grep -q '"veredicto":"aprovado"'; then
  echo "OK   $(printf '%s\n' "$saida_d" | head -1)"
else
  echo "FALHOU — import nao declarado (bancada que passa por acidente)"; printf '%s\n' "$saida_d" | head -2; falhas=$((falhas+1))
fi

declarar "porta: importa contracts, nunca o core (RN-E1)"
maus=$(grep -rnE "^\s*(import|from)\s+.*core/" brokers/hyperliquid --include=*.ts 2>/dev/null | wc -l)
if [ "$maus" -eq 0 ]; then
  echo "OK   0 importacoes do core em brokers/hyperliquid"
else
  echo "FALHOU"; falhas=$((falhas+1))
fi

# 3. A BATERIA DE CONFORMIDADE: nove provas com o duble de mesa (a contagem sai da propria bateria,
#    que imprime `conformidade: N de N passaram`). O venue NAO entra aqui: as oito provas de SC-004
#    sao outra bateria, e esta diz que ficam INCOMPLETAS em vez de as dar por boas.
declarar "conformidade do conector (duble de mesa)"
saida_conf=$(bun tools/verificar-conector/conformidade.ts 2>&1); conf_rc=$?
if [ "$conf_rc" -eq 0 ] && printf '%s\n' "$saida_conf" | grep -qE "conformidade: [0-9]+ de [0-9]+ passaram"; then
  echo "OK   $(printf '%s\n' "$saida_conf" | grep -E "conformidade: " | tail -1)"
else
  echo "FALHOU (exit $conf_rc)"
  printf '%s\n' "$saida_conf" | grep -E "FALHA|REPROVOU|INCOMPLETO|conformidade:" | head -8
  falhas=$((falhas+1))
fi

# 4. A prova negativa: o corredor SABE reprovar?
#    Tres licoes ja pagas, dentro do codigo:
#    (a) a reposicao NAO depende do `git` — num ficheiro ainda nao commitado o `git checkout`
#        falha, o defeito fica la dentro e a prova seguinte mede-o. Guarda-se uma COPIA e a cura
#        prova-se por HASH: byte a byte;
#    (b) um defeito injectado num campo SEM caso nao e apanhado — e ha um caso por capacidade;
#    (c) vale para as DUAS baterias: o corredor de casos E a conformidade tem de reprovar com o
#        defeito dentro — um portao que nunca reprovou nao e um portao.
if [ "${1:-}" = "--prova-negativa" ]; then
  declarar "prova negativa: defeito injectado tem de reprovar"
  alvo="brokers/hyperliquid/manifesto.ts"
  copia=$(mktemp); cp "$alvo" "$copia"
  antes=$(sha256sum "$copia" | cut -d' ' -f1)
  if python3 "$(dirname "$0")/py/injectar-defeito.py" "$alvo"; then
    injetado=$(sha256sum "$alvo" | cut -d' ' -f1)
    if bun brokers/hyperliquid/casos/correr.ts >/dev/null 2>&1; then
      echo "FALHOU   o defeito passou despercebido — o corredor nao mede o que diz medir"
      falhas=$((falhas+1))
    else
      quantos=$(bun brokers/hyperliquid/casos/correr.ts 2>&1 | grep -c '"veredicto":"divergente"')
      echo "OK   o defeito foi apanhado ($quantos caso(s) divergente(s))"
    fi

    declarar "prova negativa: a conformidade reprova o defeito"
    conformidade_rc=0
    bun tools/verificar-conector/conformidade.ts >/dev/null 2>&1 || conformidade_rc=$?
    if [ "$conformidade_rc" -ne 0 ]; then
      provas_reprovadas=$(bun tools/verificar-conector/conformidade.ts 2>&1 | grep -cE "^(REPROVOU|INCOMPLETO)")
      echo "OK   a conformidade reprovou o defeito ($provas_reprovadas prova(s) nao passaram)"
    else
      echo "FALHOU — a conformidade PASSOU com o defeito dentro: nao mede o que diz medir"
      falhas=$((falhas+1))
    fi

    # A REPOSICAO E CONDICIONAL: se alguem escreveu no ficheiro enquanto o defeito la esteve (o
    # repositorio tem mais de uma bancada a trabalhar), repor a minha copia apagaria a escrita alheia.
    # Nesse caso NAO se repoe - diz-se.
    agora=$(sha256sum "$alvo" | cut -d' ' -f1)
    if [ "$agora" != "$injetado" ]; then
      echo "$(printf '%-52s' 'repor o original')RECUSADO — outro escritor tocou no ficheiro durante a prova; NAO reponho"
      falhas=$((falhas+1))
      rm -f "$copia"
    else
      cp "$copia" "$alvo"; rm -f "$copia"
      depois=$(sha256sum "$alvo" | cut -d' ' -f1)
      if [ "$antes" = "$depois" ]; then
        echo "$(printf '%-52s' 'curado: o reposto e byte a byte o original')OK   sha256 ${antes:0:12}..."
      else
        echo "$(printf '%-52s' 'curado: o reposto e byte a byte o original')FALHOU — a reposicao deixou o ficheiro diferente"
        falhas=$((falhas+1))
      fi
    fi
  else
    echo "RECUSADO  o fragmento da prova mudou — o ficheiro nao foi tocado"
    rm -f "$copia"; falhas=$((falhas+1))
  fi

  # ---- a SEGUNDA prova negativa: A RECONCILIACAO ANTES DO ENVIO (D-009) -----------------------------------
  # O defeito injectado e' o que a RN-C4 proibe: a leitura do registo de ordens deixa de ENCONTRAR a ordem, e uma
  # referencia repetida volta a produzir uma segunda ordem (foi o que a P6 da bateria de teste mediu, com a
  # posicao a dobrar). A prova exige o NOME DO CASO no vermelho — o processo pode cair por outra razao, e vermelho
  # sem nome nao mediu nada.
  declarar "prova negativa (D-009): a reconciliacao"
  alvo2="brokers/hyperliquid/conector.ts"
  copia2=$(mktemp); cp "$alvo2" "$copia2"
  antes2=$(sha256sum "$alvo2" | cut -d' ' -f1)
  if python3 "$(dirname "$0")/py/injectar-defeito-reconciliacao.py" "$alvo2"; then
    injetado2=$(sha256sum "$alvo2" | cut -d' ' -f1)
    saida2=$(bun run brokers/hyperliquid/processo.ts --bancada 2>&1); rc2=$?
    if [ "$rc2" -eq 0 ]; then
      echo "FALHOU   sem a reconciliacao a bancada PASSOU: nao mede o que diz medir"
      falhas=$((falhas+1))
    elif printf '%s\n' "$saida2" | grep -q "processo/reconciliacao-a-referencia-ja-produziu-ordem"; then
      echo "OK   o defeito foi REPROVADO e o caso nomeado: $(printf '%s\n' "$saida2" | grep -m1 'processo/reconciliacao-a-referencia-ja-produziu-ordem' | cut -c1-80)"
    else
      echo "FALHOU   vermelho, mas SEM nomear o caso — e' inconclusivo:"
      printf '%s\n' "$saida2" | tail -3 | sed 's/^/      /'
      falhas=$((falhas+1))
    fi

    # A reposicao: igual a de cima, e pelo mesmo motivo (outro escritor pode ter tocado no ficheiro).
    agora2=$(sha256sum "$alvo2" | cut -d' ' -f1)
    if [ "$agora2" != "$injetado2" ]; then
      echo "$(printf '%-52s' 'repor o original (conector)')RECUSADO — outro escritor tocou no ficheiro durante a prova; NAO reponho"
      falhas=$((falhas+1))
      rm -f "$copia2"
    else
      cp "$copia2" "$alvo2"; rm -f "$copia2"
      depois2=$(sha256sum "$alvo2" | cut -d' ' -f1)
      if [ "$antes2" = "$depois2" ]; then
        echo "$(printf '%-52s' 'curado: o reposto e byte a byte o original')OK   sha256 ${antes2:0:12}..."
      else
        echo "$(printf '%-52s' 'curado: o reposto e byte a byte o original')FALHOU — a reposicao deixou o ficheiro diferente"
        falhas=$((falhas+1))
      fi
    fi
  else
    echo "RECUSADO  o fragmento da prova mudou — o ficheiro nao foi tocado"
    rm -f "$copia2"; falhas=$((falhas+1))
  fi
fi

echo
if [ "$falhas" -eq 0 ]; then echo "provas offline do conector: 0 falhas"; else echo "provas offline do conector: $falhas falhas"; fi
exit "$falhas"
