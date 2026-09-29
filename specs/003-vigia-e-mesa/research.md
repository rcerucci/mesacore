# Research — o vigia, a mesa e os dublês (recorte 003)

As decisões deste recorte, com a alternativa que foi considerada e **por que não**. Formato: decisão, razão,
alternativas recusadas.

## R1 — A forma do comando não se inventa aqui: ela **já existe** no recorte 002, e sobe a mensagem

**Decisão:** a mensagem do comando leva, dentro do envelope, a **mesma forma** que o interpretador da mesa já
valida hoje — `{verbo, autor, pedido_id, motivo?}` —, com a mesma regra: **campo a mais é recusado**, não
ignorado.

**Razão (medida):** `core/estados/comando.ts` já traz essa forma, com a validação escrita e justificada
(`comando_com_campo_a_mais`, `comando_incompleto`, `comando_com_tipo_invalido`), e o `specs/002 .../contracts/interface.md`
§1 já a documentava — como **interface interna**. Este recorte não desenha nada: **re-aloja** o que existe, sem
mudar a forma, para que a fronteira passe a ser a mesma coisa com contrato à volta.

**Alternativas recusadas:** (a) redesenhar o comando agora — não há ganho e cada campo mudado é um caso de
bateria a reescrever, sem motivo; (b) argumentos de linha de comando por posição — não teria versão, não teria
vocabulário e não teria recusa com motivo, ou seja, perderia as três coisas que este recorte vem comprar.

## R2 — A versão do contrato sobe para **1.1.0**, e é aditiva

**Decisão:** `contracts/versao.json` passa a `1.1.0`; entram **quatro** tipos de mensagem (R5) e a família de
motivos do comando (R7). Nada do que existia muda de sentido.

**Razão:** a versão é comparada por **igualdade exacta** (D7 do recorte 001) — quem não conhece o tipo novo
recusa com `tipo_desconhecido`, que é comportamento **declarado**, não um comportamento novo. A mudança é
**detectada** em vez de sofrida (RN-C7). **Custo medido:** a versão aparece **354 vezes em 45 ficheiros** — a
subida é um acto com contagem, e a tarefa mede zero ocorrências de `1.0.0` fora do histórico no fim.

**Alternativas recusadas:** manter `1.0.0` com o comando fora do contrato (um acordo tácito entre dois
processos — o defeito que o D-005 nomeou); um segundo documento de contrato só para esta fronteira (duas
versões na mesma mensagem, e a segunda seria esquecida); aceitar as duas versões «por compatibilidade» (é a
adaptação em silêncio que a constituição proíbe, princípio II).

## R3 — A costura é **stdin/stdout com uma linha JSON por mensagem**

**Decisão:** o vigia e a mesa falam por **processos** com uma linha JSON por mensagem; a resposta volta pela
saída padrão, uma linha por resposta.

**Razão (medida):** é a forma que os dublês **já usam** e que a bateria já exercita:
`echo '<mercado>' | bun run mocks/setup/main.ts` e `echo '<boleta>' | uv run python contracts/mocks/conector/main.py`.
Uma forma nova obrigaria a dois mecanismos de costura no mesmo sistema — e o segundo é o que apodrece.

**Alternativas recusadas:** socket TCP (mais maquinaria, mesma fronteira, e nada aqui precisa de rede);
chamada em processo (não seria fronteira: mataria a RN-V6, a garantia de que a mesa sobrevive ao vigia);
ficheiro de comandos com *polling* (ordem e latência mal definidas — e uma fila de intenções sem relógio).

## R4 — A porta de processo da mesa é **magra**, e não decide nada

**Decisão:** `core/servidor.ts` lê uma linha, entrega ao intérprete da mesa e devolve **uma** linha. Não tem
log próprio, não lê configuração que a mesa já lê, não decide nada.

**Razão (medida):** a mesa **não tem** porta de processo hoje — nenhum ficheiro de `core/` lê `stdin` (só os
tipos do Node em `node_modules`). Sem porta, «arrancar a mesa» não existe, e metade do que o vigia faz não tem
onde acontecer. E magra porque uma porta que começa a decidir torna-se um segundo caminho para as mesmas
decisões — o defeito dos **falsos botões**, que este projecto já pagou uma vez (15 chaves declaradas, 9 sem
leitor).

**Alternativas recusadas:** pôr a decisão na porta (seria um terceiro intérprete da mesma regra); fazer o
vigia importar `core/mesa.ts` (não seria processo separado — e é precisamente o que a US2 existe para provar
que não é).

## R5 — O encerramento ganha **dois tipos**, e **não** um sexto verbo

**Decisão:** a mesa **pergunta** (`pergunta_do_encerramento`: resumo, opções, prazo, aviso de manter) e o vigia
**traz a decisão** (`decisao_do_encerramento`: `fechar_a_mercado` ou `manter`, com o `pedido_id` da pergunta).

**Razão (medida):** o recorte 002 já modela isto por dentro — `core/ciclo/encerramento.ts` recebe
`{resposta: "fechar_a_mercado" | "manter" | null}` e devolve o `ResumoDoEncerramento` com `opcoes`,
`prazo_de_resposta_ms` e `aviso_de_manter`. O que falta é a **mesma coisa atravessar**. E a decisão **não é um
verbo**: os verbos do vigia são **cinco** (RN-V1) e o `verbo_desconhecido` diz, no próprio motivo, que «um
sexto não entra por omissão nem por extensão». A decisão é a **resposta a uma pergunta**, e é identificada pelo
`pedido_id` dela — não pela porta dos verbos.

