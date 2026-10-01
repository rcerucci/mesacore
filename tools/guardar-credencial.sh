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
  echo "uso: $0 conferir | gravar <campo>" >&2
  echo "     campos: ${CAMPOS[*]}" >&2
  echo "     ($0 confere e grava em $DIR)" >&2
  exit 2
}

# A FORMA que se espera de cada valor. Nao e' validacao de seguranca: e' para o dono ver, antes de gravar, que
# colou a coisa certa em vez de metade de um comando.
forma() {
  local campo="$1" valor="$2" n=${#2}
  case "$campo" in
    client_id)
      if [[ "$valor" =~ ^[0-9]+_[A-Za-z0-9]+$ ]] && (( n >= 10 && n <= 40 )); then
        echo "parece um Client ID (numero + underscore + codigo)"
      else
        echo "NAO parece um Client ID (esperado: numero, underscore, e um codigo — e nao texto de comando)"
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

case "${1:-}" in
  conferir) conferir ;;
  gravar) gravar "${2:-}" ;;
  *) uso ;;
esac
