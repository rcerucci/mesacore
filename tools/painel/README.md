# tools/painel

**O retrato** — o leitor que junta o que a corrida já escreveu e produz o fio que a tela consome
(`web/painel/painel.json`). **O servidor** (`servidor.ts`) — serve a tela, **gera o fio que serve** e aceita o
*pedido* de escrita de uma ficha; quem escreve é `tools/escrever-ficha`, não ele. O lançador `servir.sh` é só a
linha que a unit corre (descobre o endereço da LAN e entrega tudo ao servidor). O desenho da tela, a vista de
configuração e as decisões estão em `docs/INTERFACE-DE-CONTROLO.md`.

Regras que este directorio cumpre (as mesmas de `tools/`: é do dono e **não opera** — não decide nada da mesa, não
lança processos, não toca na operação):

- **o retrato não escreve nada**: nem na operação, nem em ficha nenhuma. Se estiver parado, a mesa opera igual;
- **o servidor também não escreve fichas**: aceita um pedido e entrega-o à porta única (`tools/escrever-ficha`),
  que valida antes de aplicar e regista. As três guardas do endpoint (origem + cabeçalho próprio, impressão do
  ficheiro visto, validação antes de escrever) estão ditas no cabeçalho do `servidor.ts`;
- **não recalcula o que a mesa sabe** (RN-E9): preço, posição, decisão e ordens vivas são **os ficheiros do
  sistema**, copiados com o nome do campo que lá está; e o veredicto sobre uma ficha é do conferidor do portão;
- **não conhece o nome de setup nenhum**: a série do indicador sai do **comando que o próprio setup declara**
  (`setup.json` → `sobreposicao`), corrido com o instrumento, o relógio e as constantes **da ficha**;
- **não esconde o que falta**: o que não se conseguiu ler sai como **falta nomeada**, com o porquê — nunca como
  zero nem como vazio silencioso.

## Uso

```bash
# O SERVIDOR (o que a unit corre, pela boca do `servir.sh`): serve a tela E gera o fio que serve.
bun run tools/painel/servidor.ts --porta 8788 --endereco 192.168.15.24 --intervalo 60 --intervalo-vivo 2
bash tools/painel/servir.sh --porta 8788 --intervalo 60        # a linha da unit: descobre a LAN e arranca o servidor

# O RETRATO À MÃO (o mesmo leitor, quando se quer um fio pontual):
bun run tools/painel/retrato.ts                                  # DESCOBRE as corridas vivas (operacao.json fresca)
bun run tools/painel/retrato.ts --corrida <dir> --corrida <dir2> # N instalacoes explicitas
bun run tools/painel/retrato.ts --raiz-das-corridas <dir>        # onde a descoberta procura (por omissao: o scratch)
bun run tools/painel/retrato.ts --para /caminho/painel.json      # outro destino
bun run tools/painel/retrato.ts --sem-serie                      # o modo leve (o «agora»)
```

**A FONTE ÚNICA (medido a 04/10/2026).** O servidor é o **gerador**: o `--para` do retrato é sempre dentro da
`--pasta` que ele serve, logo o fio que a tela mostra é o que ele escreveu ali. Antes disso o `servir.sh` corria
dois laços `while` a regenerar o fio e o servidor era a outra metade — a tela dependia de os dois coexistirem, e um
`servidor.ts` sozinho servia uma pasta sem a renovar. A prova é `prova-da-fonte.ts` (o que a tela serve é byte a
byte o do repositório, e há uma só pasta servida).

A saída na consola é o resumo que se cola num relatório: as instalações (com a idade da operação), os
instrumentos com a ficha, o agregado (posições/ordens/parados), as contagens e as faltas.

### N instalações (e a corrida certa)

O painel deixou de ser «o painel do sigma» e é o do SISTEMA: uma **instalação** é uma corrida (uma conta, um
setup, os seus pares), e o fio traz **N**. Duas maneiras de as escolher:

- **explícita** (`--corrida <dir>`, repetível) — quando se sabe o que se olhar;
- **descoberta** (por omissão) — as corridas com a `operacao.json` reescrita há menos de `--idade-viva-ms`
  (300 s); sem nenhuma viva, cai na mais recente, e o fio **diz** qual foi o critério (`retrato.descoberta`).

É esta descoberta que corrige o defeito medido de a unit servir a corrida de ontem: a omissão fixa apontava para
uma pasta e a tela mostrava-a como se fosse a de agora. A fita mostra a **instalação, a corrida e as duas idades**
(o retrato e a operação), para nunca haver dúvida sobre o que se está a ver.

## A tela (web/painel/) — um módulo por responsabilidade

