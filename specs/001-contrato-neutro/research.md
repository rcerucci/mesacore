# Phase 0 — Research: as decisões do contrato neutro

Cada decisão traz **o que se escolheu**, **porquê** e **o que foi rejeitado**. Onde há número, ele foi
medido no host; onde há dependência, ela foi verificada no registo antes de ser escolhida.

---

## D1 — Notação: JSON Schema 2020-12 como fonte normativa

**Decisão**: os ficheiros `/contracts/*.schema.json` são a **fonte**. Cada linguagem gera deles os seus
tipos; nenhum par de tipos é escrito à mão em duas linguagens.

**Racional**: é a única notação candidata que satisfaz os quatro requisitos duros do recorte ao mesmo
tempo: **neutra de linguagem** (nenhum runtime para a ler), **contrato fechado**
(`additionalProperties: false`), **união com discriminante** (os quatro valores da proposta, os quatro
desfechos) e **decimal textual** (`type: string` com padrão declarado). Tem validadores maduros nas
duas linguagens medidas: `ajv 8.20.0` (npm) e `jsonschema 4.26.0` (PyPI, `requires_python >=3.10` — o
host tem 3.14.7).

**Alternativas rejeitadas**:

- **Protobuf** — geração excelente para qualquer linguagem, mas **tolera campos desconhecidos**: um
  contrato que aceita o que não conhece contradiz "recusa, nunca degrada" (Princípio II). Além disso
  exige um compilador e um plugin por linguagem, e não tem decimal.
- **TypeSpec** — bonito e expressivo, mas obriga a uma toolchain Node para *compilar* o contrato, o que
  faz do Python uma cidadão de segunda no próprio contrato; os emissores Python são fracos.
- **Avro** — pensado para evolução de schema em registo central; traz um registo que o projeto não tem
  e uma história de validação mais fraca.
- **Tipos escritos em TypeScript** — o caminho mais curto, e o mais errado: seria o core a definir a
  forma do mundo, e o contrato deixaria de ser neutro (RN-E16). É precisamente o que este recorte
  existe para impedir.

---

## D2 — O seam: um processo, JSON em texto, uma mensagem por linha (stdio)

**Decisão**: cada plugin é um **processo** que a mesa levanta; a conversa é **texto JSON, uma mensagem
por linha** nos dois sentidos, pedido e resposta, com **prazo declarado** por troca.

**Racional**: uma ponta noutra linguagem não pode estar *dentro* do processo do core. Medido no host:
não há `go` nem `rustc`, e o contrato não pode exigir uma linguagem específica. O stdio é o seam mais
pobre que ainda funciona: **sem porta, sem socket, sem daemon, sem TLS, sem credencial no contrato** — o
que também respeita a constituição ("pedido ao sysadmin, nunca execução": abrir uma porta é mexer no
host). E é o único seam que o dono pode testar à mão, com um `echo` — e ele testa as coisas ele mesmo.

**Alternativas rejeitadas**:

- **HTTP em localhost** — obriga a um servidor por plugin e a gerir portas e ciclos de vida; mais peças,
  e uma porta é estado do host.
- **Socket Unix** — melhor para vida longa, mas exige caminho, permissões e limpeza; e o host **já** usa
  um socket para o proxy de egresso, o que tornaria dois conceitos differentes indistinguíveis na
  cabeça de quem lê.
- **Carregar o plugin em processo (FFI/dlopen)** — exclui outras linguagens, ou obriga a uma ponte.

**Consequência que o contrato tem de carregar**: a troca é **uma mensagem por vez** e tem prazo. Um
plugin que não responde no prazo é "silencioso" — congelamento (RN-S8) para o setup, `desconhecido`
(RN-T7.1) para o conector. O contrato não tem campo para espera infinita.

---

## D3 — O envelope: versão, tipo, correlação e carga

**Decisão**: toda mensagem é um objecto com `contrato` (versão), `tipo` (nome da mensagem), `id`
(correlação do ciclo) e `carga` (o corpo). O corpo nunca repete a versão.

**Racional**: a versão confere-se **num só sítio**, e não em vinte mensagens onde alguém a esquece. A
correlação (`id`) permite ligar pedido e resposta — e reaparece no registo, sem que a mesa tenha de ler
o corpo para saber a que ciclo pertence a resposta. O fecho (`additionalProperties: false`) aplica-se
ao envelope **e** ao corpo.

**Alternativas rejeitadas**: versão dentro do corpo (repetição e esquecimento); uma linha de cabeçalho
antes do JSON (dois parsers em vez de um); versão passada nos argumentos do processo (não cobre
reconexão nem a segunda troca).

---

## D4 — Dinheiro e percentagens: decimal textual, `null` proibido, ausência é chave ausente

**Decisão**: todo valor de dinheiro ou percentagem viaja como **texto decimal** com escala declarada
(padrão sem expoente: `-?(0|[1-9][0-9]*)(\.[0-9]+)?`). **`null` não existe no contrato.** Um facto que
não existe é uma **chave ausente**, e o objecto declara **quais** podem faltar.

