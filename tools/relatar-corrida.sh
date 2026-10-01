#!/usr/bin/env bash
# COMO VAI A CORRIDA? — um retrato de uma corrida de observacao, em texto, para ler em segundos.
#
# Le um directorio de corrida (o mesmo que o `operar-em-observacao.sh` recebe em DIR_DE_OBSERVACAO) e responde
# ao que o dono pergunta quando chega: o que esta' vivo, o que a mesa decidiu, o que SAIU, e com que parametros
# de risco. Nao decide nada, nao escreve nada: e' um leitor.
#
# Uso:  bash tools/relatar-corrida.sh [dir]        (por omissao, a corrida de risco mais recente)
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${1:-${DIR_DE_OBSERVACAO:-/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/corrida-de-risco}}"

if [ ! -d "$DIR" ]; then
  echo "nao ha corrida em $DIR" >&2
  exit 1
fi

echo "### a corrida em $DIR"
echo
echo "--- quem esta' vivo (e desde quando) ---"
if [ -f "$DIR/operacao-em-observacao.pid" ]; then
  for p in $(cat "$DIR/operacao-em-observacao.pid"); do
    if [ -d "/proc/$p" ]; then
      ps -o pid=,etime=,cmd= -p "$p" | cut -c1-100
    else
      echo "  pid $p — MORTO (o ficheiro ficou do arranque)"
    fi
  done
else
  echo "  (sem ficheiro de pid: a corrida nao se lancou por este caminho)"
fi
for pat in "[o]perador.ts --conta" "[s]ervidor.ts --tick" "[p]rocesso.ts --casos"; do
  n=$(pgrep -fc "$pat" 2>/dev/null || echo 0)
  echo "  processos '$pat': $n"
done

echo
echo "--- a mesa: estado, ciclos e decisoes ---"
python3 - "$DIR" <<'PY'
import json, os, sys, collections
d = sys.argv[1]
def ler(nome):
    caminho = os.path.join(d, nome)
    try:
        return [json.loads(l) for l in open(caminho, encoding="utf-8") if l.strip()]
    except FileNotFoundError:
        return []
linhas = ler("registo.jsonl")
estado = "parada"
for l in linhas:
    if l.get("tipo") == "transicao" and l.get("para"):
        estado = l["para"]
print(f"  estado da mesa: {estado}")
ciclos = [l for l in linhas if l.get("tipo") == "ciclo"]
print(f"  ciclos: {len(ciclos)} {dict(collections.Counter(c.get('instrumento') for c in ciclos))}")
motivos = collections.Counter(f"{c.get('acao')}:{c.get('motivo')}" for c in ciclos)
for m, n in motivos.most_common(6):
    print(f"    {n:4d}x  {m}")
boletas = [c for c in ciclos if c.get("boleta")]
print(f"  boletas compostas (decisoes de abrir): {len(boletas)}")
for b in boletas[:4]:
    bo = b["boleta"]
    man = bo.get("mandato") or {}
    print(f"    {b.get('instrumento')} · lado {bo.get('lado')} · saldo_pct {man.get('saldo_pct')} · "
          f"alavancagem {man.get('alavancagem')} · desvio {man.get('desvio_maximo')} · ficha {bo.get('ficha')}")
mandatos = [l for l in linhas if l.get("tipo") == "mandato"]
if mandatos:
    print(f"  mudancas de mandato: {len(mandatos)}")
    for m in mandatos:
        print(f"    {m.get('de')} -> {m.get('para')} · {m.get('instrumento')}")
PY

echo
echo "--- a operacao (o que o conector entregou, e com que risco) ---"
python3 - "$DIR" <<'PY'
import json, os, sys
d = sys.argv[1]
try:
    o = json.load(open(os.path.join(d, "operacao.json"), encoding="utf-8"))
except FileNotFoundError:
    print("  (sem operacao escrita)"); raise SystemExit
for par, v in sorted(o.get("instrumentos", {}).items()):
    leitura = v.get("leitura") or {}
    pos = leitura.get("posicao")
    risco = v.get("risco") or {}
    prop = v.get("proposta")
    print(f"  {par}: bid {leitura.get('bid')} · ask {leitura.get('ask')} · equity {leitura.get('equity')} · "
          f"posicao {'SIM ' + json.dumps(pos, ensure_ascii=False)[:70] if pos else 'nenhuma'}")
    print(f"      risco em vigor: saldo_pct {risco.get('saldo_pct')} · alavancagem {risco.get('alavancagem')} · "
          f"prazo {risco.get('prazo_de_resposta_ms')} ms · bandas {'sim' if risco.get('bandas') else 'NAO'}")
    print(f"      falhas da leitura: {json.dumps(v.get('falhas'))} | proposta do setup: "
          f"{'lado ' + str((prop or {}).get('lado')) + ' barra ' + str((prop or {}).get('barra_ms')) if prop else 'ausente (o setup esta calado)'}")
PY

echo
echo "--- o que SAIU para o venue ---"
for f in "$DIR"/desfechos-*.jsonl; do
  [ -f "$f" ] || continue
  python3 - "$f" <<'PY'
import json, sys
linhas = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
print(f"  {sys.argv[1].split('/')[-1]}: {len(linhas)} desfecho(s)")
for l in linhas[-5:]:
    print(f"    {json.dumps(l, ensure_ascii=False)[:150]}")
PY
done
[ -n "$(ls "$DIR"/desfechos-*.jsonl 2>/dev/null)" ] || echo "  (nenhuma ordem submetida ainda)"
for f in "$DIR"/marcas-*.jsonl; do
  [ -f "$f" ] || continue
  echo "  $(basename "$f"): $(wc -l < "$f") marca(s) de posse"
done
echo
echo "--- o carteiro: as boletas que NAO sairam, e por que ---"
python3 - "$DIR" <<'PY'
import json, os, sys, collections
d = sys.argv[1]
carteiro = []
for nome in os.listdir(d):
    if not nome.startswith("operador.log"):
        continue
    for l in open(os.path.join(d, nome), encoding="utf-8"):
        l = l.strip()
        if not l:
            continue
        try:
            x = json.loads(l)
        except Exception:
            continue
        if x.get("etapa") == "carteiro":
            carteiro.append(x)
if not carteiro:
    print("  (o carteiro ainda nao falou)")
else:
    print(f"  {len(carteiro)} passagem(ns) do carteiro")
    for porque, n in collections.Counter(c.get("porque") for c in carteiro).most_common(4):
        print(f"    {n:4d}x  {porque}")
PY
