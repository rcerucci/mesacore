# Tasks: O primeiro conector real — Hyperliquid, em ambiente de teste

**Input**: `specs/004-conector-hyperliquid/` — `spec.md` (7 histórias, 28 FR, 8 SC), `plan.md` (as cinco
decisões), `research.md` (R1–R9).

**Testes**: incluídos **não por opção** — o portão da constituição diz que o teste que recusa a regra existe
**antes** do código que a cumpre. Aqui, «teste» é a **bancada declarada**: casos em dado, um por regra, e a
contagem no fim. Duas bancadas: a que **não** precisa do venue (corre sempre) e a que corre no **ambiente de
teste** (a bateria de conformidade).

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.

**Estado da execução** (medido em 29/09, contrato em **1.4.0**): fechadas a **fase 1**, a **fase 2** (T010
incluído — a porta de processo existe e está medida) e a **fase 10** (a emenda que os dois achados de
`data-model.md` §7 exigiram — `relatorios/emenda-1.4.0.txt`), e com elas a tradução (US2), a derivação da
referência (US5), a leitura das **duas** carteiras (US6, T071) e a bateria de conformidade **offline** (US7).
O que **fica aberto** é o que precisa do venue **com chave**: as provas no ambiente de TESTE (SC-004), o
registo por versão e data, e os relatórios de US2/US3/US4/US7. Este recorte não cria tipo novo (R8): a
emenda 1.4.0 acrescentou campos e motivos ao que já existia, e o conector fala o que já existe. Linha de
base em `relatorios/linha-de-base.txt`.

---

## Fase 1 — Preparação e linha de base (T001–T005)

- [x] T001 Medir a linha de base e escrevê-la em `relatorios/linha-de-base.txt`: `provar.sh` (25 de 25), casos do contrato (100), versão do contrato (1.3.0), e os ficheiros do outro projeto tocados (**0** — o motor antigo é oráculo, não se toca) — **feito:** `relatorios/linha-de-base.txt` (contrato 1.3.0, 12 esquemas, 100 casos iguais nos dois runners (66 recusados · 34 aceites), 47 motivos, `provar` 25 de 25, oráculo 0 modificados)
- [x] T002 [P] Criar `brokers/hyperliquid/` com `README.md` (o que este conector entrega, e o que não) e `.gitignore` (o manifesto do runtime e a `conformidade/` fora do versionamento) — **feito:** `brokers/hyperliquid/{README.md,casos/}` e o `.gitignore` com o manifesto do runtime e a `conformidade/`
- [x] T003 [P] Escrever `data-model.md`: manifesto, boleta, resolução, desfecho, leitura — campo a campo, com a origem de cada número (venue, nossa conversão, ou ausente) — **feito:** `data-model.md`, com os dois achados do contrato (§7)
- [x] T004 [P] Escrever `quickstart.md`: como correr a bateria offline e a do venue, e onde ler o resultado — **feito:** `quickstart.md`
- [x] T005 Pedir ao sysadmin as duas dependências (D1) e registar o pedido; **enquanto não houver resposta**, as tarefas que não precisam do SDK seguem (as de tradução, recusas e derivação da referência correm contra o dublê) — **feito:** cartão `t_20cd5c48` (assignee `sysadmin`) **fechado**: `@nktkas/hyperliquid@0.33.3`, `viem@2.57.0` e `ajv@^8.20.0` declarados na raiz. A terceira dependência entrou **por medição**: os corredores importavam `ajv` sem ele estar declarado (vinha do auto-install global do `bun`) e a bancada passava por acidente — com o manifesto na raiz o fallback desligou e a bateria caiu a 25/26; agora há a porta `tools/verificar-conector/porta-das-dependencias.ts` a trancar a repetição. Commits `ae33a52`, `131fb1d`

## Fase 2 — Fundacional: o conector de pé e o manifesto (T006–T014) — **US1**

