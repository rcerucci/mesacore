#!/usr/bin/env bash
# MULTIPAR — o processo com 2 activos, com 1, e com NENHUM; e o INÍCIO A QUENTE.
#
# PORQUE EXISTE. «Qual par está activo?» tem TRÊS elos no sistema, e cada um pode ser lido em sítio diferente:
#   1. o CONECTOR lê a lista de pares da CONTA (`config/contas/<conta>.json` -> `conta.instrumentos`) — é ela
#      que diz o que se lê do venue (`brokers/hyperliquid/processo.ts`);
#   2. o OPERADOR lê as FICHAS (`cabecalho.run`) para saber a que par pede o setup;
#   3. as VELAS de cada par são puxadas no relógio da ficha (`mercado.ts --actualizar`).
# Se algum dos três for lido uma vez só, ligar um par a quente não pega — e é isso que este ensaio mede.
#
# Uso:  bash tools/observar-multipar.sh [segundos-por-configuracao]     (por omissão, 150)
# Sai:  um resumo por configuração e os artefactos em <DIR_DE_OBSERVACAO>/multipar/<config>/
set -uo pipefail
CONTA="${CONTA_DE_PROVA:-hl-teste-plugin}"
SEGUNDOS="${1:-150}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FICHAS="$RAIZ/fichas/sigma"
CONTA_JSON="$RAIZ/config/contas/$CONTA.json"
BASE="${DIR_DE_OBSERVACAO:-/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/observacao}/multipar"
mkdir -p "$BASE"

# ---- o que configura, e como se repõe ----------------------------------------------------------------
fichas() {  # fichas <run_do_SOL> <run_do_BTC>
  python3 - "$FICHAS/SOL-$CONTA.json" "$FICHAS/BTC-$CONTA.json" "$1" "$2" <<'PY'
import json, sys
for caminho, run in ((sys.argv[1], sys.argv[3] == "sim"), (sys.argv[2], sys.argv[4] == "sim")):
    d = json.load(open(caminho, encoding="utf-8"))
    d["cabecalho"]["run"] = run
    open(caminho, "w", encoding="utf-8").write(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
PY
}
instrumentos() {  # instrumentos SOL,BTC | SOL | BTC
  python3 - "$CONTA_JSON" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["conta"]["instrumentos"] = [x for x in sys.argv[2].split(",") if x]
open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
PY
}
repor() {  # o estado que fica: o SOL ligado, o BTC desligado, a conta a ler o SOL
  fichas sim nao
  instrumentos SOL
}

# ---- uma corrida, e o que se recolhe -----------------------------------------------------------------
correr() {  # correr <nome> <instrumentos> <run_sol> <run_btc> [segundos_ate_ao_flip]
  local nome="$1" lista="$2" rs="$3" rb="$4"
  local DIR="$BASE/$nome"; mkdir -p "$DIR"
  instrumentos "$lista"; fichas "$rs" "$rb"
  echo "== $nome · conta.instrumentos=[$lista] · SOL run=$rs · BTC run=$rb"
  DIR_DE_OBSERVACAO="$DIR" setsid bash "$RAIZ/tools/operar-em-observacao.sh" "$CONTA" >/dev/null 2>&1 &
  local GPID=$!
  sleep "$SEGUNDOS"
  # O FLIP A QUENTE, quando pedido: no meio da corrida, muda-se o que manda (a ficha e a conta).
  if [ "${5:-}" != "" ]; then
    echo "   (flip a quente: $5)"
    case "$5" in
      btc-on)  fichas sim sim; instrumentos SOL,BTC ;;
      sol-off) fichas nao sim ;;
      btc-off) fichas sim nao ;;
    esac
    sleep "$SEGUNDOS"
  fi
  kill -- "-$GPID" 2>/dev/null
  sleep 3
  pkill -f "operador.ts --conta $CONTA" 2>/dev/null
  pkill -f "servidor.ts --tick 60000 --operacao $DIR" 2>/dev/null
  sleep 2
  relatar "$nome" "$DIR"
}

relatar() {  # relatar <nome> <dir>
  local nome="$1" DIR="$2"
  python3 - "$nome" "$DIR" <<'PY'
import json, os, sys, collections
nome, DIR = sys.argv[1], sys.argv[2]
def ler(caminho):
    try: return [json.loads(l) for l in open(caminho, encoding="utf-8") if l.strip()]
    except FileNotFoundError: return []
op = ler(os.path.join(DIR, "operador.log"))
mesa = ler(os.path.join(DIR, "registo.jsonl"))
op_inst = [l for l in op if l.get("instrumentos") is not None]
veredictos = collections.Counter(l.get("veredicto") for l in op if l.get("veredicto"))
# A OPERACAO: que instrumentos a mesa viu, e com que falhas
try:
    o = json.load(open(os.path.join(DIR, "operacao.json"), encoding="utf-8"))
    vistos = {k: (v.get("falhas"), "com leitura" if v.get("leitura") else "SEM leitura") for k, v in o["instrumentos"].items()}
except Exception as e:
    vistos = f"(sem operacao: {e})"
ciclos = [c for c in mesa if c.get("tipo") == "ciclo"]
porpar = collections.Counter(c.get("instrumento") for c in ciclos)
print(f"   operador: {len(op)} linhas · veredictos={dict(veredictos)}")
print(f"   instrumentos na operacao: {vistos}")
print(f"   ciclos da mesa: {len(ciclos)} {dict(porpar)}")
for c in ciclos[:6]:
    print(f"     ciclo {c.get('acao')} · {c.get('instrumento')} · {c.get('motivo')} · {str(c.get('nota'))[:60]}")
PY
}

echo "### o estado inicial fica registado"
cp "$CONTA_JSON" "$BASE/conta-antes.json"; cp "$FICHAS/SOL-$CONTA.json" "$BASE/sol-antes.json"; cp "$FICHAS/BTC-$CONTA.json" "$BASE/btc-antes.json"

correr "1-dois-ativos"    "SOL,BTC" sim sim
correr "2-so-sol"         "SOL"     sim nao
correr "3-so-btc"         "BTC"     nao sim
correr "4-nenhum"         "SOL,BTC" nao nao
# O INICIO A QUENTE: arranca com so o SOL, e a meio liga-se o BTC (ficha + conta), sem reiniciar nada.
correr "5-quente-btc-ligado-a-meio" "SOL" sim nao "btc-on"

repor
echo "### estado reposto (SOL ligado, BTC desligado, conta a ler o SOL)"
