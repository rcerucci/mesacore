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

## O que falta para sair da bancada e ir a campo

Levantado a 29 set 2026, com o comando ao lado de cada linha. **A mesa pode ser declarada concluída para
teste — em bancada, contra dublês.** Para teste **com dinheiro numa conta** falta:

**1. Blocos que ainda não existem** (e são recortes próprios, sob demanda, como o dono decidiu):

| Bloco | Estado medido |
|---|---|
| Conector real (protocolo RN-E20 + conformidade por venue RN-C6) | nenhum: `contracts/mocks/conector/` é dublê |
| Setup (`setups/`) | só o `README.md` — nenhum setup escrito |
| Superfície web (RN-E8/RN-E23) | fora do âmbito do 003 (assunção declarada na spec) |

**2. Valores e decisões do dono.** O inventário ainda dá **nove** chaves como `[falta]`. Medido o que o código
lê hoje (`grep` em `core/` e `vigia/`):

| Chave | O código lê? |
|---|---|
| `bandas.saldo_pct` · `alavancagem` · `stop_pct` · `tp_pct` | **sim** — `core/ciclo/arranque.ts` valida a ficha contra elas (o `[falta]` é o **valor**, não o leitor) |
| `setup.prazo_de_resposta_ms` | **sim** — `core/servidor.ts` (`lerPrazoDoDono`); sem ela o `stop` com posição viva **recusa** |
| `conta.idade_maxima_do_dado_ms` | **não** — e o `core/ciclo/condicoes.ts` diz porquê, em comentário: «não é um limiar de idade: em varejo o silêncio do tick não distingue mercado calmo de ligação morta». **Isto contradiz a RN-D3, que fala de «limite declarado»** — há que reconciliar: ou a regra muda, ou o código muda |
| `conta.retencao_ledger` | **não** — a retenção (RN-L6) não está implementada |
| `tolera_posicao_manual` (RN-T16) | **não** |
| `bandas.tempo_maximo_em_posicao` (RN-S11) | **não** |

**3. Defeitos declarados em aberto** (`relatorios/DEFEITOS.md` do recorte 002):

> **Actualização — 29/09/2026:** o **D-001 está FECHADO** (`core/ciclo/banda.ts`, com o par de controle
> medido: `fora → reduzir_e_registar` **0 de 6** seguiram · `dentro → seguir` **0 de 8** reduziram ·
> `nao_conferivel → parar` **0 de 1** seguiu; `bun run core/ciclo/provar.ts` = **90 verificações · 0
> divergentes**, dentro de `provar.sh` **27 de 27**). O texto abaixo é o retrato de 29/09 antes disso, e
> fica escrito por ser auditável. Em aberto continuam **D-002**, **D-003** e **D-006**.

- **D-001 — a banda do mandato não é conferida em lado nenhum.** O mais sério para dinheiro real: passar o
  cálculo do risco para o plugin passa também o **limite**, e ninguém verifica a resolução contra a banda. Os
  dois momentos estão desenhados no defeito (antes de enviar, onde o venue deixa perguntar; e depois da
  resposta, sobre a **resolução**, com a resposta a ser **reduzir** e registar a divergência, nunca recusar o
  que já está executado).
- **D-002** — as três obrigações do conector não têm casa no manifesto.
- **D-003** — a fila da contenda não tem hora de chegada no arranque.
- **D-006** — a tabela trata «não sei» como «não há».
- **D-004** retratado; **D-005 fechado por este recorte** (a fronteira vigia↔mesa passou a ter mensagem no
  contrato, com quatro tipos e casos próprios).

**4. Uma pergunta em aberto:** no registo de transições, o `desde_ms` (FR-041) é o relógio do **venue** ou o
**nosso**? A decisão é do dono, e nenhum dos dois é errado — é preciso é escolher.

**Recomendação, na ordem:** (1) fechar **D-001**, porque é o único pendente que pode custar dinheiro;
(2) reconciliar a `idade_maxima_do_dado_ms` (regra contra código); (3) o **conector real**, que é o que
destrava a ida a campo; (4) o setup — que pode começar **manual**, e é o caminho mais curto para o dono operar
com a mesa a sério; (5) a superfície web, por último: ela consome, não decide.
