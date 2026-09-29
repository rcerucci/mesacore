#!/bin/sh
# preparar-contas.sh — a entrevista que escreve a configuracao de uma conta.
#
# ESTE SCRIPT NAO SABE NADA DE NENHUM VENUE. Ele le os QUESTIONARIOS que os plugins publicam
# (brokers/*/questionario.json, setups/*/questionario.json) e segue o que la estiver escrito:
# quem escreve o plugin escreve o questionario. Acrescentar um venue = acrescentar um ficheiro,
# sem tocar aqui — e um plugin sem questionario faz o script RECUSAR, em vez de improvisar.
#
# O que ele garante, e que a bateria prova:
#   * o JSON e escrito pelo `jq` (nunca por concatenacao: um `"` ou um `$( )` num valor partiria o
#     ficheiro) e a escrita e ATOMICA (`mktemp` + `mv`, com `umask 077`);
#   * um campo de tipo `segredo` NUNCA entra no ficheiro: vai para $CREDENCIAIS/<conta>.key com modo
#     600 (pasta 700), lido com `read -rs` para nao passar pelo historico do shell, e o que fica na
#     configuracao e a REFERENCIA (`ficheiro:~/.config/...`);
#   * no fim corre o CONFERIDOR e mostra o veredicto — o script nao decide se esta bom;
#   * e idempotente: correr outra vez mostra o valor actual como omissao (Enter mantem).
#
# Uso:
#   sh tools/preparar-contas/preparar-contas.sh
#   sh tools/preparar-contas/preparar-contas.sh --conta config/contas/hl-teste-a.json
#   sh tools/preparar-contas/preparar-contas.sh --respostas r.json --sem-perguntas
# Opcoes: --raiz DIR  --config-dir DIR  --credenciais DIR  --conta FICHEIRO  --respostas FICHEIRO  --sem-perguntas

set -u

AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
cd "$RAIZ" || exit 2

CONFIG_DIR="config/contas"
CREDENCIAIS="${HOME}/.config/mesacore/credenciais"
CONTA=""
RESPOSTAS=""
SEM_PERGUNTAS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --raiz) RAIZ="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --credenciais) CREDENCIAIS="$2"; shift 2 ;;
    --conta) CONTA="$2"; shift 2 ;;
    --respostas) RESPOSTAS="$2"; SEM_PERGUNTAS=1; shift 2 ;;
    --sem-perguntas) SEM_PERGUNTAS=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "opcao desconhecida: $1" >&2; exit 2 ;;
  esac
done

