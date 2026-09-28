# A constituição aplicada a este recorte

Os oito princípios do projeto, um a um, contra o que **este recorte** fez — e o que o teria recusado.
Um princípio que não se consegue ligar a um artefacto medido não está aplicado: está escrito.

## I. A inteligência é humana; o código é burro

A mesa recebe o lado e a **estratégia pelo template do setup**, e não decide nada por si: as condições, os
impedimentos e as transições são **dado** (`core/ciclo/condicoes.json`, `core/estados/transicoes.json`).
Nenhum número ajustável ficou no código (`chaves.ts`: 7 chaves lidas, 0 ausentes).

**Teria recusado:** um `if` com um limiar dentro do ciclo. Não há nenhum — os limiares entram por
`config` e são conferidos contra o inventário.

## II. Recusar, nunca degradar em silêncio (NÃO NEGOCIÁVEL)

Ao todo, as baterias contam **16 recusas** na máquina de estados + 11 portas do arranque + 2 recusas do
CB/`start`/troca de configuração: **todas com motivo do livro**, e o livro é conferido por conferência
cruzada contra os dois vocabulários. Os casos de **prova negativa** (um `nada` sem motivo, um motivo
inventado, uma transição que salta) são reprovados pelo próprio conferidor.

**Teria recusado:** arredondar a percentagem do CB para comparar com o limite. Não se arredonda: a
comparação é por multiplicação cruzada em `BigInt`, e 4,999% **não** dispara onde 5,00% dispara.

## III. A fronteira fala uma língua neutra, e dinheiro não é float

Este recorte **não mudou um único schema** (assunção da spec). A boleta continua em unidades neutras, o
dinheiro é decimal textual, e o `frescura.sh` confirma que o gerado corresponde aos schemas (**19
ficheiros, 0 divergências**).

**Teria recusado:** um campo novo na boleta para «o que a corretora precisa» — os valores em unidade de
corretora estão proibidos por vocabulário.

## IV. O conector traduz, declara antes de executar, e prova

A mesa **decide e não envia** ($R5$): o ciclo termina na boleta validada. O manifesto é uma das seis
portas do arranque, e a porta do inventário chama o conferidor que já existia no recorte 001 — sem segunda
implementação e sem o core chamar processos (RN-E2).

**Teria recusado:** o core a importar o conector para saber se o instrumento existe. Não importa.

## V. Incerteza é estado de primeira classe

O `desconhecido` é **dívida da mesa consigo própria** e não uma condição do mundo: bloqueia ordem nova
naquele instrumento, não se limpa com `reset`, e só uma reconciliação que **decida** a paga. Três
veredictos (`preenchida`/`inexistente`/`indecidivel`) e só os dois primeiros limpam a marca.

**Teria recusado:** tratar o silêncio do venue como `aceite` ou como `recusado`. Os dois casos que o
tentam estão na bateria — e são reprovados.

## VI. O dinheiro e a posse são da corretora

A marca de posse é um inteiro de 31 bits (`ficha << 19 | ciclo`), vive na **boleta** e é a corretora que a
devolve; a mesa **compara**, nunca inventa. O CB mede o equity **da corretora, com o não realizado dentro**
— uma posição aberta a caminhar para o limite dispara sem nada ter sido fechado.

**Teria recusado:** calcular o PnL por dentro para decidir o CB. Não se calcula: lê-se o equity.

## VII. A dependência aponta para o contrato, nunca para o core

O `core` não importa `contracts/` como código: lê os schemas como **dado** e valida por `framing.ts`.
Os tipos do core são dele; o que atravessa a fronteira é mensagem validada. O `porteiro-dependencias.sh`
do 001 continua verde.

**Teria recusado:** o core a gerar código a partir do esquema e a depender do gerado para compilar.

## VIII. Sem prova, não está feito

Este recorte produziu **um relatório por história**, com a corrida real colada (`.txt`) e o detalhe por
caso (`.jsonl`), mais o `RESULTADO.md` com os 12 SC e os comandos. O que não foi medido está lá declarado
como não medido.

**Teria recusado:** «as baterias passam» sem o comando e a saída. É por isso que existe
`tools/verificar-maquina/provar.sh`: uma porta, uma saída — passa ou não passa.

## O que este recorte não fez, e porquê

- Não criou `remote` no GitHub (não foi pedido).
- Não mexeu em `src/`, `test/` ou `archive/` do `jev-trade-fusao`: o motor antigo continua a operar a
  conta e serve de **oráculo de aceite**.
- Não reconciliou os dois vocabulários de tipos de linha (mesa vs contrato): está registado como questão
  aberta (R8) — quando o ledger tiver recorte, **uma das listas ganha**.
