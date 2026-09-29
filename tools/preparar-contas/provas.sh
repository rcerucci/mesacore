#!/bin/sh
# As provas do preparar-contas. Quatro coisas que ele promete, medidas uma a uma:
#   1. o ficheiro que ele escreve PASSA no conferidor;
#   2. a chave fica num ficheiro com modo 600, FORA do repositorio;
#   3. o valor da chave NAO aparece na configuracao (nem em ficheiro versionado nenhum) — o que
#      aparece e a REFERENCIA;
#   4. um questionario que declare um segredo sem destino de credencial e RECUSADO — e esta regra
#      que impede alguem escrever um questionario que guarde a chave no ficheiro de conta.
#
# Corre sempre, sem rede, contra um directorio temporario (TMPDIR). Nenhum segredo real entra aqui:
# a «chave» de prova e uma string inventada que nao existe em ficheiro versionado nenhum.

set -u
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
CASA=$(mktemp -d "${TMPDIR:-/tmp}/preparar-contas-prova.XXXXXX") || exit 2
FALHAS=0
CHAVE_FALSA="0xf0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f"

limpar() { rm -rf "$CASA"; }
trap limpar EXIT

prova() { printf '%-62s' "$1"; }
ok()    { printf 'OK   %s\n' "$1"; }
falhou(){ printf 'FALHOU  %s\n' "$1"; FALHAS=$((FALHAS+1)); }

ESPERADO="$RAIZ/brokers/hyperliquid/questionario.json"
cat > "$CASA/respostas.json" <<EOF
{
  "_questionario": "$ESPERADO",
  "nome_da_conta": "conta-de-prova",
  "identificador": "0x1111111111111111111111111111111111111111",
  "ambiente": "teste",
  "url_da_api": "https://api.hyperliquid-testnet.xyz",
  "credencial": "conta-de-prova",
  "chave_privada": "$CHAVE_FALSA",
  "perda_maxima_pct": "5",
  "perda_maxima_janela": "corrida_da_mesa",
  "margem_total_maxima_pct": "100",
  "contencao": "recusar",
  "arranque_apos_cb": "exige_decisao",
  "eventos_que_avisam": "cb,encerramento,desconhecido,recusa,divergencia,falha_de_leitura,contenda",
  "retencao_dias_integral": "90",
  "retencao_depois": "resumo_diario",
  "instrumentos": "BTC",
  "versao_do_mandato": "2026-09-29-a",
  "saldo_pct": "1",
  "alavancagem": "3",
  "stop_pct": "1.5",
  "tp_pct": "3",
  "parcial": "o_que_der",
  "desvio_maximo": "0.5",
  "destino_do_resto": "cancelar",
  "prazo_da_passiva_ms": "30000",
  "versao_do_setup": "2026-09-29",
  "prazo_de_resposta_ms": "600000"
}
EOF

CFG="$CASA/config"
CRED="$CASA/credenciais"
SAIDA=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas.json" --config-dir "$CFG" --credenciais "$CRED" 2>&1)
CODIGO=$?

prova "1. o script corre e o conferidor aprova o ficheiro"
if [ "$CODIGO" -eq 0 ] && printf '%s' "$SAIDA" | grep -q "conferidor: aprovado"; then
  ok "$(printf '%s' "$SAIDA" | grep 'conferidor:' | tail -1)"
else
  falhou "exit=$CODIGO"; printf '%s\n' "$SAIDA" | tail -6
fi

prova "2. a chave ficou fora do repositorio, com modo 600"
if [ -f "$CRED/conta-de-prova.key" ] && [ "$(stat -c '%a' "$CRED/conta-de-prova.key")" = "600" ] && [ "$(cat "$CRED/conta-de-prova.key")" = "$CHAVE_FALSA" ]; then
  ok "modo $(stat -c '%a' "$CRED/conta-de-prova.key") · pasta $(stat -c '%a' "$CRED") · $CRED"
else
  falhou "ficheiro ausente, modo errado, ou conteudo diferente"
fi