**Alternativas recusadas:** um sexto verbo `decidir` (reabre exactamente a porta que a mesa recusa e contradiz
a RN-V1); um campo `decisao` opcional dentro do `comando` (faria os cinco verbos comportarem-se de forma
diferente por causa de um campo, e o campo seria lido por ninguém em quatro deles — um botão falso).

## R6 — O registro do vigia vive em **ficheiro próprio** (`.vigia.json`), nunca no ledger

**Decisão:** as transições do vigia (instante, verbo, autor, `pedido_id`, estado anterior, estado posterior,
motivo) vão para um ficheiro do runtime, com escrita **atómica** (tmp + rename), como as marcas.

**Razão:** o ledger é da **mesa**, tem **um só escritor** (RN-E7) e tipos de linha **declarados** (RN-L2:
snapshot, proposta, boleta, desfecho). Operações não são linhas de mercado. E a retenção do registro do vigia
pode ser diferente da do ledger (RN-L6 fala do ledger) — o que passa a ser **decisão escrita**, não acidente.

**Alternativas recusadas:** escrever no ledger (misturar operação com mercado, e dar um segundo escritor ao
ficheiro da mesa); não registar nada (perder a auditabilidade da RN-V4, que é o que permite ler o que o dono
mandou e quando).

## R7 — Cruzam a fronteira **20 dos 42** motivos da mesa — e o critério é declarado

**Decisão:** o vocabulário do contrato ganha a família `motivos_de_comando`, com os motivos **produzidos pelo
interpretador de comando e pelo encerramento**: os **15 de recusa** (`mesa_ja_em_operacao`,
`mesa_parada_nada_a_pausar`, `mesa_ja_pausada`, `mesa_ja_parada`, `mesa_em_encerramento`, `pedido_repetido`,
`sessao_inibida`, `porta_do_arranque_falhou`, `liquidacao_em_curso`, `sessao_nova_com_posicao_viva`,
`mesa_precisa_parar_para_sessao_nova`, `verbo_desconhecido`, `comando_com_campo_a_mais`, `comando_incompleto`,
`comando_com_tipo_invalido`) e os **5 de efeito** (`sessao_nova_gravada`, `reset_nao_toca_em_nada`,
`resumo_do_encerramento_apresentado`, `stop_pendente_por_prazo`, `parada_com_posicao_viva`).

**Razão:** os outros **22** são motivos de **ciclo, posição e reconciliação** — nascem dentro de um ciclo e
ficam registrados no ledger; não são resposta a comando nenhum e não têm por onde atravessar esta fronteira.
Levar os 42 seria levar os que ninguém produz deste lado — o defeito espelhado dos falsos botões.

**O critério é declarado, porque a lista pode ter um caso de fronteira:** os três `troca_*` são produzidos no
caminho da troca de configuração (que é o caminho do `nova_sessao`); se a implementação os produzir **em
resposta a um comando**, entram — e a conferência nas **duas direcções** (motivo produzido e ausente do
vocabulário; motivo do vocabulário sem quem o produza) é que fecha o número. Lição da `fail-closed-validation`:
uma tabela indexada por nomes tem de declarar **de que conjunto fechado** cada nome vem.

**Alternativas recusadas:** levar os 42 (arrastaria motivos de ciclo para o contrato, e o contrato passaria a
dizer que o vigia pode recebê-los); levar só as recusas e deixar os efeitos fora (o vigia não saberia o que
aconteceu quando o comando **foi** aceito).

## R8 — O dublê de mesa é **Python**, escrito **do contrato**, e **adversário**

**Decisão:** `contracts/mocks/mesa/` em Python + `jsonschema`, a ler os **esquemas**, com casos em dado
(`*.casos.json`); entrega `mercado` e confere `proposta`; entrega `boleta` e confere `desfecho`; e sabe ser
adversário — recusa, atrasa, cala-se e devolve números fora da banda.

**Razão:** provar a fronteira **fora** da nossa linguagem (RN-E17) e **do contrato**, nunca importando `core/`
(RN-E24): um dublê copiado do core prova compatibilidade com a nossa implementação e esconde o defeito dos
dois lados. O precedente medido é o dublê de conector que já existe, com `--silencioso`, `--desfecho
recusado`, `--desfecho parcial` e `--preco` — ou seja, o padrão adversarial já está provado neste repositório.

**Alternativas recusadas:** dublê em TypeScript a importar os esquemas (mesma linguagem do core: prova a
lógica, não a fronteira); dublê a importar `core/mesa.ts` (provaria a nossa implementação, e o defeito do core
passaria a ser invisível para quem constrói o plugin).

## R9 — O que este recorte **deixa declarado** (e não resolve)

- **A conformidade por venue** (RN-C6): continua pendência de cada conector real. Os dublês não a substituem.
- **O campo da conta** na mensagem do comando (FR-020): entra no dia em que a mesa servir mais de uma conta.
  Hoje seria um campo sem leitor.
- **A hospedagem do setup** (biblioteca no processo da mesa ou processo próprio): decisão da spec do setup.
- **A chave do prazo de resposta do encerramento**: a §7 do inventário declara-a em falta, e este recorte
  **precisa dela**. Aplica-se a RN-A3: a spec **inventa a chave primeiro** (nome, tipo, unidade, valor por
  omissão e significado), com valor por omissão declarado — e o valor do dono entra quando ele o disser. O
  número continua a não ser nosso; a chave passa a existir.
