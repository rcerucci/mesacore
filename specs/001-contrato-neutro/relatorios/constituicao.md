# Os oito princípios, um a um — com o que os mede

| | |
|---|---|
| Papel | Revisão final de `.specify/memory/constitution.md` contra o que existe **medido**, no fim do recorte 001. |
| Quando | 28 set 2026, sobre a execução registada em `relatorios/RESULTADO.md`. |
| Como se lê | Cada princípio traz o **comando** e o **número**. Onde não há número, está escrito **não medido** — e a lista do que falta está no fim. |

Um princípio com prova fraca é um princípio com prova fraca: preferi escrever "não medido" a
arredondar a evidência.

---

## I. A inteligência é humana; o código é burro

> O que é ajustável está em `/config`, com nome; o código lê, valida e obedece.

**Comando 1** — nenhum número do dono escrito no código:

```bash
grep -nE '"[0-9]+\.[0-9]+"' contracts/esqueleto/*.ts
# (nenhuma linha)
grep -nE '[^a-zA-Z_"]0\.[0-9]+' contracts/mocks/setup/main.ts contracts/mocks/conector/*.py
# mocks/setup/main.ts:59:  {"setup": {"nome": "mock_setup", "versao": "1.0.0"}}
# mocks/conector/historico.py:80:  {"contrato": "1.0.0", ...}   <- versoes, nao valores
```

**Comando 2** — toda grandeza do contrato tem dono declarado:

```bash
tools/verificar-contrato/inventario.sh
# ok  toda grandeza tem origem declarada (44 grandezas)
# ok  nenhuma declaracao sem grandeza
# origem: 2 de dono · 1 de mesa · 5 de setup · 36 de venue
```

**Leitura:** as 36 grandezas de origem `venue` são fatos da corretora, não escolhas — é a mesa que
está proibida de as inventar. As **7 que alguém escolhe** (2 do dono, 5 do setup) têm todas chave
nomeada no inventário. Os limites do campo da marca (bits de ficha, bits de ciclo) vivem em
`vocabulario.json`, e `marca.ts` **confere-os por aritmética** antes de trabalhar.

---

## II. Recusar, nunca degradar em silêncio

**Comando:**

```bash
cd contracts && bun run esqueleto/casos.ts | tail -1
# ts · contrato 1.0.0 · 81 casos · 27 aceites · 54 recusados · 0 divergentes · 0 erros
```

**As 54 recusas, por motivo** (medido do relatório):

| Motivo | Quantas |
|---|---|
| `campo_obrigatorio_ausente` | 12 |
| `tipo_invalido` | 10 |
| `valor_fora_do_conjunto` | 8 |
| `campo_desconhecido` | 6 |
| `formato_invalido` | 5 |
| `campo_em_unidade_de_corretora` | 4 |
| `enquadramento_invalido` | 3 |
| `valor_nulo_nao_permitido` | 2 |
| `valor_fora_da_banda` | 2 |
| `versao_do_contrato_divergente` | 1 |
| `parcial_nao_declarada` | 1 |

**O caso que mais prova este princípio** é o do mínimo do instrumento: a quantidade que caberia na
banda é menor que o mínimo, e o conector **recusa** em vez de arredondar para cima —
`quantidade_pedida 0.00`, `minimo 0.01`. Arredondar aumentaria o risco do dono sem autorização.

**E o instrumento também se recusa a si mesmo** (28 set): `frescura.sh` **reprova** um ficheiro
gerado editado à mão; `prova-negativa-inventario.py` prova que o conferidor do inventário reprova
por três caminhos diferentes. Sem isto, "recusa" seria uma intenção do código, não uma propriedade
medida.

---

## III. A fronteira fala uma língua neutra, e dinheiro não é float

```bash
cd contracts && bun run ../tools/verificar-contrato/ts/inspecionar.ts | tail -1
# inspeccao: 20 campos declarados, 0 em unidade de corretora
uv run python ../tools/verificar-contrato/py/ida_e_volta.py | tail -1
# ida e volta: 9/9 valores sem perda
```

Zero campos em `quantidade`, `lote`, `preco_absoluto`, `pontos`, `tick` ou `tamanho_do_contrato`
nas mensagens que a mesa envia. Dinheiro é decimal **textual**: um `0.5` em vírgula flutuante é
recusado com `tipo_invalido` (10 casos), e o valor `1000000000000.000000000000001` volta igual.
As duas linguagens decidem **igual** em 81 casos (`comparar.py`: 0 divergências).

---

## IV. O conector traduz, declara antes de executar, e prova

```bash
tools/verificar-contrato/ponta-a-ponta.sh | tail -1
# ponta-a-ponta: 0 falhas — as duas pontas falam o contrato, e decidem o que deviam  (13 verificações)
```

A resolução sai **antes** da execução (linha 1 do mock é a `resolucao`, linha 2 é o `desfecho`) —
medido, não prometido. A conferência contra o manifesto tem **12 casos** e cobre o que o venue não
declarou: tipo de ordem, política de parcial, `reduce_only`, instrumento, desvio, alavancagem (o
máximo único **e** o escalão do valor). Uma mensagem recusada gera **0 envios**.

