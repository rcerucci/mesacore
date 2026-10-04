#!/usr/bin/env bash
# Guarda (ou confere) as credenciais do conector cTrader — um valor por ficheiro, como manda a casa.
#
# PORQUE E' UM FICHEIRO E NAO UMA LINHA PARA COLAR. Dar ao dono um bloco de comandos com `read` la' dentro e'
# um convite ao desastre: o `read` que pede o valor ENGOLE as linhas seguintes do proprio bloco, e o que fica
# gravado e' texto de comando em vez do valor (medido a 01/10/2026: dois ficheiros com 56 e 50 bytes de lixo).
# Aqui o que se cola e' SO' o valor: os comandos estao no disco, e nada compete com o prompt.
#
# O valor nunca aparece no ecra (o `read -s`), nunca passa por um argumento de comando (logo nao fica no
# historico do shell nem no `ps`), e nunca e' impresso por este programa. O que ele mostra e' a FORMA do valor
# (comprimento e os primeiros caracteres) para o dono confirmar antes de gravar.
#
# Uso:
#   bash tools/guardar-credencial.sh conferir          # o que ja' esta' gravado (sem mostrar valores)
#   bash tools/guardar-credencial.sh gravar <campo>    # pede o valor, mostra a forma, grava com 600
#   campos: client_id | client_secret | access_token | refresh_token

set -u

DIR="${CREDENCIAIS_DIR:-$HOME/.config/mesacore/credenciais}"
DIR="${DIR%/}"   # sem barra no fim: as chaves montam-se sempre com "$DIR/..." (um `$DIR$PREFIXO` sem barra
                 # dava `.../credenciaisctrader_mesa_client_id.key`, e o conferidor dizia FALTA em tudo — medido)
PREFIXO="${CREDENCIAIS_PREFIXO:-ctrader_mesa_}"
CAMPOS=(client_id client_secret access_token refresh_token)

uso() {
  echo "uso: $0 conferir | gravar <campo> | gravar-de-stdin <ficheiro> [--origem <texto>]" >&2
  echo "     campos: ${CAMPOS[*]}" >&2
  echo "     (gravar-de-stdin: o VALOR vem numa linha pelo stdin — nunca por argumento; para a tela)" >&2
  echo "     ($0 confere e grava em $DIR)" >&2
  exit 2
}

# A FORMA que se espera de cada valor. Nao e' validacao de seguranca: e' para o dono ver, antes de gravar, que
# colou a coisa certa em vez de metade de um comando.
forma() {
  local campo="$1" valor="$2" n=${#2}
  case "$campo" in
    client_id)
      # A FORMA do Client ID do portal e' `<digitos>_<codigo alfanumerico>` — e o COMPRIMENTO nao tem regra
      # declarada por este venue. Medido a 01/10/2026: o Client ID do dono tem **56** caracteres, e eu recusei-o
      # porque tinha inventado um «~19» a partir de uma imagem CORTADA. Nao se inventa uma regua contra o dono:
      # confere-se a FORMA, e o comprimento leva so' um piso (nao e' um codigo de 3 caracteres) e um tecto de
      # sanidade (nao e' um documento colado). Quem diz se o valor serve e' o venue, na porta `ligacao`.
      if [[ "$valor" =~ ^[0-9]+_[A-Za-z0-9]+$ ]] && (( n >= 10 && n <= 128 )); then
        echo "parece um Client ID (digitos + underscore + codigo alfanumerico)"
      else
        echo "NAO parece um Client ID (esperado: digitos, UM underscore, e um codigo alfanumerico — sem espacos nem texto)"
      fi
      ;;
    *)
      if [[ "$valor" =~ ^[A-Za-z0-9+/=_-]+$ ]] && (( n >= 16 )); then
        echo "parece um token/segredo"
      else
        echo "NAO parece um token (esperado: 16+ caracteres, sem espacos nem texto)"
      fi
      ;;
  esac
}