- [x] T006 [US1] `brokers/hyperliquid/casos/manifesto.casos.json`: casos da sonda (instrumento existente, instrumento inexistente, limite que muda, venue indisponível) — com `esperadoOk`/`motivo_esperado` — **feito:** 16 casos em dado (9 do manifesto + 7 de capacidade, um por cada booleana)
- [x] T007 [US1] `brokers/hyperliquid/manifesto.ts`: a sonda (instrumentos, `szDecimals` e passo, alavancagem máxima, tipos de ordem, mínimo, taxas da conta, funding) e a publicação do manifesto — **nenhum** destes valores constante no código (FR-001, FR-002) — **feito:** `brokers/hyperliquid/manifesto.ts` (funcao pura: recebe a sonda e devolve o manifesto, ou recusa nomeada) — nenhum valor do venue escrito no codigo
- [x] T008 [US1] Recusa nomeada para instrumento inexistente, dizendo **qual** (FR-003) — **feito:** instrumento inexistente recusa com `valor_fora_do_conjunto` e o nome do instrumento
- [x] T009 [US1] O manifesto declara o que o venue **não** oferece e a forma da referência do venue (FR-004, FR-005) — **feito:** o manifesto declara `stop_anexo`, `reduce_only_suportado`, `estado_do_mercado`, `marca_de_posse` — e ausencia de capacidade e RECUSA (`capacidade_nao_declarada`), nunca `true` por omissao
- [x] T010 [US1] `brokers/hyperliquid/processo.ts` — **o nome REAL é este**: este plano dizia `processos.ts` e o que existe é `processo.ts` (singular); o plano alinha-se ao código, que não se renomeia. A porta de processo (arrancado pelo vigia, uma ligação, uma chave) (FR-019 a FR-024) — **feito e medido:** o executável é o `processo.ts` (é ele que tem o `stdio`; a máquina vive no `conector.ts`), com 10 casos da porta em `casos/processo.casos.json`, a bancada `bun run brokers/hyperliquid/processo.ts --bancada`, e a linha do dublê de mesa na bateria de conformidade. Saídas cruas em `relatorios/processo.txt`
- [x] T011 [US1] `tools/verificar-conector/provas-offline.sh`: correr os casos do manifesto contra o dublê e contra o conector (o que não precisa de rede) — **feito:** `tools/verificar-conector/provas-offline.sh` — 0 falhas, com prova negativa e cura provada por sha256
- [x] T012 [US1] Bancada `tools/verificar-maquina/provar.sh` ganha a linha do conector; medir e escrever em `relatorios/us1.txt` — **feito:** a linha entrou na bateria geral — `provar` **26 de 26**; saidas cruas em `relatorios/us1.txt`
- [x] T013 [US1] O manifesto do runtime entra no `.gitignore` (a **forma** versiona-se, o conteúdo não — D2) — **feito:** `brokers/*/.manifesto.json` e `brokers/*/conformidade/` no `.gitignore`
- [x] T014 [US1] Commit da US1 e resumo ao dono — **feito:** commit e resumo ao dono

## Fase 3 — A tradução e as recusas (T015–T022) — **US2**