prova "3. a configuracao traz a REFERENCIA, nunca o valor"
if [ -f "$CFG/conta-de-prova.json" ] && grep -q '"ficheiro:' "$CFG/conta-de-prova.json" && ! grep -q "$CHAVE_FALSA" "$CFG/conta-de-prova.json"; then
  # A «chave» de prova vive no proprio ficheiro da bateria (versionado, e inventada) — e a UNICA
  # excepcao ao varrimento. Fora dele, o valor nao pode aparecer em ficheiro versionado nenhum.
  if git -C "$RAIZ" grep -qF "$CHAVE_FALSA" -- . ':(exclude)tools/preparar-contas/provas.sh' 2>/dev/null; then
    falhou "o valor da chave aparece num ficheiro VERSIONADO do repositorio"
  else
    ok "referencia presente, valor ausente da configuracao e do repositorio"
  fi
else
  falhou "a configuracao nao traz a referencia, ou traz o valor"
fi

prova "4. questionario com segredo sem destino e RECUSADO"
cat > "$CASA/mau-questionario.json" <<'EOF'
{
  "plugin": "teste", "tipo": "conector", "versao_do_questionario": "1.0.0",
  "perguntas": [
    { "id": "chave_privada", "chave": "conexao.credencial.valor", "tipo": "segredo", "obrigatorio": true,
      "pergunta": "Cole a chave aqui", "explicacao": "um questionario assim guardaria a chave no ficheiro de conta" }
  ]
}
EOF
cat > "$CASA/respostas-mau.json" <<EOF
{ "_questionario": "$CASA/mau-questionario.json", "chave_privada": "$CHAVE_FALSA" }
EOF
SAIDA_MAU=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-mau.json" --config-dir "$CASA/config2" --credenciais "$CASA/cred2" 2>&1)
if printf '%s' "$SAIDA_MAU" | grep -q "RECUSADO" && [ ! -f "$CASA/config2/teste.json" ]; then
  ok "$(printf '%s' "$SAIDA_MAU" | grep 'RECUSADO' | head -1 | cut -c1-90)"
else
  falhou "o questionario mau passou"; printf '%s\n' "$SAIDA_MAU" | tail -3
fi

# 5. o caso que o dono apanhou em campo: responder so com Enter. Toda pergunta que DECLARA uma omissao
#    tem de aceita-la — o prompt promete-o («Enter aceita a lista completa») e a promessa tem de ser
#    verdade. Aqui omite-se tudo o que tem omissao no questionario e exige-se um ficheiro valido no fim.
prova "5. responder so com Enter (as omissoes do questionario) produz valido"
cat > "$CASA/respostas-enter.json" <<EOF
{
  "_questionario": "$ESPERADO",
  "identificador": "0x2222222222222222222222222222222222222222",
  "chave_privada": "$CHAVE_FALSA",
  "instrumentos": "BTC",
  "retencao_dias_integral": "90",
  "retencao_depois": "resumo_diario",
  "versao_do_mandato": "2026-09-29-a",
  "saldo_pct": "1",
  "alavancagem": "3",
  "stop_pct": "1.5",
  "tp_pct": "3",
  "desvio_maximo": "0.5",
  "prazo_da_passiva_ms": "30000",
  "versao_do_setup": "2026-09-29",
  "prazo_de_resposta_ms": "600000"
}
EOF
SAIDA_E=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-enter.json" --config-dir "$CASA/config-enter" --credenciais "$CASA/cred-enter" 2>&1)
CODIGO_E=$?
if [ "$CODIGO_E" -eq 0 ] && printf '%s' "$SAIDA_E" | grep -q "conferidor: aprovado"; then
  # e as omissoes tem de estar LA, nao vazias: prova-se lendo o ficheiro
  ALVO="$CASA/config-enter/hl-teste-a.json"
  VAL=$(jq -r '.conta.eventos_que_avisam | length' "$ALVO" 2>/dev/null)
  NOME=$(jq -r '.conta.credencial' "$ALVO" 2>/dev/null)
  if [ "$VAL" = "7" ] && [ "$NOME" = "hl-teste-a" ]; then
    ok "omissoes aplicadas (7 eventos, credencial=$NOME)"
  else
    falhou "as omissoes nao foram aplicadas (eventos=$VAL, credencial=$NOME)"
  fi