conferir() {
  local faltam=0
  echo "credenciais em $DIR"
  for campo in "${CAMPOS[@]}"; do
    local f="$DIR/$PREFIXO$campo.key"
    if [[ ! -f "$f" ]]; then
      echo "  $PREFIXO$campo.key : FALTA"
      faltam=$((faltam + 1))
      continue
    fi
    local modo n valor
    modo="$(stat -c '%a' "$f")"
    n="$(wc -c < "$f" | tr -d ' ')"
    valor="$(cat "$f")"
    printf '  %s%s.key : modo %s | %s bytes | %s\n' "$PREFIXO" "$campo" "$modo" "$n" "$(forma "$campo" "$valor")"
  done
  echo
  if (( faltam > 0 )); then
    echo "$faltam ficheiro(s) por criar. Para cada um:  bash $0 gravar <campo>"
    exit 1
  fi
  echo "os quatro estao la'. A porta 'chave' do conector confirma-os por codigo."
}

gravar() {
  local campo="$1"
  local conhecido=0
  for c in "${CAMPOS[@]}"; do [[ "$c" == "$campo" ]] && conhecido=1; done
  (( conhecido )) || { echo "campo desconhecido: $campo (esperado: ${CAMPOS[*]})" >&2; exit 2; }

  local f="$DIR/$PREFIXO$campo.key"
  mkdir -p "$DIR" && chmod 700 "$DIR" || { echo "nao consegui preparar $DIR" >&2; exit 1; }

  local valor resposta
  printf 'cola o valor de %s%s e carrega Enter: ' "$PREFIXO" "$campo"
  IFS= read -rs valor
  echo

  if [[ -z "$valor" ]]; then
    echo "nada foi colado — nao gravei nada." >&2
    exit 1
  fi

  printf '  recebi %d caracteres, a comecar por «%s»\n' "${#valor}" "${valor:0:4}"
  printf '  %s\n' "$(forma "$campo" "$valor")"

  # FORMA ERRADA NAO SE GRAVA. Um valor que nao tem a forma do campo e' pior do que nenhum: o conector vai
  # recusa-lo mais tarde, e ate' la' acha-se que esta' feito. Medido a 01/10/2026: o dono colou 56 caracteres
  # onde o Client ID tem 19 (a seleccao do rato apanhou o texto a' volta), e o programa gravou-o na mesma.
  # Quem quiser mesmo gravar um valor de forma estranha diz `--forcar` e assume-o.
  if [[ "$(forma "$campo" "$valor")" != parece* && "${2:-}" != "--forcar" ]]; then
    echo "  NAO gravei: a forma nao bate com o campo. Confere no portal (usa o botao de COPIAR do campo, e nao" >&2
    echo "  a seleccao do rato) e repete. Se for mesmo assim: bash $0 gravar $campo --forcar" >&2
    exit 1
  fi

  printf '  gravar em %s? (s/n) ' "$f"
  IFS= read -r resposta
  if [[ "$resposta" != "s" ]]; then
    echo "nao gravei nada."
    exit 1
  fi

  # Um `>` sobre um ficheiro que ja' existe PRESERVA o modo; se for novo, cria com o que a mascara disser — por
  # isso se cria primeiro com 600, como manda a casa.
  install -m 600 /dev/null "$f"
  printf '%s' "$valor" > "$f"
  chmod 600 "$f"
  echo "gravado: $(stat -c '%a %n' "$f")"
  unset valor
}