`index.html` é só HTML+CSS e carrega `js/arranque.js` como módulo. Cada módulo tem uma responsabilidade e
nenhum importa outro que não seja o `nucleo` (o ponto de encontro é o `redesenho`, preenchido no arranque):

| módulo | o que faz |
|---|---|
| `nucleo.js` | a cor (do tema), os formatos, o ESTADO, o que recolhe, os motivos ditos em português |
| `fita.js` | a fita: instalação · corrida · idades · seletor |
| `posicoes.js` | **o que está vivo**: posições, ordens em aberto, o que trava, e a vista geral |
| `pares.js` | a lista de pares (principal sempre, detalhe a pedido) |
| `grafico.js` | as velas × a série, as marcas, a leitura do setup |
| `dentro.js` | posição/mercado, risco em vigor, decisões do par |
| `registo.js` | o ledger: ciclos, mandato, carteiro, o que saiu, as faltas |
| `configuracao.js` | a vista da ficha e o caminho de escrita (compor→validar→escrever) |
| `telefone.js` | a barra fixa do telefone |
| `arranque.js` | os dois relógios, as vistas, o layout |


## As provas (a tela não se mede com um `grep`)

As bancadas abrem o painel num **Chrome headless** (o mesmo motor do dono) e medem o DOM. Três delas falam com o
`servidor.ts` **a sério**, pela porta que o gesto do dono usa. `tools/painel/bancada-cdp.ts` é a bancada comum (o
Chrome e o cliente do protocolo, num só sítio — duas cópias seriam duas contas da mesma coisa).

| prova | o que mede |
|---|---|
| `prova-do-recolhido.ts` | percorre TODOS os `[data-recolhivel]`, recolhe cada um, e exige que **recolheu E que o botão que o abre continua visível**; injecta uma secção mal formada (cabeça sem `.cabeca`, botão fora dela) e exige que o critério a **reprove** — e mostra que recolher à força escondia mesmo o botão |
| `prova-do-vivo.ts` | sobre um fio de bancada, mede que o painel diz o que **está vivo** (posições, ordens, a decisão) e o que **está parado e porquê** (a matriz: `trava` + `há X`), que a **última barra** e o **ciclo mais recente** trazem a hora, e que as três secções do «lado de dentro» dizem a fonte+idade e **sobrevivem ao recolhido** |
| `prova-da-fonte.ts` | o invariante da **fonte única**: arranca o servidor com os argumentos da unit e compara o `sha256` de CADA ficheiro servido com o do repositório (16 de 16), confirma que o fio servido é o que o servidor gera na sua pasta, que a unit e o `servir.sh` não apontam a outra pasta — e **provoca** (serve uma cópia divergente e exige que o critério a reprove) |
| `prova-do-log.ts` | o `operador.log` é um log **misto**: a **prosa** do conector (e o marcador `[<data>] fim`) NÃO é falta, uma linha com cara de JSON partido É — com o par de controlo (o mesmo log sem truncagem dá 0 faltas); e a **costura do buffer** (`vigia/linhas.ts`) não parte uma linha a meio (sem ela, a mesma linha viraria duas ilegíveis) |
| `prova-do-catalogo.ts` | o formulário de conta nasce do `questionario.json` do **conector** (medido contra o ficheiro), o obrigatório em falta recusa com nome, o segredo não é campo de digitação, e a conta é **criada pela tela**. Cria um conector de bancada e apaga-o, provando que «acrescentar um conector = acrescentar um ficheiro» |
| `prova-da-escrita.ts` | cria e escreve uma **ficha de bancada** pela tela (o `POST /api/ficha` a sério): valida ANTES de escrever, a banda da própria ficha morde, o relatório do conferidor sai tal e qual, e a impressão velha é recusada. Tem uma **trava**: não escreve numa ficha que não seja a que criou |

```bash
bun run tools/painel/prova-do-recolhido.ts
bun run tools/painel/prova-do-vivo.ts
bun run tools/painel/prova-da-fonte.ts
bun run tools/painel/prova-do-log.ts
bun run tools/painel/prova-do-catalogo.ts
bun run tools/painel/prova-da-escrita.ts
```

As provas entram na porta completa do `tools/verificar-maquina/provar.sh`. Não correm na `--rapido` (cada uma sobe um
Chrome, ~4 a 30 s).

## O catálogo dos conectores (o formulário sem formulário fixo)