else
  falhou "exit=$CODIGO_E"; printf '%s\n' "$SAIDA_E" | tail -4
fi

# 6. o fluxo do SETUP: escreve UMA ficha (um instrumento) na conta que ja existe, e nao toca no resto.
#    E a fronteira que o dono corrigiu: o conector sobe com a conta; o stop de 5% no BTC e o de 8% no ETH
#    sao fichas de instrumento, criadas pelo setup, uma a uma.
prova "6. o setup escreve uma ficha e preserva a conta"
cat > "$CASA/respostas-setup.json" <<EOF
{
  "_questionario": "$RAIZ/setups/exemplo-cruzamento-de-media/questionario.json",
  "conta_alvo": "conta-de-prova",
  "instrumento": "BTC",
  "versao_do_mandato": "2026-09-29-a",
  "saldo_pct": "1",
  "alavancagem": "3",
  "stop_pct": "5",
  "tp_pct": "3",
  "desvio_maximo": "0.5",
  "prazo_da_passiva_ms": "30000",
  "prazo_de_resposta_ms": "600000"
}
EOF
# o manifesto do venue e o que diz quais instrumentos existem (a API responde por pedido)
cat > "$CASA/manifesto.json" <<'EOF'
{ "conector": "hyperliquid", "instrumentos": ["BTC", "ETH"] }
EOF
SAIDA_S=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-setup.json" --config-dir "$CFG" --credenciais "$CRED" --manifesto "$CASA/manifesto.json" 2>&1)
CODIGO_S=$?
ALVO_S="$CFG/conta-de-prova.json"
if [ "$CODIGO_S" -eq 0 ] && printf '%s' "$SAIDA_S" | grep -q "conferidor: aprovado"; then
  ST=$(jq -r '.fichas.BTC.risco.stop_pct' "$ALVO_S" 2>/dev/null)
  MC=$(jq -r '.fichas.BTC.setup.media_curta' "$ALVO_S" 2>/dev/null)
  CHEIO=$(jq -r '.conta.identificador' "$ALVO_S" 2>/dev/null)
  REF=$(jq -r '.conexao.credencial.valor_em' "$ALVO_S" 2>/dev/null)
  if [ "$ST" = "5" ] && [ "$MC" = "9" ] && [ -n "$CHEIO" ] && [ -n "$REF" ]; then
    ok "ficha BTC (stop=$ST, media_curta=$MC) na conta, e a conta intacta"
  else
    falhou "a ficha entrou mal, ou a conta foi alterada (stop=$ST media=$MC ident=$CHEIO ref=$REF)"
  fi
else
  falhou "exit=$CODIGO_S"; printf '%s\n' "$SAIDA_S" | tail -4
fi

prova "7. o setup RECUSA se a conta nao existir (o setup nao cria contas)"
SAIDA_N=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-setup.json" --config-dir "$CASA/vazio" --credenciais "$CRED" 2>&1)
if printf '%s' "$SAIDA_N" | grep -q "nenhuma conta configurada"; then ok "$(printf '%s' "$SAIDA_N" | grep RECUSADO | cut -c1-70)"; else falhou "o setup criou conta"; fi

prova "8. sem manifesto e sem restricao, o setup RECUSA (nao inventa instrumentos)"
SAIDA_I=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-setup.json" --config-dir "$CFG" --credenciais "$CRED" --manifesto "$CASA/nao-existe.json" 2>&1)
if printf '%s' "$SAIDA_I" | grep -q "nao sei que instrumentos"; then ok "$(printf '%s' "$SAIDA_I" | grep RECUSADO | cut -c1-72)"; else falhou "inventou instrumentos"; fi

