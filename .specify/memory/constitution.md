# MesaCore Constitution

## Core Principles

### I. A inteligência é humana; o código é burro

O terminal **executa**; quem decide é uma pessoa, e ela fala em arquivos de configuração. Disto:

- **Nenhum número ajustável vive no código.** Todo valor que se ajusta tem chave declarada no arquivo
  certo — nome, tipo, unidade, valor por omissão, significado e **quem a lê** (RN-A1).
- O inventário de chaves é **validado no arranque**: chave fora dele recusa o arranque; valor lido sem
  chave é defeito (RN-A2).
- Especificação que precise de um número **inventa a chave primeiro**, nunca o valor (RN-A3).
- O core **não conhece nenhum parâmetro de estratégia por nome**: o que ele lê é o *template* que o
  plugin publica (RN-S10, RN-S11, RN-S12).

**Teste que recusa:** dois mandatos — um com 2% de risco, outro com 0,5% — correm o **mesmo binário**,
sem recompilar e sem ramo no código; um número literal ajustável no código reprova a revisão.

### II. Recusar, nunca degradar em silêncio (NÃO NEGOCIÁVEL)

Validação é alarme que **recusa**; nunca autocorreção. Nada se arredonda, nada se completa, nada se
presume em nome de continuar a operar.

- Sem arredondamento silencioso, em nenhuma fronteira (RN-B, RN-M4.2).
- A resolução fora do autorizado **não vira ordem**: é inconformidade registrada (RN-M4.5).
- Recusa ao **fechar** é alarme grave, com nova tentativa declarada (RN-T7.3).
- Um desfecho desconhecido nunca é reportado como sucesso nem como falha (RN-T7.1).
- O terminal pode sempre dizer não ao setup, mesmo que a ficha permita (RN-M4.12).

**Teste que recusa:** todo caminho de erro termina numa **recusa registrada**; nenhum caminho termina
num valor inventado, arredondado ou presumido.

### III. A fronteira fala uma língua neutra, e dinheiro não é float

- A boleta viaja em **unidades neutras** (percentagem do saldo, alavancagem, percentagem de movimento);
  quantidade, lote e preço absoluto são do conector (RN-B0, RN-B7).
- O contrato é **schema-first e neutro de linguagem**: a fonte é `/contracts`, cada linguagem gera dele
  (RN-E16). Nenhum par de tipos partilhados entre linguagens diferentes.
- Há **mocks dos dois lados**, e pelo menos um escrito **noutra linguagem** que não a do core (RN-E17).
- A versão do contrato é declarada e conferida em cada execução (RN-E18).
- Dinheiro e percentagens viajam como **decimal textual**, nunca como número de vírgula flutuante
  (RN-E19).

**Teste que recusa:** uma boleta que carregue quantidade, lote ou preço absoluto é inválida; uma soma
de dinheiro feita em float reprova a revisão.

### IV. O conector traduz, declara antes de executar, e prova

- O conector devolve a **resolução antes de executar**: o que ele vai enviar, em que unidade, a que
  preço (RN-C9, RN-C10).
- Ele **não adapta nem arredonda em silêncio**; se não consegue cumprir a boleta, recusa.
- O manifesto é **sondado**, nunca uma constante escrita à mão, e declara a forma da marca de posse
  (RN-C1).
- Cada versão do conector traz a sua **bateria de conformidade** — oito provas, incluindo *marcar,
  reiniciar, reencontrar* (RN-C6).
- O conector não participa da decisão: **I/O na ponta, interpretação no core**.

**Teste que recusa:** um manifesto divergente do venue recusa a operação; um conector sem as oito
provas não entra em operação.

### V. Incerteza é estado de primeira classe

Não saber é uma condição **declarada e tratada**, não um palpite.

- `desconhecido`, `sem_leitura`, `divergente`, `congelada` e `mercado_fechado` são estados com **saída
  declarada**.
- Leitura falhada ≠ dado velho (RN-D7); mercado fechado é estado, não erro (RN-D8); divergência é
  estado, não incidente de log (RN-T13).
- Dado velho invalida o ciclo: pode **fechar e reduzir, nunca abrir** (RN-D3).
- **Sem leitura não se abre nem se fecha às cegas** — fechar sem saber o que existe é adivinhar.
- Todo estado tem saída declarada; todo evento tem um estado onde caiba.

**Teste que recusa:** nenhum estado do desenho fica sem saída; nenhum evento fica sem estado; um
caminho que trate "não sei" como "sei" reprova a revisão.

### VI. O dinheiro e a posse são da corretora

- **Dois trilhos, dois donos:** as **decisões** no nosso ledger; o **dinheiro** (execuções, taxas,
  funding, resultado realizado) no da corretora (RN-D6). A mesa lê e mostra — **nunca reconstrói
  resultado**.
- A **posse** de uma posição lê-se do venue, pela marca de posse que a ordem leva (RN-B10, RN-T16.1).
  Posição que a mesa não abriu é **vista, não gerida** (RN-T16).
- Não há base de dados própria de posição (RN-T16.1).
- O ledger é **append-only**: nunca se reescreve; a retenção é declarada (RN-L6).
- Histórico, taxas e funding vêm da corretora, expostos de forma normalizada (RN-C11).