- [x] T015 [US2] Casos da tradução: fora do passo, abaixo do mínimo, preço com casas a mais, alavancagem fora do intervalo, post-only que cruza, reduce-only — **feito:** `brokers/hyperliquid/casos/ordens.casos.json` — **32 casos** (26 da tradução + 6 da referência), todos nomeados no caso: `abaixo-do-minimo-de-10-usd`, `quantidade-abaixo-do-passo`, `preco-com-casas-a-mais-do-que-o-tick`, `alavancagem-acima-do-maximo`, `nao-inteira`, `zero`, `limite-post-only-aceite-e-preco-exacto`, `reduce-only-pedido-e-honrado`… Medido: `ordens: 32 casos · 32 ok · 0 divergentes`
- [x] T016 [US2] `brokers/hyperliquid/ordens.ts` — **o nome REAL é este** (este plano dizia `traducao.ts`): percentagem do saldo/alavancagem/percentagens → quantidade e preço na unidade do instrumento (FR-006) — **feito:** a tradução vive no `ordens.ts`, e o corredor é `bun brokers/hyperliquid/casos/correr-ordens.ts`
- [x] T017 [US2] **Nenhum arredondamento silencioso**: cada caso fora de regra é recusa **com motivo**, e nenhuma ordem é enviada (FR-007) — a diferença declarada face ao motor antigo — **feito:** as recusas saem com motivo do vocabulário fechado do contrato (conferido contra `contracts/vocabulario.json`, não contra um literal), e o preço devolvido é, caracter a caracter, o que entrou; o envio só acontece depois da tradução OK (`— e nao se arredonda para caber (RN-C9)` no `conector.ts`)
- [x] T018 [US2] Alavancagem: só inteiro dentro do intervalo aceite; fora disso, recusa com o máximo nomeado (FR-008) — **feito:** casos `alavancagem-acima-do-maximo-recusa-e-nomeia-o-maximo`, `alavancagem-nao-inteira-recusa`, `alavancagem-zero-recusa`, e os aceites 1, 2, no máximo do instrumento e 17 («nao e degrau nenhum»)
- [x] T019 [US2] Post-only: nunca corrigir preço para caber; se cruzar, é recusa (FR-009) — **feito:** `limite-post-only-aceite-e-preco-exacto` (o preço sai exacto) e `preco-com-casas-a-mais-do-que-o-tick-recusa` / `preco-com-6-algarismos-significativos-recusa`
- [x] T020 [US2] Reduce-only: pedido, e a capacidade declarada no manifesto (FR-010) — **feito:** `reduce-only-pedido-e-honrado` e `reduce-only-nao-declarado-no-manifesto-recusa` (capacidade não declarada é RECUSA, nunca `true` por omissão)
- [ ] T021 [US2] Casos + bancada medidos; `relatorios/us2.txt`
- [ ] T022 [US2] Commit da US2 e resumo ao dono

## Fase 4 — A resolução e o desfecho (T023–T030) — **US3**

- [ ] T023 [US3] Casos da resolução e do desfecho (aceite, parcial, recusado com a palavra do venue, e a ordem que produz cada um)
- [ ] T024 [US3] Resolução **antes** do envio, com quantidade, nocional, margem, alavancagem e preço de liquidação (FR-006, FR-012)
- [ ] T025 [US3] `brokers/hyperliquid/desfecho.ts`: normalização nas quatro classificações, com os números do venue (FR-012)
- [ ] T026 [US3] Recusa com o motivo **do venue**, nunca interpretado (FR-012)
- [ ] T027 [US3] Nada se deduz por contagem própria: o que não está no venue é `desconhecido` (FR-015)
- [ ] T028 [US3] Conferência contra o contrato (o envelope e o esquema de cada mensagem) — portão automático
- [ ] T029 [US3] Medições em `relatorios/us3.txt`
- [ ] T030 [US3] Commit da US3 e resumo ao dono

## Fase 5 — Silêncio é estado (T031–T038) — **US4**

- [ ] T031 [US4] Casos do silêncio: espera dentro do prazo, desconhecido depois, reconciliação que encontra posição, pedido novo recusado, fecho permitido
- [ ] T032 [US4] `espera` dentro do prazo declarado e `desconhecido` depois — nunca sucesso (FR-013)
- [ ] T033 [US4] Reconciliar antes de agir: posição, ordens abertas e execuções desde o instante (FR-014)
- [ ] T034 [US4] Com `desconhecido` pendente, **abertura** recusada e **fecho** permitido (FR-014)
- [ ] T035 [US4] O estado da ligação pelo protocolo do venue; silêncio = `desconhecido` (FR-020)
- [ ] T036 [US4] Sem leitura da conta, nenhuma ordem que aumente exposição (FR-021)
- [ ] T037 [US4] Medições em `relatorios/us4.txt`
- [ ] T038 [US4] Commit da US4 e resumo ao dono

## Fase 6 — A mesma referência não duplica ordem (T039–T043) — **US5**