Cada plugin publica os seus campos em **`brokers/<venue>/questionario.json`** (ou `setups/<nome>/questionario.json`)
— o MESMO ficheiro que a entrevista de linha de comando (`tools/preparar-contas`) segue. O retrato lê-os e publica-os
no fio, em `catalogo.conectores`; a vista de configuração **só o segue**: um conector novo entra com um ficheiro novo,
sem se tocar na tela. Um campo de tipo `segredo` é publicado como **declaração** (id, chave, se é obrigatório, a
pergunta e a explicação) e **nunca** com a omissão ou um exemplo: o valor de um segredo não existe em questionário
nenhum (o que lá está é *onde ele vive*), e o que viaja é o **nome** da credencial (RN-E14).

## A fonte e a idade de cada bloco

O fio traz `fontes` — caminho + `em_ms` — por mesa (`operacao.json`, `registo.jsonl`, `operador.log`) e por par
(`velas-<PAR>-<relogio>.jsonl`, a ficha). A tela mostra-as nas cabeças (`fonteEIdade`), com a idade calculada do
instante absoluto (para envelhecer com o ciclo de 2 s, e não com o fio). **Um número sem a fonte e sem a hora não
serve para decidir** — foi o defeito medido: a secção MERCADO dizia `lido: ha' 7,6 h` sem dizer de que corrida nem
de que ficheiro vinham os números.

## A correr com o sistema (a unit do host)

O painel **não vive na sessão de quem o abre**. Quem o mantém de pé é a unit de utilizador
`mesacore-painel.service` — do host, não desta sessão nem de outra —, que corre:

    /usr/bin/bash <repo>/tools/painel/servir.sh --porta 8788 --intervalo 60

com `Restart=on-failure` / `RestartSec=5`, `WantedBy=default.target` e `loginctl enable-linger cerucci`
(sem o linger, a unit morreria com a sessão gráfica — e é isso que ela existe para evitar). A cópia
versionada da unit está em `tools/painel/mesacore-painel.service`; a que corre vive em
`~/.config/systemd/user/`.

```bash
systemctl --user status mesacore-painel.service          # estado
systemctl --user restart mesacore-painel.service         # reiniciar
systemctl --user disable --now mesacore-painel.service   # parar E tirar do arranque automático
journalctl --user -u mesacore-painel.service -f          # o registo (o log em ficheiro já não existe)

# instalar/actualizar a partir da cópia do repositório
cp tools/painel/mesacore-painel.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now mesacore-painel.service
```

Enquanto a unit estiver ligada, **lançar `servir.sh` à mão falha com `EADDRINUSE`**: a porta 8788 tem dono.
Para voltar a correr à mão, desligue primeiro a unit (`disable --now`, acima).

**Medido** (2026-10-01, não é intenção): `is-enabled`=enabled · `is-active`=active · `Linger=yes` ·
amarra **só** `192.168.15.24:8788` (nunca `0.0.0.0`/`[::]`) · `GET /index.html` → **200** com sha256
`33e8e604…612a1` **igual** ao de `web/painel/index.html` em disco · travessia de directório `404` ·
`painel.json` reescrito pelo ciclo da própria unit a cada 60 s · corre sob
`user@1000.service/app.slice/mesacore-painel.service` (não sob a sessão de ninguém).

## O que ele lê

| fonte | o que tira |
|---|---|
| `<corrida>/operacao.json` | leitura do venue (bid/ask/último/equity/posição/ordens vivas), proposta, risco, parâmetros |
| `<corrida>/registo.jsonl` | estado da mesa, ciclos (`acao`/`motivo`), mandato |
| `<corrida>/operador.log` | o que o setup disse (`setup_falou`) e as passagens do carteiro |
| `<corrida>/mercado/velas-*.jsonl` | as velas (do venue) |
| `<corrida>/desfechos-*.jsonl`, `marcas-*.jsonl` | o que saiu para o venue e as marcas de posse |
| `fichas/<setup>/<PAR>-<CONTA>.json` | a ficha do dono: `run`, `enviar`, risco, constantes |
| `setups/<nome>/setup.json` | o template (descritor) e o comando da `sobreposicao` |
| `setups/<nome>/sobreposicao.ts` | **a série do indicador** — corre como processo, com o ambiente do plugin |

## O ambiente que ele passa à sobreposição

O mesmo que o plugin recebe em operação, para não haver duas maneiras de dizer a mesma coisa:

`INSTRUMENTO`, `RELOGIO`, `CONSTANTES` (JSON da ficha), `PASTA_DE_MERCADO`, `AGORA_MS` (o instante do venue,
para a barra "a que decidiu" ser a mesma que a mesa viu).

## Os dois relógios (e porque são dois)

