#!/usr/bin/env bash
# A porta unica da maquina: corre TUDO o que prova o recorte 002, e sai 1 se alguma coisa falhar.
#
# Existe porque "corri as baterias" e uma frase que nao se verifica. Uma porta so, com uma saida so:
# ou passa, ou nao passa - e quando nao passa, diz qual.
#
# Uso:  bash tools/verificar-maquina/provar.sh [--rapido]
#       --rapido  salta a bateria do contrato (001), que e a mais lenta

set -u
cd "$(dirname "$0")/../.." || exit 1
RAIZ="$(pwd)"
RAPIDO=0
[ "${1:-}" = "--rapido" ] && RAPIDO=1

# ---------------------------------------------------------------------------------------------
# UMA BATERIA DE CADA VEZ. Duas ao mesmo tempo pisam-se: a prova negativa da frescura reescreve
# ficheiros gerados e o vigia escreve estado de runtime — e a segunda mede a sujeira da primeira.
# Quem chega depois RECUSA: nao espera, nao corre a meias. Uma bateria mede-se com o repositorio
# so para ela (foi assim que uma corrida concorrente deu "fronteira: 1 falhas" em codigo verde).
# A trava e um pid: se o processo ja morreu, a trava velha e limpa em vez de bloquear para sempre.
TRAVA=".provar.lock"
if [ -f "$TRAVA" ]; then
  outro=$(cat "$TRAVA" 2>/dev/null || echo "")
  if [ -n "$outro" ] && kill -0 "$outro" 2>/dev/null; then
    echo "provar: RECUSADO — outra bateria esta a correr (pid $outro); uma bateria mede-se sozinha"
    exit 1
  fi
  echo "provar: (trava do pid $outro, que ja nao existe — a limpar)"
fi
echo $$ > "$TRAVA"
trap 'rm -f "$TRAVA"' EXIT

falhas=0
corridas=0
declarar() {
  local nome="$1"; shift
  printf '%-42s ' "$nome"
  saida="$("$@" 2>&1)"
  if [ $? -eq 0 ]; then
    corridas=$((corridas + 1))
    echo "OK   $(echo "$saida" | tail -1)"
  else
    corridas=$((corridas + 1))
    falhas=$((falhas + 1))
    echo "FALHOU"
    echo "$saida" | tail -6 | sed 's/^/      /'
  fi
}

echo "=== a maquina dos recortes 001-003, do principio ao fim ==="
echo