**Racional**: RN-E19 é literal — duas linguagens têm de chegar ao mesmo número. `null` é ambíguo (é o
mesmo que zero? é "não sei"? é "não se aplica"?) e a ambiguidade é o defeito que o projeto persegue.
"Ausente é ausente" (RN-D4) resolve-se com a chave que não está lá — e é o que permite ao receptor
**distinguir ausência de zero**, que é a diferença entre não abrir e abrir com um valor inventado.

**Detalhe que evita a próxima discussão**: valores equivalentes com escalas diferentes (`1.50` e `1.5`)
comparam-se **por valor** e registam-se **tal como chegaram** — o contrato nunca reescreve o que recebeu.

**Alternativas rejeitadas**: inteiro em unidade mínima (funciona para dinheiro, não para percentagens, e
obriga a uma escala por campo); vírgula flutuante (proibida pela constituição); par `{valor, escala}`
(mais campos, mais formas de discordar); `null` com significado (ambíguo por construção).

---

## D5 — Contrato fechado

**Decisão**: `additionalProperties: false` em **todo** objecto, com `required` explícito; campo que o
contrato não declara é **motivo de recusa**, com motivo normalizado.

**Racional**: é o FR-005 e é o Princípio II. Um contrato aberto aceita em silêncio o que não entende —
inclusive um campo novo que alguém acrescentou à pressa numa das pontas, com o sentido que só ele
conhece. Fechado, o desvio aparece **no primeiro caso**, não na contabilidade do mês.

**Alternativas rejeitadas**: tolerar desconhecidos (é o comportamento por omissão de várias
tecnologias, e é o defeito); versionar por campo (complexidade sem regra que a peça).

---

## D6 — Marca de posse: inteiro determinístico, com o mapa no registo

**Decisão**: a marca é um **inteiro sem sinal de 31 bits**, gerado pela mesa, **determinístico**, com
duas partes: identificador curto da ficha e contador de ciclo. O ledger guarda o mapa
**marca → ciclo/ficha**; a **posse** lê-se sempre do venue (RN-T16.1).

**Racional**: RN-B10 exige que caiba na **forma mais restrita** dos venues que a transportam. Verificado
no desenho dos três: MT5 tem `POSITION_MAGIC` (inteiro) e `POSITION_COMMENT`; cTrader tem
`clientOrderId` (texto até 50); Hyperliquid tem `cloid` (hexadecimal de 128 bits). O mais restrito é o
**inteiro** — um inteiro cabe em todos os outros, o contrário não é verdade. "Determinístico" e não
aleatório porque a marca tem de **poder ser recalculada** — é isso que permite dizer "esta marca é
minha" lendo só a corretora e o config em vigor.

**Alternativas rejeitadas**: identificador aleatório por ordem (funciona com o mapa, mas perde o
determinismo que a regra exige); derivação por hash do instrumento e ciclo (determinístico, mas com
colisões que não se conseguem medir nem declarar); marca por instante (não cabe em 31 bits com a
frequência de ciclos).

**O que fica declarado como consequência**: se o manifesto do venue disser **`nenhuma`**, a mesa **diz
que cai para o registo** em vez de fingir que a marca existe (FR-025, cenário 3 da US5).

---

## D7 — Versão: igualdade exacta, conferida em cada troca

**Decisão**: a versão é um texto, e as pontas conferem **igualdade exacta**. Diferente é recusa, antes
de qualquer envio.

**Racional**: a spec diz "versões diferentes recusam" (FR-002), e as *Assumptions* registam que o
contrato v1 **não tem compatibilidade a preservar**: nenhum dos dois plugins existe, e as três pontas
vivem no mesmo repositório e sobem juntas. Uma política de compatibilidade (comparar só a parte maior,
tolerar acrescentos) é precisamente a maquinaria que permite a divergência silenciosa que o Princípio II
proíbe — e, sem plugins publicados, não compra nada.

**Alternativas rejeitadas**: comparar só o maior (tolera deriva silenciosa hoje, para poupar dor que não
existe); negociação de versões (um protocolo dentro do protocolo, sem necessidade em v1).

**Quando isto muda**: quando existir um plugin fora do repositório. Aí a emenda é da constituição e da
regra, com a política escrita — não uma decisão tomada a esconder num ficheiro.

---

## D8 — Código gerado: versionado, com teste de frescura

**Decisão**: o código gerado (`/contracts/gerado/ts`, `/contracts/gerado/py`) é **versionado**, e existe
um teste que **regenera e falha se houver diff**.

**Racional**: o risco real não é "não gerar" — é alguém editar o gerado à mão para fazer um caso passar.
Com o ficheiro versionado e o teste de frescura, essa edição aparece como **diff inesperado** em vez de
passar despercebida. E ninguém precisa da toolchain de geração para *usar* o contrato.