prova "9. editar UM valor sem perguntas preserva o resto do ficheiro"
cat > "$CASA/respostas-editar.json" <<EOF
{ "_questionario": "$ESPERADO", "perda_maxima_pct": "7" }
EOF
SAIDA_D=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-editar.json" --conta "$CFG/conta-de-prova.json" 2>&1)
CODIGO_D=$?
if [ "$CODIGO_D" -eq 0 ] && printf '%s' "$SAIDA_D" | grep -q "conferidor: aprovado"; then
  P7=$(jq -r '.conta.perda_maxima_pct' "$CFG/conta-de-prova.json")
  ID=$(jq -r '.conta.identificador' "$CFG/conta-de-prova.json")
  RF=$(jq -r '.conexao.credencial.valor_em' "$CFG/conta-de-prova.json")
  FM=$(jq -r '.conta.retencao_ledger.depois' "$CFG/conta-de-prova.json")
  if [ "$P7" = "7" ] && [ -n "$ID" ] && [ -n "$RF" ] && [ "$FM" = "resumo_diario" ]; then
    ok "perda=7, e o resto intacto (identificador, referencia da chave, retencao)"
  else
    falhou "perda=$P7 ident=$ID ref=$RF retencao=$FM"
  fi
else
  falhou "exit=$CODIGO_D"; printf '%s\n' "$SAIDA_D" | tail -4
fi

prova "10. editar com Enter na chave NAO toca no ficheiro de credencial"
H_ANTES=$(sha256sum "$CRED/conta-de-prova.key" | cut -d" " -f1)
cat > "$CASA/respostas-enter-chave.json" <<EOF
{ "_questionario": "$ESPERADO", "margem_total_maxima_pct": "80", "chave_privada": "" }
EOF
SAIDA_C=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-enter-chave.json" --conta "$CFG/conta-de-prova.json" 2>&1)
H_DEPOIS=$(sha256sum "$CRED/conta-de-prova.key" | cut -d" " -f1)
MM=$(jq -r '.conta.margem_total_maxima_pct' "$CFG/conta-de-prova.json" 2>/dev/null)
if [ "$H_ANTES" = "$H_DEPOIS" ] && [ "$MM" = "80" ] && ! grep -q "ficheiro:" "$CRED/conta-de-prova.key"; then
  ok "chave intacta (sha256 igual) e a margem mudou para $MM"
else
  falhou "a chave foi tocada, ou a margem nao mudou (margem=$MM)"
fi

prova "11. --conta sem valor lista as contas existentes (ou RECUSA dizendo-as)"
SAIDA_L=$(sh "$AQUI/preparar-contas.sh" --sem-perguntas --respostas "$CASA/respostas-editar.json" --conta --config-dir "$CFG" 2>&1)
if printf '%s' "$SAIDA_L" | grep -q "diga qual das contas existentes: conta-de-prova"; then
  ok "$(printf '%s' "$SAIDA_L" | grep RECUSADO | cut -c1-78)"
else
  falhou "nao listou as contas: $(printf '%s' "$SAIDA_L" | tail -1 | cut -c1-70)"
fi

prova "12. escolher a conta pelo numero, e Enter em tudo o resto, mantem o ficheiro"
H_ANTES=$(jq -S . "$CFG/conta-de-prova.json" | sha256sum | cut -d" " -f1)
SAIDA_M=$( { printf '1\n'; for i in $(seq 1 25); do printf '\n'; done; } | sh "$AQUI/preparar-contas.sh" --conta --config-dir "$CFG" 2>&1 )
H_DEPOIS=$(jq -S . "$CFG/conta-de-prova.json" | sha256sum | cut -d" " -f1)
if [ "$H_ANTES" = "$H_DEPOIS" ] && printf '%s' "$SAIDA_M" | grep -q "Contas configuradas:"; then
  ok "listou e escolheu pelo numero; todos os valores mantidos (Enter)"
else
  falhou "ficheiro mudou=$( [ "$H_ANTES" = "$H_DEPOIS" ] && echo nao || echo sim ); listou=$(printf '%s' "$SAIDA_M" | grep -c 'Contas configuradas:')"
fi

printf '\npreparar-contas: %s falha(s)\n' "$FALHAS"
[ "$FALHAS" -eq 0 ] || exit 1