dizer() { printf '%s\n' "$*"; }
recusar() { printf 'preparar-contas: RECUSADO — %s\n' "$*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || recusar "o jq e necessario para escrever o JSON (e ele que garante escaping e atomicidade)"

# ── 1. os questionarios publicados pelos plugins (medidos por comando, nao adivinhados) ─────
LISTA=$(for f in brokers/*/questionario.json setups/*/questionario.json; do [ -f "$f" ] && printf '%s\n' "$f"; done)
[ -n "$LISTA" ] || recusar "nenhum questionario publicado: procurei brokers/*/questionario.json e setups/*/questionario.json"

ESCOLHIDO=""
if [ -n "$RESPOSTAS" ]; then
  [ -f "$RESPOSTAS" ] || recusar "o ficheiro de respostas nao existe: $RESPOSTAS"
  case "$(cd "$(dirname "$RESPOSTAS")" && pwd)/$(basename "$RESPOSTAS")" in
    "$RAIZ"/*) recusar "o ficheiro de respostas nao pode viver dentro do repositorio (pode conter um segredo)" ;;
  esac
  ESCOLHIDO=$(jq -r '._questionario // empty' "$RESPOSTAS")
  [ -n "$ESCOLHIDO" ] || recusar "o ficheiro de respostas nao declara _questionario"
  [ -f "$ESCOLHIDO" ] || recusar "questionario apontado pelas respostas nao existe: $ESCOLHIDO"
else
  dizer "Questionarios publicados pelos plugins:"
  i=0
  for f in $LISTA; do
    i=$((i+1))
    dizer "  $i) $f  [$(jq -r '.tipo // "?"' "$f")]"
  done
  printf 'Qual deles vai ser configurado? (numero) '
  read -r escolha
  i=0
  for f in $LISTA; do
    i=$((i+1))
    [ "$escolha" = "$i" ] && ESCOLHIDO="$f"
  done
  [ -n "$ESCOLHIDO" ] || recusar "escolha invalida"
fi

# ── 2. o questionario e contrato: valida-se antes de o seguir ───────────────────────────────
jq -e . "$ESCOLHIDO" >/dev/null 2>&1 || recusar "questionario ilegivel: $ESCOLHIDO"
# Um campo `segredo` sem destino declarado e recusado AQUI: e esta regra que impede alguem
# escrever um questionario que guarde uma chave no ficheiro de configuracao.
MAU=$(jq -r '[.perguntas[], (.ficha_do_instrumento.perguntas // [])[]]
  | map(select(.tipo == "segredo" and (.destino // "") != "ficheiro_de_credencial"))
  | length' "$ESCOLHIDO")
[ "$MAU" = "0" ] || recusar "o questionario $ESCOLHIDO tem $MAU campo(s) de segredo sem destino 'ficheiro_de_credencial' — um segredo so pode ir para o ficheiro de credencial protegido"

# ── 3. a entrevista ─────────────────────────────────────────────────────────────────────────
PARES='[]'          # [[caminho...], valor] — o que vira configuracao
SEGREDO=""
CAMINHO_DO_SEGREDO=""

# o que o questionario preenche sozinho (verdade do plugin, nao do dono): grava-se antes da primeira pergunta
for _k in $(jq -r '.preenche_sempre // {} | keys[]' "$ESCOLHIDO" 2>/dev/null); do
  case "$_k" in nota) continue ;; esac
  _pj=$(printf '%s' "$_k" | jq -Rc 'split(".")')
  _v=$(jq -c --arg k "$_k" '.preenche_sempre[$k]' "$ESCOLHIDO")
  [ -n "$_pj" ] && [ -n "$_v" ] && [ "$_v" != "null" ] || recusar "preenche_sempre invalido em '$_k'"
  PARES=$(printf '%s' "$PARES" | jq -c --argjson p "$_pj" --argjson v "$_v" '. + [[$p, $v]]') \
    || recusar "nao consegui acrescentar '$_k' a configuracao" 
done

perguntar() {  # $1=id $2=chave $3=tipo $4=pergunta $5=explicacao $6=opcional $7=opcoes json $8=instrumento
  _id=$1; _chave=$2; _tipo=$3; _pergunta=$4; _explicacao=$5; _opcional=$6; _opcoes=$7; _instr=$8
  _padrao=""
  if [ -n "$CONTA" ] && [ -f "$CONTA" ]; then
    _pj=$(printf '%s' "$_chave" | jq -Rc 'split(".")')
    _padrao=$(jq -r --argjson p "$_pj" 'getpath($p) // empty | if type == "array" then join(",") else tostring end' "$CONTA" 2>/dev/null)
  fi
  if [ -n "$RESPOSTAS" ]; then
    # com mais de um instrumento, a resposta por instrumento usa a chave id@instrumento; sem ela, cai no id simples
    _resp=$(jq -r --arg id "$_id" --arg i "$_instr" 'if ($i != "" and (.[$id + "@" + $i] != null)) then .[$id + "@" + $i] else (.[$id] // empty) end' "$RESPOSTAS")
  else
    dizer ""
    dizer "── $_pergunta"
    dizer "   $_explicacao"
    [ -n "$_opcoes" ] && [ "$_opcoes" != "null" ] && dizer "   opcoes: $(printf '%s' "$_opcoes" | jq -r 'join(" | ")')"
    if [ "$_tipo" = "segredo" ]; then
      printf '   valor (nao sera mostrado): '
      stty -echo 2>/dev/null; read -r _resp; stty echo 2>/dev/null; dizer ""
    else
      [ -n "$_padrao" ] && _dica=" [$_padrao]" || _dica=""
      printf '   resposta%s: ' "$_dica"
      read -r _resp
    fi
  fi
  [ -n "$_resp" ] || _resp="$_padrao"
  if [ -z "$_resp" ]; then
    # uma pergunta opcional sem resposta significa «nao declaro» — e o conferidor sabe ler a ausencia.
    # Uma obrigatoria sem resposta RECUSA: nao se inventa um valor para uma decisao do dono.
    [ "$_opcional" = "true" ] && { _resp=""; return 2; }
    recusar "a pergunta '$_id' ficou sem resposta (e obrigatoria)"
  fi
  return 0
}

guardar() {  # $1=id $2=chave $3=tipo $4=valor $5=opcoes
  _chave=$2; _tipo=$3; _valor=$4; _opcoes=$5
  case "$_tipo" in
    lista)
      _json=$(printf '%s' "$_valor" | jq -Rc 'split(",") | map(gsub("^ +| +$";"")) | map(select(length > 0))') ;;
    segredo) _json="__SEGREDO__" ;;
    *) _json=$(printf '%s' "$_valor" | jq -Rc '.') ;;
  esac
  if [ "$_json" = "__SEGREDO__" ]; then
    SEGREDO="$_valor"; CAMINHO_DO_SEGREDO="$_chave"
    return 0
  fi
  _pj=$(printf '%s' "$_chave" | jq -Rc 'split(".")')
  [ -n "$_pj" ] || recusar "chave invalida no questionario: '$_chave' (nao consigo partir em caminho)"
  [ -n "$_json" ] || recusar "pergunta '$_id': o jq devolveu vazio para a chave '$_chave' com o valor '$_valor'"
  PARES=$(printf '%s' "$PARES" | jq -c --argjson p "$_pj" --argjson v "$_json" '. + [[$p, $v]]') \
    || recusar "nao consegui acrescentar '$_chave' a configuracao"
}

correr_perguntas() {  # $1=ficheiro de perguntas dentro do questionario, $2=prefixo de instrumento
  # A lista de perguntas e lida UMA vez, como dado. Montar filtros jq por concatenacao de texto foi
  # um defeito real deste script: as aspas vazias do `// ""` fechavam o filtro dentro do sh.
  _lista=$(jq -c "$1" "$ESCOLHIDO")
  _instr="${2:-}"
  _n=$(printf '%s' "$_lista" | jq 'length')
  _i=0
  while [ "$_i" -lt "$_n" ]; do
    _q=$(printf '%s' "$_lista" | jq -c --argjson i "$_i" '.[$i]')
    _id=$(printf '%s' "$_q" | jq -r '.id')
    _chave=$(printf '%s' "$_q" | jq -r '.chave')
    _tipo=$(printf '%s' "$_q" | jq -r '.tipo')
    _pergunta=$(printf '%s' "$_q" | jq -r '.pergunta')
    _explicacao=$(printf '%s' "$_q" | jq -r '.explicacao // ""')
    _opcoes=$(printf '%s' "$_q" | jq -c '.opcoes // null')
    _opcional=$(printf '%s' "$_q" | jq -r '.opcional // false')
    [ -n "$_instr" ] && _chave=$(printf '%s' "$_chave" | sed "s/<instrumento>/$_instr/")
    if perguntar "$_id" "$_chave" "$_tipo" "$_pergunta" "$_explicacao" "$_opcional" "$_opcoes" "$_instr"; then
      guardar "$_id" "$_chave" "$_tipo" "$_resp" "$_opcoes"
    fi
    _i=$((_i+1))
  done
}

# o nome da conta define o ficheiro e a chave
if [ -n "$RESPOSTAS" ]; then
  NOME_CONTA=$(jq -r '.nome_da_conta // empty' "$RESPOSTAS")
else
  NOME_CONTA=$(jq -r '.conta_de_exemplo // "conta"' "$ESCOLHIDO")
  dizer ""
  dizer "── Que nome quer dar a esta conta? (vira config/contas/<nome>.json e a chave em $CREDENCIAIS/<nome>.key)"
  printf '   nome [%s]: ' "$NOME_CONTA"
  read -r _n
  [ -n "$_n" ] && NOME_CONTA="$_n"
fi
[ -n "$NOME_CONTA" ] || recusar "a conta ficou sem nome"
case "$NOME_CONTA" in */*|.*) recusar "nome de conta invalido: $NOME_CONTA" ;; esac