**Geradores escolhidos** (existência verificada no registo): `json-schema-to-typescript 16.0.0` (npm)
para TS e `datamodel-code-generator 0.83.0` (PyPI, `requires_python >=3.10`) para Python. Se algum
deles se revelar insuficiente para uma construção do contrato, a alternativa é **gerar menos** (só os
tipos simples) e validar sempre com o schema — nunca escrever os tipos à mão nas duas linguagens.

**Alternativas rejeitadas**: gerar em tempo de build sem versionar (obriga toda a gente — incluindo o
`/tools` em Python — a ter a toolchain); tipos escritos à mão por linguagem (é a duplicação que RN-E16
proíbe).

---

## D9 — A bateria é dado, com dois runners e um relatório comum

**Decisão**: os casos vivem em `/contracts/casos/*.casos.json` no formato
`{ nome, entrada, veredicto_esperado, motivo_esperado }`. Há **dois runners** — um em TypeScript, um em
Python — que emitem o **mesmo formato de relatório**; um terceiro comandos compara os dois relatórios e
falha se divergirem.

**Racional**: é o que torna SC-002 **medível**: se cada linguagem tivesse os seus próprios testes, as
duas suítes podiam divergir e cada uma passaria — provando nada. Com casos como dado, um caso escrito
uma vez corre nos dois lados, e a comparação é máquina a máquina. É também o que permite ao **mock saber
ser inválido de propósito** sem escrever dois conjuntos de inválidos.

**Alternativas rejeitadas**: testes escritos por linguagem (deriva e falsa confiança); um runner num
terceiro runtime (mais uma linguagem para manter).

---

## D10 — Onde vive a verdade

**Decisão**: `/contracts/*.schema.json` é **normativo**. `specs/001-contrato-neutro/data-model.md` é
**desenho** (o que as mensagens têm de conter, com as regras que o obrigam). `docs/inventario-de-chaves.md`
é a **conferência**: as chaves que o schema declara têm de bater com as grandezas que a regra nomeia.

**Racional**: o `contracts/README.md` já declara que o schema é a fonte, e o inventário já se declara
"gerado dos schemas, com este ficheiro como conferência". Três documentos com três papéis distintos não
são três versões da mesma coisa: são um fonte, um desenho e um teste de concordância. Duas fontes seria
o defeito.

**Alternativas rejeitadas**: pôr o schema dentro de `specs/001-…/contracts/` (o Spec Kit sugere, mas
aqui o contrato **sobrevive à spec**: os recortes seguintes — mandato, boleta, mesa — herdam-no, e um
schema no diretório de uma feature antiga é uma armadilha de arqueologia).

---

## D11 — Credenciais: por referência, nunca por valor

**Decisão**: o contrato transporta **nomes de referência** de credencial; o valor vive no ambiente do
processo da ponta (RN-E14). Nem nos casos, nem nos mocks, nem nas fixtures.

**Racional**: é a regra literal, e é a única forma de o contrato poder ser versionado em claro — como
está aqui, num repositório — sem se tornar um cofre mal guardado.

**Alternativas rejeitadas**: credencial em ficheiro de config do projeto (proibido por RN-E14);
credencial por argumento de linha de comando (aparece na lista de processos).

---

## D12 — Prazo: toda troca tem prazo, e o silêncio é um estado

**Decisão**: cada troca tem prazo **declarado em chave** (`setup.prazo_de_resposta_ms` para o setup; o
prazo de confirmação do venue para o conector). Estourar o prazo **não** é excepção: é o estado
`congelada` (setup) ou o desfecho `desconhecido` (conector), ambos com saída declarada.

**Racional**: é a diferença entre um sistema que espera para sempre e um que sabe não saber. A máquina
de estados já declara os dois caminhos; o contrato tem de os tornar **representáveis** — e é por isso
que `desconhecido` é um valor do enum do desfecho, e não um erro de rede.

**Alternativas rejeitadas**: prazo por omissão dentro do código (número ajustável no código — RN-A1);
sem prazo, à espera do sistema operativo (transforma um travamento numa paralisia silenciosa).

---

## Verificações feitas antes de decidir

| O que | Comando | Resultado |
|---|---|---|
| Runtime do core | `bun --version` | `1.4.2` |
| Node disponível | `node --version` | `v26.8.1` |
| Python | `python3 --version` | `3.14.7` (sem `pip`; instalador é `uv 0.12.13`) |
| Linguagens ausentes | `go version`, `rustc --version` | **não existem** — a ponta noutra linguagem é Python |
| Registo npm | `registry.npmjs.org/ajv/latest` · `/json-schema-to-typescript/latest` | `8.20.0` · `16.0.0` |
| Registo PyPI | `pypi.org/pypi/jsonschema/json` · `/datamodel-code-generator/json` | `4.26.0` · `0.83.0` (ambos `>=3.10`) |
| Rede para instalar | `curl -sI registry.npmjs.org` · `pypi.org` | `HTTP/2 200` nos dois |
