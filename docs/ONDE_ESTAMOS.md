# ONDE ESTAMOS — o retrato medido do MesaCore

medido em **29/09/2026, 21:37 (-03)** · `HEAD e08e6d3` · árvore **limpa** · contrato vigente **1.7.0**

Este é o documento que se abre primeiro. Cada número aqui foi medido nesta hora — o comando vem ao lado — e o
que não foi medido diz-se **não medido**, com a razão. Nenhum adjectivo substitui um número.

## 1. O que existe hoje — e o que você consegue abrir

| O que | Onde está | Você consegue abrir? |
|---|---|---|
| A regra de negócio (136), a máquina de estados, o inventário de chaves, o diagrama | `docs/` | Sim — leitura, no computador |
| O conector Hyperliquid: lê o venue, traduz, recusa, lê o histórico | `brokers/hyperliquid/` | **Não tem tela** — é peça de máquina, provada por comandos |
| A mesa e o vigia (o ciclo, a boleta, o ledger, a operação) | `core/`, `vigia/` | **Não tem tela** |
| A superfície web | `web/` | **Não existe**: o diretório tem só o `README.md` com as regras que ela deve cumprir |
| A conta de teste no venue | `config/contas/hl-teste-plugin.json` (fora do git) | Sim, no broker |

**Nada disto se abre no telefone.** Não há uma tela construída. O que existe é máquina e prova.

## 2. O que está feito e medido (bancadas corridas agora)

| Bancada | Comando | Número medido (29/09, 19:39–21:2x) |
|---|---|---|
| A porta única da máquina | `bash tools/verificar-maquina/provar.sh` | **27 de 27 passaram** (numa cópia com a árvore gravada — ver §4) |
| A **conferência da banda** (D-001, fechado hoje) | `bun run core/ciclo/provar.ts` | **90 verificações · 0 divergentes** — 12 de condição · 27 de ciclo · 10 de desfecho · **15 de banda** · 6 de reconciliação |
| A **tabela de transições** (D-006, fechado hoje) | `bun run core/estados/provar.ts` + `bun run tools/verificar-maquina/tabela.ts` | **38 casos · 13 aceites · 25 recusados · 0 divergentes** (eram 35) + **36 linhas · 0 falhas nos 7 invariantes** |
| A **fronteira** vigia ↔ mesa (motivos) | `uv run python tools/verificar-contrato/py/fronteira.py --motivos` | **0 falhas** — livro **50** motivos · **26** cruzam · 24 ficam · **1** excepção da porta |
| O conector, offline | `bash tools/verificar-conector/provas-offline.sh` | **0 falhas** — credencial 9 · manifesto **24** · ordens+cloid **40** · leitura 14 · histórico **26** |
| **O caminho do envio** (tradutor + processo) | `bun run brokers/hyperliquid/processo.ts --bancada` | **38 casos · 38 ok · 0 divergentes · 262 verificações · 8 portas** |
| A conformidade do conector | `bun tools/verificar-conector/conformidade.ts` | **9 de 9 · 241 verificações · 0 divergentes** (a linha do venue diz `INCOMPLETO` — nunca `passou`) |
| O contrato nas duas linguagens | `bun tools/verificar-conector/porta-do-contrato.ts` | **0 falhas** — contrato **1.7.0** · **131 casos** nos dois motores · 23 sondas da emenda |
| As tarefas dos recortes | `grep -c '^- \[x\]' specs/*/tasks.md` | 001 **59/59** · 002 **67/67** · 003 **63/63** · 004 **71 fechadas · 3 abertas** |
| O tamanho do que é nosso | `git ls-files` + `wc -l` | **17.895+** linhas de TypeScript · 2.980 de Python · 3.499 de shell |

## 3. O que NÃO existe (e não é «espera» — é falta)

- **Uma regra que não corre: D-007** (declarado hoje, ao fechar o D-006). A recusa `liquidacao_em_curso`
  (FR-013) está escrita na tabela e **funciona quando o contexto a declara** — mas **ninguém a declara**:
  medido por grep, **0 atribuições** desse campo em todo o repositório. Numa corrida a sério, `encerrando +
  start` cai sempre na linha `sempre` e volta a `em_operacao`. A decisão (trazer o estado da liquidação ao
  contexto, ou assumir que `start` durante `encerrando` é sempre «não feche») é do desenho.