[ -n "$CONTA" ] || CONTA="$CONFIG_DIR/$NOME_CONTA.json"

# o nome_da_conta ja foi respondido acima; a lista de instrumentos vem antes das fichas
correr_perguntas '.perguntas | map(select(.id != "nome_da_conta" and .id != "instrumentos"))'
# a lista de instrumentos, que manda nas fichas
_id="instrumentos"; _chave=$(jq -r '.perguntas[] | select(.id=="instrumentos") | .chave' "$ESCOLHIDO")
_pergunta=$(jq -r '.perguntas[] | select(.id=="instrumentos") | .pergunta' "$ESCOLHIDO")
_explicacao=$(jq -r '.perguntas[] | select(.id=="instrumentos") | .explicacao // ""' "$ESCOLHIDO")
if [ -n "$RESPOSTAS" ]; then _resp=$(jq -r '.instrumentos // empty' "$RESPOSTAS"); else
  dizer ""; dizer "── $_pergunta"; dizer "   $_explicacao"; printf '   resposta: '; read -r _resp
fi
[ -n "$_resp" ] || recusar "sem instrumentos nao ha ficha nenhuma para preencher"
guardar "$_id" "$_chave" "lista" "$_resp" "null"
LISTA_INSTRUMENTOS=$(printf '%s' "$PARES" | jq -r '.[] | select(.[0] == ["conta","instrumentos"]) | .[1] | join(" ")')