declarar "tabela de transicoes"          bun run tools/verificar-maquina/tabela.ts
declarar "porteiro do estado (negativo)" bun run tools/verificar-maquina/tabela.ts --prova-negativa
declarar "a mesa (maquina + marcas)"     bun run core/mesa.prova.ts
declarar "maquina de estados"            bun run core/estados/provar.ts
declarar "condicoes, ciclo, desfecho"    bun run core/ciclo/provar.ts
declarar "arranque (sete portas)"        bun run tools/verificar-maquina/arranque.ts
declarar "tipos (tsc)"                   bash tools/verificar-maquina/tipos.sh
declarar "sessao e CB"                   bun run tools/verificar-maquina/sessao.ts
declarar "pausa e encerramento"          bun run tools/verificar-maquina/pausa.ts
declarar "registo (SC-011)"               bun run tools/verificar-maquina/registo.ts
# O REGISTO DO VIGIA: ausente e' novo, ilegivel e' RECUSA — e a recusa vale para a gravacao (o dia da
# operacao nao se apaga por cima). Esteve fora da porta desde que existe: era o unico ficheiro do vigia
# que lia o ilegivel como ausente (medido 01/10/2026).
declarar "registo do vigia (ausente x ilegivel)" bun run tools/verificar-maquina/registo-do-vigia.ts
declarar "retencao do ledger (RN-L6)"    bun run core/estado/retencao.prova.ts
declarar "contenda (T066)"      bun run tools/verificar-maquina/contenda.ts  "resumo"
declarar "chaves do core (SC-012)"       bun run tools/verificar-maquina/chaves.ts
declarar "porteiro do estado (script)"   bash tools/verificar-maquina/porteiro-do-estado.sh
declarar "marcas sobrevivem ao reinicio" bash tools/verificar-maquina/reiniciar.sh
declarar "porta da mesa (T014-T016)"      bun run tools/verificar-maquina/servidor.ts
declarar "preparar contas (script + questionario)" bash tools/preparar-contas/provas.sh
declarar "conector hyperliquid (offline, US1)" bash tools/verificar-conector/provas-offline.sh
# O CAMINHO DO ENVIO faltava na porta unica: as 38 provas da porta de processo do conector (tradutor, precos,
# assinatura, as 8 portas do arranque) so corriam quando alguem se lembrava de as chamar. Um caminho que mexe
# em dinheiro fora do portao e um caminho que pode regredir sem ninguem dar por isso (medido 29/09/2026).
declarar "envio do conector (38 casos)"   bun run brokers/hyperliquid/processo.ts --bancada
# O UNICO SETUP do repositorio e' o `sigma`: os moldes de exemplo (`cruzamento_de_media`, TS e Python) foram
# retirados a pedido do dono (30/09/2026), e a bancada que os corria foi com eles. O que fica em pe' para o
# setup e' o que interessa: a traducao do indicador e a regra da entrada (as duas bancadas abaixo).
# A TRADUCAO DO INDICADOR entra na porta: o motor tem de fazer o mesmo que o `sign(mid - MA) + ZZ` do Pine em
# TODAS as combinacoes de `input`, e nao so' nas omissoes. Foi aqui que se apanhou o `na` do ATR (medido
# 30/09/2026: o motor calava-se nas primeiras 13 barras de 505, onde o grafico ja' tinha lado).
declarar "Pine x motor (todas as opcoes)" bash -c "cd contracts && uv run python ../tools/verificar-setup/varredura-pine.py"
# A REGRA DA ENTRADA (regra do dono, 30/09/2026): a entrada so' acontece na barra do FLIP — nao se abre no meio da
# perna, e uma ordem fechada a mao so' reabre no proximo flip. Sao oito casos, com as barras reais truncadas de
# proposito para que a ultima barra fechada seja (ou nao seja) a barra de uma viragem.
declarar "sigma: entrada so' no flip (10 casos)" bash -c "cd contracts && uv run python ../tools/verificar-setup/sigma-casos.py"
# AS FICHAS conferidas contra o que o sistema LE': as tres regras de identidade, os tipos (D4: o numero viaja em
# TEXTO) e a forma das bandas — e, sobretudo, a chave que NINGUEM le': «chave que ninguem le e' lixo» (o criterio
# do proprio inventario), com as que estao a espera de decisao do dono reportadas em vez de escondidas.
declarar "fichas (cabecalho, tipos, lixo)" python3 tools/verificar-setup/fichas.py

# As bancadas da camada de OPERACAO (003): correm processos a serio (vigia + mesa), por isso ficam na porta
# completa - a `--rapido` e a que se corre a cada passo.
if [ "$RAPIDO" -eq 0 ]; then
  declarar "vigia + mesa (--arranque)"     bash tools/verificar-maquina/vigia.sh --arranque
  declarar "vigia: orfandade (--orfandade)" bash tools/verificar-maquina/vigia.sh --orfandade
  declarar "encerramento (--encerramento)" bash tools/verificar-maquina/vigia.sh --encerramento
  declarar "verbos (--verbos, T044)"       bash tools/verificar-maquina/vigia.sh --verbos
  declarar "contrato neutro (recorte 001)" bash tools/verificar-contrato/ponta-a-ponta.sh
  declarar "frescura do contrato"          bash tools/verificar-contrato/frescura.sh
  declarar "frescura (prova negativa, T057)" bash tools/verificar-contrato/frescura.sh --prova-negativa
  declarar "fallbacks (ZERO exigido)"          bash -c "cd contracts && uv run python ../tools/verificar-contrato/py/fallbacks.py --exigir-zero"
declarar "fronteira (SC-003, T046-T049)" bash tools/verificar-contrato/fronteira.sh
  declarar "duble de mesa (US6, SC-004)"   bash tools/verificar-contrato/duble-de-mesa.sh
  declarar "inventario de chaves (SC-012)" bash tools/verificar-contrato/inventario.sh
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "provar: $corridas de $corridas passaram — a maquina decide o que devia, e explica o que nao fez"
  exit 0
fi
echo "provar: $falhas de $corridas FALHARAM"
exit 1
