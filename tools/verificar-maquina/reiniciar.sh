#!/usr/bin/env bash
# T035 / SC-010: as marcas sobrevivem ao processo morrer?
#
# O que se prova, e por que assim:
#
#   1. um processo ESCREVE as marcas (sessao, inibicao do CB, dois desconhecidos)
#   2. OUTRO processo (o processo das marcas ja morreu) LE do ficheiro
#   3. um TERCEIRO aplica o reset
#   4. no fim, o ficheiro e lido por python - que nao sabe nada do nosso codigo - e tem de conter tudo
#
# O passo 4 e o que impede a prova de ser auto-complacente: o mesmo ficheiro tem de ser legivel por quem
# nao tem o codigo (FR-043), e nao apenas pelo processo que o escreveu.
#
# Falha se QUALQUER marca se perder - e falha tambem se o reset limpar o desconhecido (FR-029).

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROC="$RAIZ/tools/verificar-maquina/processo-das-marcas.ts"
MARCADOR="${TMPDIR:-/tmp}/mesacore-marcas-$$.json"

falhas=0
conferir() {
  if [ "$1" = "1" ]; then
    echo "ok    $2"
  else
    echo "FALHA $2"
    falhas=$((falhas + 1))
  fi
}

echo "=== SC-010: as marcas sobrevivem ao processo morrer ==="
echo "ficheiro de marcas desta prova: $MARCADOR"
echo

bun run "$PROC" marcar "$MARCADOR" > "$MARCADOR.passo1" 2>&1
echo "passo 1 - o processo que escreveu:"; sed 's/^/  /' "$MARCADOR.passo1"

bun run "$PROC" reler "$MARCADOR" > "$MARCADOR.passo2" 2>&1
echo; echo "passo 2 - OUTRO processo, a ler do ficheiro:"; sed 's/^/  /' "$MARCADOR.passo2"

bun run "$PROC" reset "$MARCADOR" > "$MARCADOR.passo3" 2>&1
echo; echo "passo 3 - um terceiro processo, com reset:"; sed 's/^/  /' "$MARCADOR.passo3"

echo; echo "passo 4 - o ficheiro lido por python (sem o nosso codigo):"
python3 - "$MARCADOR" <<'PY'
import json, sys

caminho = sys.argv[1]
with open(caminho) as f:
    m = json.load(f)

resultado = {
    "familias": sorted(m.keys()),
    "tem_sessao": m.get("sessao") is not None,
    "sessao_equity_de_partida": (m.get("sessao") or {}).get("equity_de_partida"),
    "tem_inibicao_cb": m.get("inibicao_cb") is not None,
    "inibicao_perda_medida": (m.get("inibicao_cb") or {}).get("perda_medida"),
    "desconhecidos": sorted(d["instrumento"] for d in m.get("desconhecido", [])),
    "desconhecido_motivos": sorted(d["motivo"] for d in m.get("desconhecido", [])),
    "referencias": sorted(d["referencia_do_cliente"] for d in m.get("desconhecido", [])),
    "campos_de_posicao_no_ficheiro": [
        k for k in json.dumps(m).replace('"', " ").split() if k in {"unidades", "quantidade", "posicao"}
    ],
}
print(json.dumps(resultado, indent=1, ensure_ascii=False))

esperado = {
    "sessao": True, "inibicao_cb": True,
    "desconhecidos": ["EURUSD", "GBPUSD"],
    "motivos": ["desfecho_ilegivel", "sem_confirmacao_dentro_do_prazo"],
    "referencias": ["mesa-3232-000030", "mesa-3232-000031"],
}
falhas = 0
def confere(ok, texto):
    global falhas
    print(("ok    " if ok else "FALHA ") + texto)
    if not ok:
        falhas += 1

confere(resultado["tem_sessao"] is esperado["sessao"], "a marca de sessao sobreviveu")
confere(resultado["tem_inibicao_cb"] is esperado["inibicao_cb"], "a inibicao do CB sobreviveu (e o reset nao a levantou)")
confere(resultado["desconhecidos"] == esperado["desconhecidos"], f"os dois desconhecidos sobreviveram: {resultado['desconhecidos']}")
confere(resultado["desconhecido_motivos"] == esperado["motivos"], f"os motivos sobreviveram: {resultado['desconhecido_motivos']}")
confere(resultado["referencias"] == esperado["referencias"], "as referencias do cliente sobreviveram")
confere(resultado["campos_de_posicao_no_ficheiro"] == [], "nenhum campo de posicao no ficheiro de marcas (R2/FR-022)")
sys.exit(0 if falhas == 0 else 1)
PY
if [ $? -ne 0 ]; then falhas=$((falhas + 1)); fi

rm -f "$MARCADOR" "$MARCADOR.passo1" "$MARCADOR.passo2" "$MARCADOR.passo3"

echo
if [ "$falhas" = "0" ]; then
  echo "SC-010: 0 marcas perdidas · o reset nao tocou em nada"
else
  echo "SC-010: $falhas falhas"
fi
echo "resumo: 3 processos + 1 leitura externa · $falhas falhas"
exit "$([ "$falhas" = "0" ] && echo 0 || echo 1)"
