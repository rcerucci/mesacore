# Os casos do contrato

Um caso é **dado**: escreve-se uma vez, corre nas duas linguagens, e tem de dar o **mesmo** veredicto e o
**mesmo** motivo. É isto que transforma "o contrato é neutro" de intenção em medição.

## Ficheiro

Um ficheiro `*.casos.json` por família de mensagem:

```json
{
  "mensagem": "mercado",
  "casos": [
    {
      "nome": "mercado/ausencia-de-livro-e-declarada",
      "mensagem": "mercado",
      "entrada": { "contrato": "1.0.0", "tipo": "mercado", "id": "m-1", "carga": { } },
      "veredicto_esperado": "aceite",
      "motivo_esperado": null
    }
  ]
}
```

| Campo | Obrigatório | Significado |
|---|---|---|
| `nome` | sim | identificador do caso, `família/descrição` — é a chave de comparação entre linguagens |
| `mensagem` | sim | o `tipo` que a entrada declara |
| `entrada` | um dos dois | o envelope, como **objecto** |
| `entrada_texto` | um dos dois | a mensagem como **texto cru** — é o único jeito de testar o enquadramento (linha partida a meio) |
| `veredicto_esperado` | sim | `aceite` ou `recusado` |
| `motivo_esperado` | sim | `null` quando aceite; o identificador do vocabulário quando recusado |

## Regras

- **Um caso inválido de propósito é metade do valor da bateria.** Um conjunto que só tem casos válidos
  prova que o contrato aceita o que devia aceitar; não prova que **recusa** o que devia recusar
  (Princípio II da constituição).
- **Nada de excepções ao contrato para fazer um caso passar.** Se um caso só passa com uma excepção, o
  defeito é do contrato: corrige-se o `contracts/*.schema.json`, não o caso.
- **O motivo é identificador, não texto.** Compara-se por igualdade, nunca por "parece o mesmo".
- **Um caso não conhece a linguagem que o corre.** Se um caso precisa de saber, está mal escrito.
- `casos/_arnes.casos.json` é a bateria **do próprio envelope**: versão divergente, campo desconhecido,
  `null` onde o contrato não o admite, número onde se espera decimal textual, e uma mensagem partida em
  duas linhas.

## Os quatro inválidos que nunca podem faltar

1. **campo desconhecido** — o contrato é **fechado**
2. **`null`** onde o contrato não o admite — ausência é **a chave que não está lá**
3. **número de vírgula flutuante** onde a regra exige **decimal textual**
4. **campo em unidade de corretora** na boleta (`quantidade`, `lote`, `preço absoluto`)