- **A medição do envio contra o venue.** O envio **existe** desde hoje — o conector assina e submete (T072), com
  a régua conferida e a porta `identidade` a travar quem não é agente desta conta (T073) — e está provado em
  bancada: **38 casos · 0 divergentes** (eram 36 antes da emenda 1.7.0). O que **não** existe é uma ordem a sério: nenhuma foi enviada, e a
  conta continua sem posição (ver §6). Enviar é **decisão sua**, um de cada vez.
- **A superfície web** — só o `README.md` com as regras.
- **O registador automático da bateria** — o `conformidade.sh` que o `plan.md` §D3 e o `quickstart.md` nomeiam
  não existe; o registo `brokers/hyperliquid/conformidade/1.4.0.txt` foi escrito **à mão**.
- **A bateria de TESTE do venue** (as 8 provas do SC-004) — a que existe é offline e declara-se incompleta.

## 4. O que mudou nesta vaga — os três itens (medido, e o terceiro gravado agora)

1. **A conferência da banda** (defeito **D-001**) passou a existir: `core/ciclo/banda.ts` confere a resolução
   contra a banda do mandato, em três comparações, e liga-a nos dois sítios onde a resolução e a acção vivem.
   O que **não se consegue conferir** não vira «cabe»: é `nao_conferivel` e **trava a abertura**. **FECHADO.**
2. **O envio passou a existir** (`brokers/hyperliquid/ordens.ts` deriva o preço de envio do desvio declarado,
   com a régua (a marca) conferida **antes** de o preço ser quantizado — a ordem do defeito estava trocada, e
   era isso que deixava uma marca estragada ir ao envio; `processo.ts` assina e submete; `identidade.ts` é a
   8ª porta do arranque, que trava quem não é agente desta conta). **FECHADO.**
3. **As três obrigações do conector** (defeito **D-002**) passaram de prosa a **contrato 1.7.0**: o manifesto
   declara `ligacao_por_protocolo`, `releitura_de_preco_ao_enviar` e `devolve_a_resolucao`, cada uma **medida**
   pela sonda no arranque, e a mesa **não arranca** sem elas — ausente recusa o contrato, presente e `false`
   recusa a porta `manifesto` da mesa **nomeando qual**. **FECHADO** (`relatorios/emenda-1.7.0.txt`).
4. **A tabela deixou de tratar «não sei» como «não há»** (defeito **D-006**): as guardas da posição viva e das
   portas do arranque passaram a distinguir os **três** casos, cada desconhecido tem guarda e linha próprias, e
   a mesa **recusa** (`posicao_desconhecida`, `porta_do_arranque_falhou` nomeando `(nao conferidas)`) em vez de
   parar sem perguntar ou arrancar sem conferir. **FECHADO** — e um chamador que **dependia** do defeito foi
   apanhado pela bancada (o dia do `registo.ts`).‌
5. A banda da moeda passou a ser a medida (contrato 1.6.0, `^[A-Za-z0-9]{1,11}$`) — e o número `1400 trazem
   dígito`, que estava no esquema, na porta e no `versao.json`, foi **corrigido para 72** (contava também nomes
   de *pares* de spot, que não são moedas).
6. O *stash* que estava parado foi **aplicado** e não há nada em stash: o trabalho vinha com **3 casos
   divergentes**, e um deles era sério (o do ponto 2).

Os dois primeiros itens estão no commit `af70d46`; o terceiro no `905fc03`; o quarto é o desta vaga.
`provar.sh` dá **27 de 27** com a árvore **gravada** — no repositório, a única porta que fica vermelha antes de
gravar é a **prova negativa da frescura**, e por uma razão mecânica e dita: ela exige `contracts/gerado`
**limpo em git** antes de correr.

As três tarefas abertas do recorte 004 pedem todas **enviar** ao venue: **T042** (SC-003, a contagem de
idempotência lá), **T048** (SC-007, os cinco números com posição viva), **T057** (SC-004, as 8 provas no
ambiente de TESTE). A passagem a produção (`conexao.ambiente: producao`) é decisão sua.