- [x] T039 [US5] Casos da idempotência (mesma referência duas vezes; referência com forma inválida para o venue) — **feito:** `ordens.casos.json` §`checagens_de_cloid` (3) + §`checagens_de_recusa_do_cloid` (3): `mesma-referencia-da-sempre-o-mesmo-cloid`, `instrumento-diferente-da-cloid-diferente`, `referencia-com-espaco-recusa`, `instrumento-fora-da-forma-recusa`, `conta-nula-recusa`
- [x] T040 [US5] Derivação da referência para a forma do venue, **pura e declarada** (sem instante dentro) (FR-011) — **feito:** `brokers/hyperliquid/cloid.ts`, com a derivação declarada em texto e conferida pela bancada: `sha256("mesacore/cloid/v1" + conta + instrumento + referencia_do_cliente)`, primeiros 16 bytes, `0x` + 32 hexadecimais minúsculos; a mesma boleta dá a MESMA acção (não há relógio nem aleatoriedade dentro)
- [ ] T041 [US5] Duas boletas com a mesma referência → **uma** ordem, mesmo desfecho nas duas respostas (FR-011)
- [ ] T042 [US5] Medição com contagem no venue (SC-003) em `relatorios/us5.txt`
- [ ] T043 [US5] Commit da US5 e resumo ao dono

## Fase 7 — As leituras e os cinco números (T044–T049) — **US6**

- [x] T044 [US6] Casos das leituras (posição viva, sem posição, leitura falhada) — **feito:** `brokers/hyperliquid/casos/leitura.casos.json`, **14 casos** (posição viva com e sem liquidação publicada, zero posições ≠ sem leitura, cada carteira a falhar sozinha, as duas a falhar, `equity` a `null`/número/expoente). Medido: `leitura: 14 casos · 14 ok · 0 divergentes`
- [x] T045 [US6] `brokers/hyperliquid/leitura.ts` — **o nome REAL é este** (este plano dizia `leituras.ts`): posição, equity, marcas e os **cinco números** do resumo do encerramento, com a origem nomeada (FR-016) — **feito:** `leitura.ts`, com a origem de cada grandeza declarada, e a leitura passou a caber nos TRÊS padrões de decimal do contrato (`contracts/_defs/forma.schema.json`) por campo, como o contrato os declara
- [x] T046 [US6] Sem posição, a distância de liquidação é **ausente** (nunca zero); leitura falhada é dita como falha (FR-017) — **feito:** `posicao-com-liquidacao-a-null-a-distancia-fica-AUSENTE`, `sem-withdrawable-a-carteira-do-perpetuo-fica-nao_lida`, `perpetuo-falha-recusa-as-posicoes-nao-se-leem`, `as-duas-carteiras-falham-recusa-nomeando-as-duas`
- [ ] T047 [US6] Histórico do venue (execuções, taxas, funding, resultado realizado) sem reconstrução (FR-018)
- [ ] T048 [US6] Medição dos cinco números contra o venue, no mesmo instante (SC-007) em `relatorios/us6.txt`
- [ ] T049 [US6] Commit da US6 e resumo ao dono

## Fase 8 — A bateria de conformidade (T050–T058) — **US7**