# a ficha, uma vez por instrumento
for _instr in $LISTA_INSTRUMENTOS; do
  correr_perguntas '.ficha_do_instrumento.perguntas' "$_instr"
done

# ── 4. o segredo: para o ficheiro protegido; na configuracao fica a REFERENCIA ──────────────
if [ -n "$SEGREDO" ]; then
  (umask 077; mkdir -p "$CREDENCIAIS" && chmod 700 "$CREDENCIAIS")
  CAMINHO_CHAVE="$CREDENCIAIS/$NOME_CONTA.key"
  (umask 077; printf '%s' "$SEGREDO" > "$CAMINHO_CHAVE")
  chmod 600 "$CAMINHO_CHAVE"
  SEGREDO=""
  _pj=$(printf '%s' "$CAMINHO_DO_SEGREDO" | jq -Rc 'split(".")')
  _ref="ficheiro:$CAMINHO_CHAVE"
  PARES=$(printf '%s' "$PARES" | jq -c --argjson p "$_pj" --arg v "$_ref" '. + [[$p, $v]]')
  dizer "   chave gravada em $CAMINHO_CHAVE (modo $(stat -c '%a' "$CAMINHO_CHAVE"))"
fi

# ── 5. escrever a configuracao (atomica) e julgar ───────────────────────────────────────────
mkdir -p "$CONFIG_DIR" || recusar "nao consegui criar $CONFIG_DIR"
TMP=$(mktemp "${TMPDIR:-/tmp}/preparar-contas.XXXXXX") || recusar "mktemp falhou"
(umask 077; printf '%s' "$PARES" | jq 'reduce .[] as $p ({}; setpath($p[0]; $p[1]))' > "$TMP") || recusar "jq falhou a montar a configuracao"
mv "$TMP" "$CONTA" || recusar "nao consegui escrever $CONTA"
dizer ""
dizer "configuracao escrita: $CONTA"

dizer ""
dizer "── o conferidor julga (o script nao decide se esta bom):"
bun tools/verificar-config/conferir-config.ts "$CONTA"
CODIGO=$?
if [ "$CODIGO" -ne 0 ]; then
  dizer ""
  dizer "O ficheiro ficou gravado, mas o conferidor RECUSA — corrija o que esta acima e corra outra vez"
  exit 1
fi
dizer ""
dizer "A conta esta configurada. A configuracao nao tem nenhum valor de chave: a chave esta em $CREDENCIAIS."
