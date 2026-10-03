#!/usr/bin/env bash
# Gera o codigo das duas linguagens a partir dos schemas.
#
#   tools/verificar-contrato/gerar.sh
#
# D1: o SCHEMA e a fonte normativa; o codigo gerado e derivado e VERSIONADO. Ninguem edita o
# gerado a mao — quem o editar aparece no teste de frescura (frescura.sh) como divergencia.
#
# O GERADOR E' DONO DO QUE PRODUZ (03/10/2026). Ate' aqui isto escrevia POR CIMA do que ja' estava no
# directório: um ficheiro que o gerador deixou de produzir (ex.: os `.d.ts` dos nomes COM HIFEN, de quando os
# schemas se chamavam `decisao-do-encerramento.schema.json`) ficava la' para sempre — e o teste de frescura, que
# compara duas cópias do MESMO directório, nao o via (ele estava nos DOIS lados, identico, logo nao era diferenca).
# Medido antes de mexer: TRES `.d.ts` obsoletos rastreados em git — `decisao-do-encerramento`, `pergunta-do-encerramento`
# e `resposta-de-comando` — e o ULTIMO carregava contrato VELHO (o espelho do vocabulário dizia «15 dos 42 motivos»;
# o vigente diz «22 dos 50»), com a frescura a dar 0 divergencias. Agora a geracao acontece numa pasta PROPRIA;
# verificada a completude (abaixo), o resultado SUBSTITUI os directórios geridos — o que o gerador nao produz deixa
# de existir, e a frescura passa a vê-lo como divergencia. Se a geracao falhar, os ficheiros velhos ficam onde
# estavam (nao se destroi o gerado por uma corrida que nao produziu nada) e o script sai 1.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts"

SCHEMAS=(mercado proposta boleta resolucao desfecho manifesto historico envelope comando resposta_de_comando pergunta_do_encerramento decisao_do_encerramento)

# A GERACAO VAI PARA UMA PASTA PROPRIA: o que la' sair e' o que o gerador produz — e e' isso que substitui o gerado.
NOVO="$(mktemp -d)"
trap 'rm -rf "$NOVO"' EXIT
mkdir -p "$NOVO/ts"

for schema in "${SCHEMAS[@]}"; do
  bun x json-schema-to-typescript --input "$schema.schema.json" --output "$NOVO/ts/$schema.d.ts"
done

# O gerador Python, com $ref entre ficheiros, so trabalha em modo MODULAR: entra um directorio
# e sai um directorio. O directorio de entrada e FIXO (e nao um temporario) porque o gerador
# escreve o caminho de entrada no cabecalho dos ficheiros: com um nome aleatorio, a saida muda
# em cada corrida e o teste de frescura acusaria divergencia sempre — ou seja, nao media nada.
STAGING="$RAIZ/contracts/.geracao-entrada"
rm -rf "$STAGING"
mkdir -p "$STAGING/_defs"
cp ./*.schema.json "$STAGING/"
cp _defs/forma.schema.json "$STAGING/_defs/"

PYTHONWARNINGS=ignore uv run datamodel-codegen \
  --input "$STAGING" \
  --output "$NOVO/py" \
  --input-file-type jsonschema \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.11 \
  --disable-timestamp

# O gerador VERIFICA o proprio trabalho — e verifica-o ANTES de substituir o gerado. Sem isto, um gerador que
# falha a meio deixa ficheiros velhos no lugar e o repositorio passa a mentir sobre o que o contrato diz.
faltam=0
for schema in "${SCHEMAS[@]}"; do
  for esperado in "$NOVO/ts/$schema.d.ts" "$NOVO/py/${schema}_schema.py"; do
    if [ ! -s "$esperado" ]; then
      echo "GERACAO INCOMPLETA: falta $esperado"
      faltam=1
    fi
  done
done
if [ ! -s "$NOVO/py/_defs/forma_schema.py" ]; then
  echo "GERACAO INCOMPLETA: falta $NOVO/py/_defs/forma_schema.py"
  faltam=1
fi
[ "$faltam" -eq 0 ] || exit 1

# A TROCA: o gerado passa a ser EXACTAMENTE o que o gerador produziu — nem um ficheiro a mais, nem um a menos.
rm -rf gerado/ts gerado/py
cp -r "$NOVO/ts" gerado/ts
cp -r "$NOVO/py" gerado/py

ts_conteudo=$(find gerado/ts -name '*.d.ts' | wc -l)
py_conteudo=$(find gerado/py -name '*.py' | wc -l)
echo "gerado: ${#SCHEMAS[@]} schemas -> $ts_conteudo TypeScript + $py_conteudo Python (definicoes partilhadas incluidas)"