**Teste que recusa:** um resultado reconstruído a partir de execuções reprova a revisão; uma posição
que a mesa não reconheça pela marca de posse é vista como alheia, nunca gerida.

### VII. A dependência aponta para o contrato, nunca para o core

- setups e brokers importam `/contracts`; o core importa `/contracts`; **ninguém importa o core** —
  verificado por teste.
- O core é **indiferente à topologia**: a web fala com um **registo de mesas**, nunca com um endereço
  único.
- **Uma ligação e uma chave por processo**; credenciais nunca em `/config`, no ledger ou no log
  (RN-E14).
- As duas pontas **não participam da operação**: interpretar é do core, transportar é do conector,
  propor é do setup.

**Teste que recusa:** um import de `core` a partir de um plugin reprova a revisão; credencial em
qualquer ficheiro versionado reprova o commit.

### VIII. Sem prova, não está feito

- O motor que opera hoje (`~/Projects/jev-trade-fusao`) é o **oráculo de aceite**: vale o comportamento
  **medido**, não a opinião.
- Todo número relatado é **medido** do arquivo ou do comando que o produziu — nunca digitado.
- Toda regra é **verificável**: existe um teste que a recusa.
- **O que a regra não nomeia não entra no desenho.** Complexidade sem regra que a exija é removida.

**Teste que recusa:** uma afirmação sem comando e sem saída não fecha um item; uma peça do desenho que
não consiga citar a regra que a exige é removida.

## Restrições adicionais

Estas restrições vêm do ambiente medido e das decisões do dono; nenhuma spec pode contrariá-las.

- **Stack:** core e web em TypeScript (Bun); `/tools` em Python (é onde vivem os estudos do dono). A
  linguagem de cada **plugin** decide-se na spec desse plugin (RN-E16).
- **Nada de runtime de container:** o host não tem docker, podman nem nerdctl (medido). Nenhuma parte
  do desenho pode exigir container para correr, testar ou publicar.
- **O core não depende de SDK de venue.** Os três venues de referência e o que eles impõem: MT5 tem
  biblioteca Python **só em Windows**; cTrader Open API é agnóstica mas os SDKs oficiais são C# e
  Python; Hyperliquid tem caminho provado em JS/TS. Quem conhece a linguagem da corretora é o conector.
- **Sem credenciais no repositório.** As pontas recebem a sua ligação por configuração externa.
- **O repositório do motor antigo é congelado:** leitura apenas, e nada dele é copiado para aqui. O que
  se aproveita dele são os casos e as rotinas, citados por `arquivo:linha` como fonte.

## Fluxo de trabalho e portões de qualidade

**A ordem não se inverte:** regra de negócio → constituição → spec por recorte → plano → tarefas →
implementação.

- **Nenhuma spec nasce sem recorte.** Cada especificação declara qual parte da regra implementa e cita
  as regras `RN-*` que a obrigam.
- **O contrato vem antes dos plugins.** Nada de plugin é escrito antes do schema neutro, dos mocks e
  das provas de fronteira.
- **Cada spec declara como se sabe que está cumprida** — critério verificável, não intenção. O critério
  que não recusa nada não é critério.
- **Test-first:** o teste que recusa a regra existe antes do código que a cumpre.
- **Portão de dependência:** o teste que prova que ninguém importa o core corre sempre.
- **Comparação com o oráculo:** os vectores de aceite vêm do comportamento medido do motor antigo, e
  são eles que dizem se o terminal pode substituí-lo.
- **Quatro vistas antes de fechar um recorte:** a regra, o inventário de chaves, a máquina de estados e
  o diagrama com as arestas de falha. Nenhuma vista única prova ausência de lacuna.
- **Validação é alarme que recusa** — também no processo: um portão que avisa mas deixa passar não é
  portão.

## Governance

- **Precedência:** esta constituição governa o **como**; `docs/regra-de-negocio.md` é a fonte do **o
  quê**. Quando as duas divergirem, a divergência é defeito e uma das duas se corrige — nunca se
  escolhe a mais conveniente.
- **Emenda:** exige proposta escrita com a regra que a motiva, aprovação do dono, e actualização da
  linha de versão. A emenda que contradiz uma regra em vigor começa por corrigir a regra.
- **Versionamento (semver):** MAJOR = remoção ou redefinição incompatível de princípio; MINOR =
  princípio novo ou ampliação material de orientação; PATCH = clarificação, redacção, sem mudança de
  sentido.
- **Conformidade:** toda spec, plano e revisão verifica estes princípios. Violação **bloqueia**. Um
  desvio deliberado exige justificativa escrita no próprio documento, e a justificativa é revogável.
- **Medição derruba texto:** quando um número medido contradiz o que está escrito aqui, o texto muda —
  inclusive contra decisões anteriores do próprio autor.
- **Guia de execução:** `README.md` para a descrição geral, `docs/regra-de-negocio.md` para as regras,
  `docs/maquina-de-estados.md` e `docs/inventario-de-chaves.md` para as vistas, `.specify/` para o
  fluxo de especificação.

**Version**: 1.0.0 | **Ratified**: 2026-09-27 | **Last Amended**: 2026-09-27