# ---- A PORTA DE ESCRITA GENERICA (04/10/2026) ---------------------------------------------------------
# PORQUE EXISTE. O unico escritor de credenciais era cTrader-only (4 campos fixos, `CREDENCIAIS_PREFIXO`), e o
# valor da Hyperliquid vivia num ficheiro que NENHUMA ferramenta escrevia — a tela dizia «segredo · por caminho ·
# nao se abre» e nao tinha caminho de escrita. Esta e' a MESMA porta, estendida: um valor por ficheiro, fora do
# repositorio, modo 600, e o registo com instante, ficheiro, origem e impressao.
#
# O VALOR VEM DO `STDIN`, e nunca de um argumento de comando: um argumento ficaria no `ps` e no historico do
# shell. E o que se imprime de volta e' SO' A FORMA (comprimento + primeiros caracteres) e a IMPRESSAO (sha256) —
# nunca o valor. Quem chama (a tela, pelo `POST /api/credencial`) fecha o stdin e le' esta saida.
#
# Uso:  ... gravar-de-stdin <ficheiro> [--origem <texto>]      (o valor vem numa linha pelo stdin)
gravar_de_stdin() {
  local f="${1:-}" origem="desconhecida"
  shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --origem) origem="${2:-desconhecida}"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [ -z "$f" ]; then echo "uso: $0 gravar-de-stdin <ficheiro> [--origem <texto>]" >&2; exit 2; fi

  # O CAMINHO TEM DE VIVER NA PASTA DAS CREDENCIAIS: uma porta de escrita que aceita qualquer caminho e' uma
  # porta que escreve em qualquer sitio.
  case "$f" in
    "$DIR"/*) ;;
    *) echo "RECUSADO: o ficheiro da credencial tem de viver em $DIR (veio $f)" >&2; exit 1 ;;
  esac

  local valor
  IFS= read -r valor || true
  valor="${valor%$'\r'}"                      # um `\r` colado de um browser nao faz parte do segredo
  if [ -z "$valor" ]; then echo "RECUSADO: nao veio valor nenhum pelo stdin" >&2; exit 1; fi
  if [ "${#valor}" -lt 16 ]; then
    echo "RECUSADO: o valor tem ${#valor} caracteres — curto de mais para um segredo (minimo 16)" >&2; exit 1
  fi
  if printf '%s' "$valor" | grep -qE '[[:space:]]'; then
    echo "RECUSADO: o valor tem espacos ou texto — confira que colou so' a chave" >&2; exit 1
  fi

  printf '  forma: %d caracteres, a comecar por «%s»\n' "${#valor}" "${valor:0:4}"

  mkdir -p "$DIR" && chmod 700 "$DIR" || { echo "nao consegui preparar $DIR" >&2; exit 1; }
  # ESCRITA ATOMICA: um ficheiro novo no MESMO directorio, ja' com modo 600 (umask 077), e a troca de nome. Assim
  # nunca existe um instante com a credencial a meio, nem um ficheiro com o valor e modo folgado.
  local tmp="$f.tmp.$$"
  ( umask 077; printf '%s' "$valor" > "$tmp" ) || { echo "nao consegui escrever o temporario" >&2; exit 1; }
  chmod 600 "$tmp"
  mv -f "$tmp" "$f"

  local impressao
  impressao="$(printf '%s' "$valor" | sha256sum | cut -d' ' -f1)"
  # O REGISTO vive FORA do repositorio, ao lado da pasta das credenciais. Leva instante, ficheiro, ORIGEM, a
  # impressao e a FORMA — e NUNCA o valor.
  local historico="$DIR/../historico-de-credenciais.jsonl"
  printf '{"instante":"%s","ficheiro":"%s","origem":"%s","impressao_sha256":"%s","forma":{"comprimento":%d,"primeiros":"%s"}}\n' \
    "$(date -Iseconds)" "$f" "$origem" "$impressao" "${#valor}" "${valor:0:4}" >> "$historico"
  chmod 600 "$historico" 2>/dev/null || true

  echo "gravado: $(stat -c '%a %n' "$f")"
  echo "impressao: $impressao"
  unset valor
}

case "${1:-}" in
  conferir) conferir ;;
  gravar) gravar "${2:-}" "${3:-}" ;;
  gravar-de-stdin) gravar_de_stdin "${2:-}" "${3:-}" "${4:-}" ;;
  *) uso ;;
esac