- [x] T050 [US7] `tools/verificar-conector/conformidade.ts` — **o nome REAL é este** (este plano dizia `conformidade.sh`): a bateria offline, com **NOVE** provas (o plano dizia oito; a nona entrou na emenda), cada uma dizendo o que mediu — **feito:** `bun tools/verificar-conector/conformidade.ts` → **9 de 9 passaram · 238 verificações · 0 divergentes**, e o que ela **não** prova está dito em voz alta no cabeçalho (nada do venue — FR-026)
- [x] T051 [US7] Prova 1: manifesto sondado (o instrumento inventado recusa) e Prova 2: passo e mínimo (recusa, nunca arredonda) — **feito:** prova 1 = a forma de toda mensagem contra o envelope e o esquema do seu tipo; prova 9 = instrumento que não existe no manifesto, recusa NOMEADA dos dois lados
- [x] T052 [US7] Prova 3: degrau de alavancagem (recusa e nomeia o máximo) e Prova 4: post-only não cruza — **feito:** prova 3 = as duas versões (`versao` = do contrato, `conector.versao` = do plugin, com a prova negativa trocada); prova 4 = o vocabulário fechado, com as quatro provocações a terem de reprovar
- [x] T053 [US7] Prova 5: reduce-only não aumenta posição e Prova 6: idempotência (uma ordem) — **feito:** prova 5 = o manifesto é FUNÇÃO PURA da sonda (capacidade não declarada recusa, nunca `true`); prova 6 = a costura fecha e a mesa fica sem vigia
- [x] T054 [US7] Prova 7: desconhecido e reconciliação e Prova 8: histórico bate com o venue — **feito:** prova 7 = as SETE portas do arranque (a ordem, a primeira que falha, e o motivo dela); prova 8 = nenhum valor de credencial no repositório (RN-E14), com os dois controlos do varrimento
- [ ] T055 [US7] Registo por **versão e data** em `brokers/hyperliquid/conformidade/<versao>.txt`; prova que não corre deixa o resultado **incompleto** (FR-025, FR-026)
- [ ] T056 [US7] Onde a documentação oficial não for conclusiva, medir e **escrever no manifesto** (FR-027) — os três casos de R9
- [ ] T057 [US7] Correr a bateria no ambiente de teste e medir (SC-004); `relatorios/us7.txt`
- [ ] T058 [US7] Commit da US7 e resumo ao dono

## Fase 9 — Fecho do recorte (T059–T065)

- [ ] T059 [US8] Alavancagem e leituras de borda: os casos de `liquidationPx` nulo, pedido de outra conta, credencial ausente (FR-022, FR-023)
- [ ] T060 [US9] Histórico e taxas: casos do histórico sem reconstrução (FR-018) — se não couber na US6, é história própria
- [x] T061 Prova de que o conector **não importa o `core`** (RN-E1), por comando, e de que não contém regra de decisão (FR-024) — **feito:** a porta da própria bateria: `porta: importa contracts, nunca o core (RN-E1)  OK  0 importacoes do core em brokers/hyperliquid` (`tools/verificar-conector/provas-offline.sh`)
- [x] T062 Varredura de credenciais (RN-E14) em `brokers/`, `docs/` e `config/`: **zero** valores — **feito:** é a prova 8 da bateria de conformidade, e ela traz os **dois controlos** (o varrimento tem de saber ENCONTRAR o que existe, senão o zero não mede nada)
- [ ] T063 `relatorios/RESULTADO.md`: os 8 SC, cada um com o comando que o mediu e o número que saiu
- [ ] T064 Actualizar `docs/inventario-de-chaves.md` (§ do conector: as chaves que ele passou a ler, cada uma com o leitor nomeado) e `docs/diagrama-de-blocos.html` (o conector real ao lado do dublê)
- [ ] T065 Resumo ao dono: o que ficou provado, o que ficou por provar, e a decisão de passagem a produção (que é dele)

## Fase 10 — O contrato aditivo que os dois achados exigem (T066–T070)

*Achados em `data-model.md` §7, ao ler os esquemas do contrato. São **fundacionais** (a leitura da conta vem
antes da US6), por isso esta fase corre **antes** da Fase 4. A numeração é acrescentada no fim em vez de
renumerar 65 tarefas — renumerar reescreveria o ficheiro e não muda nada do que ele diz.*