O painel tem **dois** ciclos, e não é por gosto: são duas coisas com ritmos próprios. **Os dois correm dentro do
servidor** (`servidor.ts`), que é o gerador do fio — o `--para` de cada um é sempre dentro da pasta que ele serve.
`--intervalo 0` (ou `--intervalo-vivo 0`) desliga um deles; as provas usam-no para não pisar um fio de bancada.

| ciclo | ficheiro | por omissão | o que traz |
|---|---|---|---|
| **retrato** (completo) | `web/painel/painel.json` | 60 s (`--intervalo`) | tudo, **incluindo as velas e a série** do setup — é dele que sai o gráfico |
| **vivo** | `web/painel/vivo.json` | 2 s (`--intervalo-vivo`) | o «agora»: leitura (preço, idade do dado), posição, proposta, última decisão, risco, faltas |

**Medido** (02/10/2026, 3 voltas de cada): o retrato completo custa **0,43 s** e pesa **2,7 MB** (1,67 MB só de
séries, porque pergunta a cada setup a sua série — um processo por par). O modo leve (`--sem-serie`) custa
**0,11 s** e pesa **28 KB** (98× menos). A série muda **por barra**; a leitura e a decisão mudam **a cada
segundo** no motor (o operador escreve a operação a 1 s) — e era isso que faltava: com os dois ciclos amarrados a
60 s, o ecrã mostrava um retrato de até ~120 s de idade enquanto a mesa já tinha decidido outra coisa.

A tela segue os dois: o `vivo.json` repinta os números (a cada 2 s) e o `painel.json` redesenha o gráfico (a cada
60 s). O que o vivo **não** traz (as velas e a série) é preservado do retrato que já está desenhado — e a fita
mostra **as duas idades**, porque o «agora» fresco com um gráfico velho seria uma meia-verdade.

### O gráfico não é redesenhado — é actualizado

Redesenhar o gráfico a cada 2 s seria caro de verdade (centenas de velas por par) e não é preciso: o ciclo vivo
mexe **só na última barra** (`series.update`, o caminho leve do `lightweight-charts`) e na **linha do preço**.

- a **linha do preço** segue o `ultimo` da LEITURA — fresca a cada segundo no motor (medido: 0-235 ms de idade).
  É ela que dá a sensação de vivo sem inventar barra nenhuma: o que se desenha é um número do venue, lido agora;
- a **barra em curso** muda quando a VELA muda, e quem a puxa é o operador: medido, o ficheiro do ETH-1m tinha 81 s
  e o do BTC-1h 1173 s. Um puxão custa ~1,3 s (processo + pedido), e é por isso que ele não é feito a cada segundo
  — o tecto é do operador, e está dito aqui para não se procurar o defeito na tela;
- duas guardas antes do `update`: o tempo da barra não pode ser **anterior** ao que está desenhado (o
  `lightweight-charts` recusa) nem de outro **instrumento** (desenharia uma barra solta no fim).

`--sem-serie` também serve para pedir um retrato à mão sem pagar o custo da série:

```bash
bun run tools/painel/retrato.ts --sem-serie --para web/painel/vivo.json --corrida <dir>
```

## As portas do servidor (e o que cada uma se recusa a fazer)

O `servidor.ts` serve a tela e abre **duas** portas de escrita, ambas com as três guardas (POST, `Origin` desta tela,
cabeçalho `X-MesaCore: 1`) e ambas sem executar regra nenhuma por si:

| porta | o que faz | o que NÃO faz |
|---|---|---|
| `POST /api/ficha` | **escreve** uma ficha (validação + impressão + registo, pelo `tools/escrever-ficha`) e **cria** uma ficha ou uma conta (`{"criar": true, "conteudo": {...}}`) | não escreve fora de `fichas/` e `config/contas/`; não sobrepõe no `criar` |
| `GET/POST/DELETE /api/verbo` | o **caderno de pedidos** do ciclo de vida (`iniciar`/`parar` a observação): criar, ler e cancelar | **não executa nada** — não há aqui `spawn` nem `kill`; quem consome a fila (`~/.config/mesacore/pedidos-de-verbo.jsonl`) é a camada de operação |

A leitura da fila (`GET`) pede só o cabeçalho da própria tela: o browser **não põe `Origin` em GET** da própria
página (medido — o GET levava 403 com o guarda simétrico). As escritas pedem origem.

## Criar a partir da tela

Na vista de configuração (`#configuracao`), os botões `+ ficha de par` e `+ conta` compõem o candidato **a partir do
que existe** (a ficha do mesmo setup, a conta que já está lá) e mandam-no ao `criar`; o conferidor de cada família
decide. Um `+ setup` **não** abre formulário: um setup é um plugin (manifesto + código) — a tela diz isso e aponta
`setups/`.
