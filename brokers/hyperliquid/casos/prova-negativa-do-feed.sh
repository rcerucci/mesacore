#!/usr/bin/env bash
# A PROVA NEGATIVA DA BANCADA DO FEED — o defeito é INJECTADO no núcleo, a bancada tem de o NOMEAR no vermelho, e
# o ficheiro volta ao mesmo (conferido por `sha256`, nunca por «já não se queixa»).
#
# PORQUE EXISTE, e porque não está no portão: uma bancada que nunca reprovou não mediu nada — e a única maneira de
# saber se ela mede o produto é estragar o produto de propósito e ver o vermelho com o NOME do caso dentro. Isto
# corre à mão (é lento: injecta, corre, repõe, seis vezes), e o `tools/verificar-maquina/provar.sh` não o chama; o
# que o portão mede é a bancada. Corre-se quando o `feed-barras.ts` ou a bancada mudam.
#
# Uso:  bash brokers/hyperliquid/casos/prova-negativa-do-feed.sh
# Sai 1 se alguma prova não nomear o caso que devia ficar vermelho.
set -u
cd "$(dirname "$0")/../../.."

FICHEIRO=brokers/hyperliquid/feed-barras.ts
BANCADA="bun run brokers/hyperliquid/casos/correr-feed.ts"
SELO=$(sha256sum "$FICHEIRO" | cut -d' ' -f1)
FALHAS=0
echo "selo inicial: $SELO"

injectar() { # $1 = texto antigo, $2 = texto novo, $3 = caso que TEM de aparecer no vermelho
  if ! python3 - "$1" "$2" <<'PY'
import sys
antigo, novo = sys.argv[1], sys.argv[2]
p = "brokers/hyperliquid/feed-barras.ts"
t = open(p, encoding="utf-8").read()
n = t.count(antigo)
if n != 1:
    print(f"RECUSADO — a ancora casa {n} vezes (tem de casar 1): {antigo!r}")
    sys.exit(3)
open(p, "w", encoding="utf-8").write(t.replace(antigo, novo))
PY
  then
    echo "   FALHA DA PROVA — injecao recusada (ancora mudou: a bancada desta prova tem de acompanhar o codigo)"
    FALHAS=$((FALHAS + 1))
    return
  fi

  saida=$($BANCADA 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    echo "   FALHA DA PROVA — o defeito injetado NAO foi apanhado: $3"
    FALHAS=$((FALHAS + 1))
  elif ! echo "$saida" | grep -q "$3"; then
    echo "   FALHA DA PROVA — vermelho, mas SEM nomear o caso ($3) — e' inconclusivo:"
    echo "$saida" | head -4 | sed 's/^/      /'
    FALHAS=$((FALHAS + 1))
  else
    echo "   ok — reprovou nomeando o caso: $(echo "$saida" | grep -m1 "$3" | cut -c1-100)"
  fi

  # REPOR da copia guardada e CONFERIR por hash (nunca por «ja nao se queixa»)
  cp "$GUARDA" "$FICHEIRO"
  atual=$(sha256sum "$FICHEIRO" | cut -d' ' -f1)
  if [ "$atual" = "$SELO" ]; then
    echo "   reposto, selo igual"
  else
    echo "   REPOSICAO FALHOU ($atual != $SELO)"
    exit 4
  fi
}

GUARDA=$(mktemp)
trap 'rm -f "$GUARDA"' EXIT
cp "$FICHEIRO" "$GUARDA"

echo "--- (1) o volume da barra agregada deixa de ser zero ---"
injectar 'v: "0", n: 0, agregada_do_bbo: true' 'v: "1", n: 0, agregada_do_bbo: true' 'feed/a-barra-agregada-do-bbo-e-marcada-e-o-vn-fica-a-zero'

echo "--- (2) a marca da agregacao desaparece da barra agregada ---"
injectar 'e.velas.push({ t: inicio, o: p, h: p, l: p, c: p, v: "0", n: 0, agregada_do_bbo: true });' 'e.velas.push({ t: inicio, o: p, h: p, l: p, c: p, v: "0", n: 0 });' 'feed/a-barra-agregada-do-bbo-e-marcada-e-o-vn-fica-a-zero'

echo "--- (3) a barra do venue com o mesmo t deixa de substituir (passa a ser ignorada) ---"
injectar '} else if (v.t === ultima.t) {' '} else if (false && v.t === ultima.t) {' 'feed/a-barra-do-venue-com-o-mesmo-t-substitui-a-agregada'

echo "--- (4) o buraco deixa de ser nomeado ---"
injectar 'dizer({ veredicto: "buraco_no_historico", par: chave, de: ultima.t, ate: v.t, faltam: Math.round((v.t - ultima.t) / passo) - 1 });' 'void chave;' 'feed/o-buraco-no-historico-e-nomeado-e-nunca-inventado'

echo "--- (5) a escrita passa a ser NO SITIO (deixa de haver troca de nome) ---"
injectar '  writeFileSync(temporario, e.velas.map((v) => JSON.stringify(v)).join("\n") + "\n");
  renameSync(temporario, caminho);' '  writeFileSync(caminho, e.velas.map((v) => JSON.stringify(v)).join("\n") + "\n");' 'feed/a-escrita-e-atomica-e-o-historico-fica-intacto'

echo "--- (6) a lista vazia volta a deitar a primeira barra do par novo fora ---"
injectar '  if (ultima === undefined) {
    e.velas.push(v);
  } else if (v.t > ultima.t) {' '  if (ultima === undefined) {
    return;
  } else if (v.t > ultima.t) {' 'feed/a-primeira-barra-de-um-par-novo-nao-se-deita-fora'

echo
echo "--- e a bancada, reposta, volta ao verde ---"
$BANCADA 2>&1 | tail -1
echo "selo final  : $(sha256sum "$FICHEIRO" | cut -d' ' -f1)"

if [ "$FALHAS" -ne 0 ]; then
  echo "PROVA NEGATIVA: $FALHAS de 6 falharam"
  exit 1
fi
echo "PROVA NEGATIVA: 6 de 6 nomes de caso conferidos"