- [x] T066 [Fase 4] Os quatro números que faltam: `posicao` ganha `nocional`, `margem`, `distancia_de_liquidacao` e `resultado_nao_realizado` (opcionais, e ditos como «do venue, nunca recalculados») — contrato sobe para **1.4.0** — **feito:** `contracts/versao.json` = **1.4.0**, e a emenda inteira (as quatro decisões, com o que o venue real obrigou) está medida em `relatorios/emenda-1.4.0.txt`
- [x] T067 [Fase 4] `distancia_de_liquidacao` **ausente** quando não há posição: caso feliz (com posição) e adversário (sem), com `esperadoOk` nos dois — **feito:** os dois casos nos `contracts/casos/` (os dois runners) e no `leitura.casos.json` do conector, com `esperadoOk` nos dois sentidos
- [x] T068 [Fase 4] `preco_de_liquidacao` passa a admitir um **valor neutro** do conjunto fechado (o precedente é `relogio_de_fecho_de_barra`, com `desconhecido` no enum) — zero continua a significar «1x», nunca «não sei» — **feito:** o valor neutro entrou no conjunto fechado, e a leitura de uma liquidação a `null` **não** a transforma em zero (caso `posicao-com-liquidacao-a-null-a-distancia-fica-AUSENTE`); a distância passa a sair em `porcento_da_marca` com a marca declarada
- [x] T069 [Fase 4] Os mesmos casos novos nos **dois** runners do contrato (a igualdade das duas linguagens é a prova de que a emenda é aditiva e não uma segunda verdade) — **feito:** os casos novos correm nos dois runners e a contagem antes/depois está registada; a conformidade confere a fidelidade das duas linguagens sobre os MESMOS casos (`0 divergentes`)
- [x] T070 [Fase 4] Correr `provar.sh` + a conferência dos casos e registar a contagem antes/depois em `relatorios/us3.txt` (o que já corria não se perde) — **feito:** medido junto da emenda (`relatorios/emenda-1.4.0.txt`); nenhum caso que já corria se perdeu — a bateria fechou a **27 de 27** com a emenda, a conformidade a **9 de 9** e os casos do conector a **0 divergentes**

- [x] T071 Ler o saldo nas DUAS carteiras do venue (perpetuo e spot) — e nunca confundir uma com a outra
      Porque (medido no venue, 29 set): a conta de teste respondeu `clearinghouseState.accountValue = 0.0`
      enquanto tinha **998.464965 USDC no spot** (`spotClearinghouseState`). Quem so le o perpetuo conclui
      «conta sem fundos» e recusa operar — com o dinheiro la dentro. A leitura tem de declarar a carteira de
      cada valor, e o manifesto tem de declarar que este venue tem duas. Sem isto, a porta que julga a margem
      fecha por engano, e um engano que fecha e tao mau como um que abre.
      — **feito e medido:** `brokers/hyperliquid/leitura.ts` lê as duas carteiras, cada valor com a carteira
      nomeada, e a bancada prova-o em 14 casos (incluindo «uma carteira falha e a outra lê-se», e as duas a
      falhar a recusar pelo NOME das duas). A sonda leva as duas ao manifesto. Relatório: `relatorios/sonda-real.txt`

---

## O que fica aberto (medido, não digitado)

Medido em 29/09 com `provar.sh` (27 de 27), `provas-offline.sh` (0 falhas) e a conformidade (9 de 9):

- **Do venue, com chave** (é o que falta de mais pesado): **T057** (SC-004 — as provas no ambiente de TESTE),
  **T042** (contagem no venue, SC-003), **T048** (os cinco números contra o venue, SC-007).
- **Registo e relatórios:** **T055** (`brokers/hyperliquid/conformidade/<versao>.txt` — o directório ainda não
  existe), **T021** (`relatorios/us2.txt`), **T029** (`us3.txt`), **T037** (`us4.txt`), **T063** (`RESULTADO.md`).
- **Código por fechar:** **T025** (o `desfecho.ts` — hoje a normalização vive dentro do `conector.ts`),
  **T027**, **T047/T060** (histórico e taxas), **T059** (bordas de leitura), **T056** (os três casos de R9).
- **Fecho administrativo:** **T022**, **T030**, **T038**, **T043**, **T049**, **T058** (commits e resumos, que
  seguem os relatórios acima), **T064** (inventário de chaves e diagrama), **T065** (resumo ao dono e decisão
  de passagem a produção — que é dele).
