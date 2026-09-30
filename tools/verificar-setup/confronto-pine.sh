#!/usr/bin/env bash
# O CONFRONTO DO PINE COM O MOTOR — barra a barra, e sem esconder nada.
#
#   tools/verificar-setup/confronto-pine.sh <velas.jsonl> [constantes.json]
#
# Corre o motor (`sinal.ts`, pela boca de `imprimir.ts`) e a transcricao do indicador (`pine-sigma.py`) sobre as
# MESMAS barras e os MESMOS parametros, e diz em que barras discordam — o `sig` e a `virada`. O `sig` e' o que
# decide o lado; a `virada` e' a entrada. Uma discordancia numa barra do fim e' uma ordem que o grafico nao deu.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VELAS="${1:?uso: confronto-pine.sh <velas.jsonl> [constantes.json]}"
K="${2:-}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -z "$K" ]; then
  K="$TMP/k.json"
  python3 - "$RAIZ/setups/sigma/setup.json" "$K" <<'PY'
import json, sys
t = json.load(open(sys.argv[1]))["template"]
om = {k: v["omissao"] for k, v in t.items() if "omissao" in v}
json.dump({k: om[k] for k in ("ma_len", "ma_tipo", "src_ma", "src_sinal", "usar_banda", "banda_atr",
                              "usar_zz", "zz_atr", "atr_len")}, open(sys.argv[2], "w"))
PY
fi

cd "$RAIZ"
bun run tools/verificar-setup/imprimir.ts "$VELAS" "$K" "$TMP/motor.json" >/dev/null
python3 tools/verificar-setup/pine-sigma.py "$VELAS" "$K" "$TMP/pine.json" >/dev/null

python3 - "$TMP/motor.json" "$TMP/pine.json" "$VELAS" <<'PY'
import json, sys
motor = json.load(open(sys.argv[1]))
pine = json.load(open(sys.argv[2]))
print(f"barras: {len(motor)} · parametros: {open(sys.argv[1].replace('motor','k')).name if False else 'os da ficha'}")
assert len(motor) == len(pine), "as duas series nao tem o mesmo numero de barras"

def perto(a, b, tol=1e-9):
    if a is None or b is None: return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a))

div_sig = [i for i in range(len(motor)) if motor[i]["sig"] != pine[i]["sig"]]
div_vir = [i for i in range(len(motor)) if motor[i]["virada"] != pine[i]["virada"]]
div_ma  = [i for i in range(len(motor)) if not perto(motor[i]["ma"], pine[i]["ma"], 1e-9)]
div_atr = [i for i in range(len(motor)) if not perto(motor[i]["atr"], pine[i]["atr"], 1e-9)]

def mostra(nome, idx, n=5):
    if not idx:
        print(f"ok    {nome}: iguais nas {len(motor)} barras")
        return
    print(f"DIVERGE {nome}: {len(idx)} barras — as primeiras {min(n, len(idx))}:")
    for i in idx[:n]:
        m, p = motor[i], pine[i]
        print(f"        #{i} t={m['t']} motor={m.get(nome.split()[0])} pine={p.get(nome.split()[0])}")

mostra("ma", div_ma)
mostra("atr", div_atr)
mostra("sig", div_sig)
mostra("virada", div_vir)

fim_m, fim_p = motor[-1], pine[-1]
print(f"ultima barra: motor sig={fim_m['sig']} virada={fim_m['virada']} · pine sig={fim_p['sig']} virada={fim_p['virada']}")
falhas = len(div_sig) + len(div_vir) + len(div_ma) + len(div_atr)
print(f"confronto: {falhas} barras divergentes em {len(motor)}")
sys.exit(1 if falhas else 0)
PY