---

## V. Incerteza é estado de primeira classe

```bash
cd contracts && bun run esqueleto/referencia.ts | tail -1
# referencia: 9 casos · 0 divergentes
grep 'classificacao-inventada' /tmp/ts.jsonl
# {"caso":"desfecho/classificacao-inventada","veredicto":"recusado","motivo":"valor_fora_do_conjunto", ...}
printf '%s\n' "$BOLETA" | uv run python mocks/conector/main.py --silencioso | wc -l   # 1
```

Quatro classificações, e **nenhuma** a mais: uma classificação inventada é recusada (SC-007). O
silêncio devolve só a resolução — não há desfecho inventado. Desfecho `desconhecido`: com
idempotência declarada reenvia-se com a mesma referência; **sem** ela, reconcilia-se **antes** — e a
bateria recusa explicitamente qualquer reenvio "a credo" fora do primeiro envio.

---

## VI. O dinheiro e a posse são da corretora

```bash
tools/verificar-contrato/reinicio.sh | tail -1
# reinicio: 0 falhas — a posse le-se do venue, pela marca
uv run python contracts/mocks/conector/historico.py --instrumento EURUSD 2>&1 >/dev/null
# parcelas reportadas: -0.02 · resultado do venue: 12.40 · diferem (por isso o resultado nao se reconstroi)
```

A posse não tem base de dados do lado da mesa: depois do "reinício" (que não guarda nada), a
posição é reencontrada **pela marca que está no venue**, e a posição sem a marca é relatada como
alheia e **não gerida** — o venue continua com 1 ordem, e a alheia intacta. No histórico, taxas e
funding vêm em campos próprios, e as parcelas reportadas **não dão** o resultado: reconstruí-lo
seria a mesa a reescrever a conta da corretora.

---

## VII. A dependência aponta para o contrato, nunca para o core

```bash
tools/verificar-contrato/porteiro-dependencias.sh | tail -1
# porteiro: 0 dependencias proibidas em 33 ficheiros de /contracts
```

Nenhum ficheiro de `/contracts` importa `core/`, `setups/` ou `brokers/`. Os mocks contam para esta
contagem pelo lado de dentro (não importam o core); quem sai do âmbito são os ficheiros de
ferramentas, que **podem** olhar para o repositório inteiro, porque são quem confere.

---

## VIII. Sem prova, não está feito

Este é o princípio que mais mudou o trabalho, e vale a pena registar **o que ele apanhou**:

1. **`frescura.sh` dava verde com a geração a falhar** — sobravam 4 de 8 ficheiros Python. O
   instrumento mentia sobre o estado do repositório. Corrigido: o gerador verifica o próprio
   trabalho, e a frescura falha alto.
2. **A prova de ponta-a-ponta arrastava estado** (28 set): uma ordem da corrida anterior respondia
   por idempotência, e o caso da **recusa** passou sem recusar — o verde era do estado, não do
   código. Corrigido: o venue começa limpo, e a prova passou a exigir a **decisão** (recusou com
   aquele motivo), não só que a mensagem fosse válida.
3. **O conferidor do inventário tinha um buraco no próprio varrimento** — procurava um `$def`
   chamado `inteiro_ms` (que não existe) e deixava prazos e instantes fora da conferência: 44
   grandezas passaram a 34 vistas... e depois a 44 outra vez, das quais **9 estavam sem origem
   declarada**. Um conferidor que procura o nome errado dá um verde largo.
4. **`reduce_only_nativo` não decidia nada** — o nome dizia o mecanismo, e a conferência precisa da
   capacidade. Um `false` tanto podia querer dizer "o conector emula" como "não há como".

Os quatro são o mesmo erro em quatro sítios: **um instrumento que não consegue medir, e não o diz.**
A resposta é sempre a mesma — o instrumento falha alto, e o defeito corrige-se no sítio onde ele
está (o schema, o teste, o documento), nunca no resultado.

---

## O que fica por medir

| | |
|---|---|
| **SC-010** | "Uma ponta nova fica utilizável conhecendo apenas o contrato" — medido **em parte**: o porteiro prova que `/contracts` não depende do core, e `validar_linha.{ts,py}` valida qualquer mensagem sem mais nada. Mas isso mede a **suficiência do contrato**, não que uma pessoa nova o consiga usar sem ajuda: essa parte é julgamento humano e não tem comando. |
| **SC-007** | Medido pelo lado da classificação (uma inventada é recusada) e pelo lado da decisão. O que **não** está medido é o comportamento da mesa depois de um `desconhecido` — é a máquina de estados, que não é deste recorte. |
| **RN-T15.1** (setup manual) | O `prazo_de_resposta_ms` existe no inventário, mas o **valor** num setup manual é humano. Nada neste recorte o exercita: o mock devolve sempre. |
| **Valores concretos** | As bandas dos itens limitáveis e os números de exemplo continuam **por decidir** — e é assim que deve ser: o que este recorte tinha de provar era que a **chave** existe, não o número. |
