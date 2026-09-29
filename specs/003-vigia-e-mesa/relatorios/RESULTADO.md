# O resultado do recorte 003 — o vigia e a mesa

Cada critério com o **comando** que o mede e o **número** que saiu. Nada aqui é estimado: o que não foi medido
está dito como não medido, no fim. As saídas cruas estão em `relatorios/`.

## Os oito critérios

### SC-001 — com o vigia morto, a mesa continua a reconciliar e a escrever no ledger

```
bash tools/verificar-maquina/vigia.sh --orfandade
```
**11 verificações · 0 divergentes · 10 voltas com o vigia morto · 10 voltas contadas x 10 linhas de ledger**

A contagem é a prova: **10 voltas, 10 linhas**. Se a mesa tivesse parado com a morte do vigia, o número de
linhas seria menor — «algumas» não serve. (FR-006: quem tem operação nas mãos não sai porque o cano fechou.)

### SC-002 — zero encerramentos com posição aberta sem decisão, e zero decisões sem motivo

```
bash tools/verificar-maquina/vigia.sh --encerramento      # 15 verificações · 0 divergentes · 7 cenários
bun run core/estado/registo.ts                            # 8 verificações · 11 linhas de registo reconstruídas
```
**7 cenários** (prazo, manter, fechar, decisao-sem-pergunta, sem-numeros, sem-prazo, liquidacao-cumprida),
todos com a cadeia de transições contígua e o motivo nomeado; **11 linhas** de registo reconstruídas da cadeia.
A decisão de «manter» não fecha por prazo, e o `stop` sem números da corretora **recusa** em vez de apresentar
um resumo inventado.

### SC-003 — zero campos sem leitor e zero motivos fora do vocabulário

```
bash tools/verificar-contrato/fronteira.sh
```
**fronteira: 0 falhas** — as duas direções dos motivos fecham (25 dos 47 cruzam, 22 não), os **24 campos das
quatro mensagens novas** (4 + 8 + 10 + 2) têm leitor no âmbito declarado, e os **100 casos** do contrato somam nas duas
linguagens. E a prova negativa: **0 falhas** — o conferidor reprova as **cinco** doenças que existe para
apanhar (motivo sem nome, nome sem produtor, contagem envelhecida, campo sem leitor, e o falso positivo
conhecido).

### SC-004 — o dublê de mesa e a mesa real dão o mesmo veredicto, em todos os casos

```
bash tools/verificar-contrato/duble-de-mesa.sh
```
**dublê 0 falhas** — 10 casos no papel `setup` e 10 no papel `conector`; **7 + 8** conferidos contra as **duas**
linguagens do motor do contrato; **0 divergências**. Uma divergência aparece como falha: a primeira foi
`aceita` contra `aceite`, apanhada no primeiro minuto da primeira corrida.

### SC-005 — a porta única do 002 continua a passar, e a contagem do contrato mantém-se

```
bash tools/verificar-maquina/provar.sh
```
**25 de 25 passaram** (eram **16 de 16** no fim do 002). A bateria do contrato: **100 casos · 34 aceites ·
66 recusados · 0 divergentes** (81 no recorte 001, 98 no início do 003). Nenhuma verificação do 002 perdeu-se —
as sete linhas que já existiam continuam com a **mesma** contagem (`relatorios/us7.txt`, lado a lado).

### SC-006 — um `start` com uma porta falhada devolve o motivo **daquela** porta

```
bash tools/verificar-maquina/arranque.ts
```
**35 verificações · 0 divergentes · 17 casos · 13 portas falhadas de propósito** — e as sete portas correm na
ordem `conectores → manifesto → mandato → contenda → inventário → versão → sessão`, com a recusa a nomear a
primeira que falha.

### SC-007 — um comando de versão diferente é recusado, sem adaptação

```
bun run tools/verificar-maquina/servidor.ts        # "versao diferente: recusado antes de tudo"
cd contracts && uv run python esqueleto/casos.py   # comando/versao-diferente-recusa e comando/sem-versao-recusa
```
**100%**: 2 casos novos declarados no contrato (versão atrás e versão ausente → o **mesmo** motivo,
`versao_do_contrato_divergente`), ambos verdes nas duas linguagens, e a porta já recusava antes de tudo. A
recusa diz as **duas** versões.

### SC-008 — o dublê devolve «espera» dentro do prazo e `desconhecido` depois — nunca sucesso

```
bash tools/verificar-contrato/duble-de-mesa.sh
```
**4 casos declarados** (2 por papel: calado dentro do prazo → `espera`; calado depois → `desconhecido`), todos
com o veredicto declarado e **nenhum** com sucesso — em 100% dos casos declarados.

## O que é decisão do dono, e ficou declarado em vez de decidido

- **A resposta da mesa não leva o detalhe com as duas versões** na recusa por versão: o `resposta_de_comando`
  não tem campo para ele. As duas versões vivem do lado do contrato, que é onde a versão se confere. Pôr o
  detalhe na resposta é contrato aditivo — decide-se.
- **O campo da conta na mensagem do comando** entra no dia em que a mesa servir mais do que uma conta (FR-020):
  hoje o `nova_sessao` é por conta, mas o campo não existe, e um `nova_sessao` com ele é **recusado**.
- **A conformidade por venue (RN-C6)** é o aceite do conector **real**, no recorte do plugin — este recorte
  corre contra dublês, e o que ele prova é a costura, não a corretora.
- **A hospedagem do setup** (dentro do processo da mesa ou processo próprio) continua fora, como FR-005 diz.
- **Os três números do mecanismo do vigia** (as esperas de 400 ms, 10 s e 60 s) estão classificados em
  `docs/inventario-de-chaves.md` §8.5: nenhum é valor de risco ou de dinheiro; o prazo que é do dono
  (`setup.prazo_de_resposta_ms`) esse vem da ficha.
- **As duas entradas não versionadas do motor antigo** (`tv/sigma-3emas.pine`, `.worktrees/`) ficam declaradas
  em `relatorios/us7.txt`: são anteriores a este recorte e não são dele.

## O que **não** foi medido

- Nenhum caso corre contra uma corretora: o equity, os números do resumo e o desfecho vêm de dublês.
- A bateria de conformidade por venue (RN-C6) e o protocolo do conector (RN-E20) são dos plugins, sob demanda.
- A superfície web (RN-E8/RN-E23) fica fora, como a spec declara.
- A pergunta em aberto do registo de transições (se `desde_ms` é o relógio do venue ou o nosso, FR-041) não
  foi fechada neste recorte.
