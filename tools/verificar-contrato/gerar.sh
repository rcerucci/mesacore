#!/usr/bin/env bash
# Gera o codigo das duas linguagens a partir dos schemas.
#
#   tools/verificar-contrato/gerar.sh
#
# D1: o SCHEMA e a fonte normativa; o codigo gerado e derivado e VERSIONADO. Ninguem edita o
# gerado a mao — quem o editar aparece no teste de frescura (frescura.sh) como divergencia.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ/contracts"

SCHEMAS=(mercado proposta boleta resolucao desfecho manifesto historico envelope)

for schema in "${SCHEMAS[@]}"; do
  bun x json-schema-to-typescript --input "$schema.schema.json" --output "gerado/ts/$schema.d.ts"
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
  --output gerado/py \
  --input-file-type jsonschema \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.11 \
  --disable-timestamp

# O gerador VERIFICA o proprio trabalho. Sem isto, um gerador que falha a meio deixa ficheiros
# velhos no lugar e o repositorio passa a mentir sobre o que o contrato diz.
faltam=0
for schema in "${SCHEMAS[@]}"; do
  for esperado in "gerado/ts/$schema.d.ts" "gerado/py/${schema}_schema.py"; do
    if [ ! -s "$esperado" ]; then
      echo "GERACAO INCOMPLETA: falta $esperado"
      faltam=1
    fi
  done
done
if [ ! -s gerado/py/_defs/forma_schema.py ]; then
  echo "GERACAO INCOMPLETA: falta gerado/py/_defs/forma_schema.py"
  faltam=1
fi
[ "$faltam" -eq 0 ] || exit 1

ts_conteudo=$(find gerado/ts -name '*.d.ts' | wc -l)
py_conteudo=$(find gerado/py -name '*.py' | wc -l)
echo "gerado: ${#SCHEMAS[@]} schemas -> $ts_conteudo TypeScript + $py_conteudo Python (definicoes partilhadas incluidas)"
