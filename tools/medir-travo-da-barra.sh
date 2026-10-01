#!/usr/bin/env bash
# A TRAVA DA BARRA (D-021) SOBREVIVE AO REINICIO? — medido com CONTROLE.
#
# PORQUE EXISTE. A trava de uma entrada por barra vive numa `Map` na memoria da mesa. Se ela se perder num
# reinicio, a mesa compra uma SEGUNDA posicao na mesma barra — dinheiro a dobrar sem sinal a dobrar. E o reinicio
# deixou de ser raro: com o mandato a quente (`core/servidor.ts`), ligar um par e' uma escrita de ficha.
# A semente vem do REGISTO (`barrasDasUltimasEntradas`), onde cada entrada deixa a sua barra escrita.
#
# O QUE ISTO MEDE, e como. Monta-se uma operacao REAL (a ultima da observacao), com o instante do venue a AGORA e
# uma proposta para a ultima barra fechada, e corre-se a mesa DUAS vezes com TUDO igual menos UMA coisa:
#
#   * `com-semente` -> o registo TRAZ a linha da entrada desta barra (`barra_ms` escrita), como a mesa a deixou;
#   * `sem-semente` -> o registo esta' vazio: o CONTROLE, e' o que a mesa faria se nao soubesse de nada.
#
# Se a semente valer, a primeira decisao e' `nada · entrada_ja_feita_nesta_barra` numa e `abrir` na outra. Sem o
# controle, um `nada` poderia vir de qualquer outra razao — e a prova nao diria nada.
#
# Uso:  bash tools/medir-travo-da-barra.sh            (le a observacao mais recente em DIR_DE_OBSERVACAO)
#       OBS=<dir-da-corrida> bash tools/medir-travo-da-barra.sh
# Nota: NAO corre no portao — depende de uma corrida de observacao recente (uma operacao real com proposta).
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBS="${OBS:-${DIR_DE_OBSERVACAO:-/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/observacao}/multipar/5-quente-btc-ligado-a-meio}"
D="${DESTINO:-/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/travo-no-reinicio}"
rm -rf "$D"; mkdir -p "$D"

if [ ! -f "$OBS/operacao.json" ]; then
  echo "nao ha operacao em $OBS — corre primeiro uma observacao:" >&2
  echo "  bash tools/observar-multipar.sh 130        (ou: SO=2 bash tools/observar-multipar.sh 130)" >&2
  exit 1
fi

python3 - "$OBS" "$D" <<'PY'
import json, os, sys, time
obs, d = sys.argv[1], sys.argv[2]
op = json.load(open(os.path.join(obs, "operacao.json"), encoding="utf-8"))
cfg = json.load(open(os.path.join(obs, "operacao.json.config.json"), encoding="utf-8"))
op["instrumentos"] = {"SOL": op["instrumentos"]["SOL"]}      # so' o SOL: e' o par desta prova
cfg["fichas"] = {"SOL": cfg["fichas"]["SOL"]}
agora = int(time.time() * 1000)
passo, barra = 3_600_000, (agora // 3_600_000) * 3_600_000
i = op["instrumentos"]["SOL"]
i["leitura"]["tempo_do_venue_ms"] = agora
if "agora_ms" in i["leitura"]:
    i["leitura"]["agora_ms"] = agora
if i.get("proposta"):
    i["proposta"]["barra_ms"] = barra - passo          # a proposta e' da ultima barra FECHADA
else:
    # A OPERACAO DA OBSERVACAO VEIO SEM PROPOSTA (o `sigma` calou-se: nao houve flip). Esta prova e' da TRAVA DA
    # BARRA, e nao do setup — pelo que a proposta se monta a mao, com a FORMA REAL que o contrato aceita (lida de
    # uma proposta verdadeira: `setup` e' um OBJETO com `nome` e `versao`, e nao uma string — a primeira tentativa
    # foi recusada pelo contrato, e o motivo dela, `tipo_invalido`, e' que o disse).
    i["proposta"] = {"setup": {"nome": "sigma", "versao": "0.1.0"}, "lado": "sell", "barra_ms": barra - passo}
json.dump(op, open(os.path.join(d, "operacao.json"), "w", encoding="utf-8"))
json.dump(cfg, open(os.path.join(d, "operacao.json.config.json"), "w", encoding="utf-8"))
semente = {"instante_ms": agora, "tipo": "ciclo", "instrumento": "SOL", "acao": "abrir",
           "motivo": "o setup virou e a mesa entrou", "nota": "entrada DESTA barra, escrita antes do reinicio",
           "barra_ms": barra}
open(os.path.join(d, "registo-com-semente.jsonl"), "w", encoding="utf-8").write(json.dumps(semente) + "\n")
open(os.path.join(d, "registo-sem-semente.jsonl"), "w", encoding="utf-8").write("")
print(f"barra da prova: {barra} · instante do venue: {agora} · proposta da barra: {barra - passo}")
PY
cp "$OBS/operacao.json.portas.json" "$D/portas.json"
VERSAO=$(python3 -c "import json;print(json.load(open('$RAIZ/contracts/versao.json'))['contrato'])")

correr() {  # correr <nome> <registo>
  local nome="$1" registo="$2"
  # `timeout`: a mesa NAO morre quando a costura fecha (FR-006 — quem tem a operacao na mao nao sai porque o pipe
  # fechou), e sem isto o ensaio ficava a espera de um processo que nunca acaba. O ensaio mata-a, e di-lo.
  ( cd "$RAIZ" && { printf '{"contrato":"%s","tipo":"comando","id":"%s","carga":{"verbo":"start","autor":"dono","pedido_id":"%s"}}\n' "$VERSAO" "$nome" "$nome"; sleep 7; } \
      | timeout 12 bun run core/servidor.ts --tick 1500 --operacao "$D/operacao.json" --config "$D/operacao.json.config.json" \
          --portas "$D/portas.json" --registo "$registo" --marcas "$D/marcas-$nome.json" > "$D/mesa-$nome.log" 2>&1 )
  echo "   (a mesa de '$nome' foi morta pelo ensaio ao fim de 12 s — ela continuaria sem a costura)"
}

CORRER="${SO:-com-semente,sem-semente}"
quer() { case ",$CORRER," in *",$1,"*) return 0;; *) return 1;; esac; }
quer com-semente && correr com-semente "$D/registo-com-semente.jsonl"
quer sem-semente && correr sem-semente "$D/registo-sem-semente.jsonl"

for n in com-semente sem-semente; do
  echo "=== $n ==="
  python3 - "$D/registo-$n.jsonl" <<'PY'
import json, sys
linhas = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
ciclos = [l for l in linhas if l.get("tipo") == "ciclo"]
for c in ciclos[:4]:
    print(f"   ciclo {c.get('acao')} · {c.get('motivo')} · barra escrita {c.get('barra_ms')} · {str(c.get('nota'))[:44]}")
if not ciclos:
    print("   (nenhum ciclo: a mesa nao ciclou)")
PY
done