## 5. Contradições achadas nos documentos duráveis (medidas, e corrigidas aqui)

| Documento | O que ele dizia | O que se mede agora | O que foi feito |
|---|---|---|---|
| `README.md` §«O que existe hoje» | descreve só os recortes 001–002 | 003 fechado e 004 medido | nota datada no próprio README |
| `specs/004/relatorios/RESULTADO.md` | «contrato: **1.4.0**» e «o **FR-018 não está implementado**» | contrato **1.5.0**; o leitor do histórico **existe** e o contrato **aceita** a carga real (**26 casos ok**) | correcção datada no topo, com o original por baixo |
| `specs/004/tasks.md` §«O que fica aberto» | «o CONTRATO recusa a carga» / «não se remenda por aqui» / «histórico: 24 casos» | a emenda **foi feita** (`3b730ec`) e a carga é **aceite**; **26** casos | correcção datada na própria secção |

## 6. O venue, medido agora (só leitura, sem chave)

`clearinghouseState` da conta `0xF87138D298E338962E1a2e0ff23267Dc32c15621`, **29/09 19:42**, pelo endpoint
público `info`:

```
{"accountValue":"998.46","totalNtlPos":"0.0","totalMarginUsed":"0.0","assetPositions":[],"time":1790721777963}
```

`openOrders` → `[]` · `frontendOpenOrders` → `[]`. **Nenhuma ordem foi enviada; não há posição aberta.** O
histórico de execuções que existe na conta (56 execuções, `userFills`, 17.988 bytes) é **anterior** a esta
entrega — a data da última é a da sonda de 30/09, e nenhuma tem `cloid` (415 de 415 nulos).

## 7. As armadilhas que não se vêem na tela

- **O repositório não tem remoto** (`git remote -v` → vazio): não existe cópia fora deste disco. O histórico,
  os quatro recortes e as 257 tarefas fechadas vivem num só sítio.
- **O trabalho do envio está num stash**, não num ramo: um `git stash drop` distraído apaga-o (e os 2 ficheiros
  novos só existem lá dentro).
- **A chave da conta passa por ficheiro** (`config/contas/` aponta para
  `~/.config/mesacore/credenciais/hl-teste-plugin.key`): quem assinar tem de sair **do carregador por
  referência**, e o valor nunca entra em log nem no repositório (RN-E14) — o stash foi escrito com essa regra
  escrita no cabeçalho do `identidade.ts`, mas isso é **alegação até a bateria de varredura correr sobre ele**.

## 8. A ação que depende de você (uma só)

**Autorizar (ou não) o primeiro envio a sério — um só, com você a conferir no broker.** O que existe hoje é
um conector que **sabe mandar** e está provado contra o dublê; o que falta é a ordem real, e essa é sua.

O que eu proporia, pela ordem que combinou a 29/09 (do menos capital ao mais, **um envio de cada vez**):

1. **um** envio a mercado de nocional mínimo no instrumento de **maior liquidez** entre BTC/SOL/ETH (medido, não
   suposto) — e eu paro aí, com a saída crua na mão: o pedido (sem a chave), a resposta inteira do venue, o
   `order_id`, o `cloid`, o preenchimento e a leitura da conta depois;
2. depois disso, **a sua conferência no broker** — e só então se decide o resto (idempotência com a mesma
   referência, as recusas do venue que não custam capital, o limite `post-only` e o cancelamento, os cinco
   números com a posição aberta, e o fecho com `reduceOnly`, que **só** com sinal explícito seu).

Ficam **de fora**, como decidiu: as ordens dimensionadas por percentagem de saldo e as que mexem em alavancagem.

E há uma coisa que continua pendente e não é do conector: **nada deste trabalho está gravado em git** — 2
ficheiros novos e ~55 modificados, com o `provar.sh` a fechar 27 de 27 só numa cópia onde a árvore está gravada.
Diga-me se gravo, e o repositório fica com a vaga inteira num commit.

Não faço o envio sem a sua palavra: mexe em ordens na sua conta.
