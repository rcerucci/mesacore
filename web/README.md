# web

A superfície de leitura: o que o dono vê.

Regras que este diretório DEVE cumprir:

- fala com um **registo de mesas** — uma lista de identidades e endereços —, nunca com um endereço
  único (RN-E8);
- reúne as mesas e apresenta-as como **uma só superfície** (RN-E9);
- NÃO recalcula o que a mesa já sabe: resultado, velas, posição e histórico vêm da mesa (RN-E9);
- NÃO mostra a topologia: uma mesa com três instrumentos e três mesas com um instrumento cada têm de
  parecer iguais (RN-E10);
- apresenta a configuração de um setup **a partir do template dele** (RN-S4) — a web não conhece os
  itens por nome.

## `painel/` — a primeira superfície (30/09/2026)

Existe código aqui desde 30/09/2026: o painel de monitoração, configuração e controle.
`docs/INTERFACE-DE-CONTROLO.md` é o desenho (os painéis, de onde vem cada número, e o que ainda falta).

Como cada regra acima é cumprida **hoje**, e onde ainda não é:

| regra | como está |
|---|---|
| RN-E8 (registo de mesas) | o fio traz **uma lista** de instalações (`registo_de_mesas`) com **N entradas** — o `retrato.ts` aceita N `--corrida` e, sem nenhuma, DESCOBRE as que estão vivas. Continua a faltar a mesa publicar a identidade num **caminho fixo** (a descoberta é por frescura da `operacao.json`), e por isso `endereco` segue `null` |
| RN-E9 (uma só superfície, sem recalcular) | a tela desenha o que o fio traz; **as velas são do venue** e **a série do indicador é do setup** (a mesma função pura que decide) — não há segunda conta de nada no browser |
| RN-E10 (não mostra a topologia) | o agrupamento é por **instalação**, com a conta como atribuição; a tela não diz quantos processos existem. **Excepção declarada** (pedido do dono, 03/10/2026): há um **seletor de instalação** — saber QUAL corrida se está a olhar era a pergunta que a tela não respondia —, e o nome da pasta da corrida aparece como origem |
| RN-S4 (configuração pelo template) | um campo por **descritor** do template do setup, com o valor vindo da ficha; a tela não conhece o nome de um item |
| RN-E12 (editar com validação e assinatura) | a vista **pede**: compõe, valida com o conferidor do portão e escreve pela porta única (`tools/escrever-ficha`). A tela não tem uma segunda conta das regras |

## `painel/js/` — a tela partida por responsabilidade (03/10/2026)

`index.html` era um ficheiro de 1784 linhas; passou a HTML+CSS com onze módulos (`nucleo`, `fita`, `posicoes`,
`matriz`, `pares`, `grafico`, `dentro`, `registo`, `acoes`, `configuracao`, `telefone`, `arranque`), todos servidos do
mesmo sítio — **zero pedido externo**. O desenho e as decisões estão em `docs/INTERFACE-DE-CONTROLO.md`; o plano e
os números medidos desta fatia, em `docs/WEB-PAINEL-PLANO.md`.

**A LINGUAGEM DA TELA É A DE UM TERMINAL, e não a de uma página** (correcção do dono, 03/10/2026). As regras, para
quem mexer:

- **nenhum parágrafo.** O que é explicação vira COLUNA (o motivo que trava é um código em `TRAVA`, com o texto no
  `title`) ou sai da tela;
- **caixa alta só em cabeçalho de tabela** (9,5 px) — um cabeçalho de secção com slogan é espaço roubado aos dados;
- **linha de 21 px, padding de 2 a 6 px, número tabular alinhado à direita**;
- **o gráfico é o bloco dominante** e a página **não rola no computador**: quem rola é o interior de cada coluna
  (o `body` é uma grelha de três linhas: barra · área · rodapé);
- **a corrida é o TÍTULO** (a primeira pergunta do dono é «de que corrida é isto?»), e a **atenção** é calculada e
  dita no topo: `sem dados há X` › `N falta(s)` › `N travado(s)` (este último em neutro — num sistema em observação,
  travar é o estado normal, e gritar sempre é o mesmo que não gritar).
- **a idade do dado viaja com o número**, não só com o fio: um preço sem idade lê-se como um preço vivo;
- **E A FONTE TAMBÉM** (03/10/2026): cada cabeça de bloco diz de que FICHEIRO vem o que mostra e há quanto tempo foi
  escrito (`fonteEIdade`, do `fontes` do fio) — `operacao.json · 8.5 h`, `registo.jsonl · 8.5 h`,
  `velas-BTC-30m.jsonl · 8.5 h`. Foi o defeito medido: a secção MERCADO dizia `lido: ha' 7,6 h` sem dizer de que
  corrida nem de que ficheiro vinham os números, e o dono perguntou — com razão — se era do venue, da corrida errada
  ou simplesmente velho;
- **o formulário de CRIAR CONTA nasce do que o CONECTOR declara** (03/10/2026): o `questionario.json` de cada plugin
  é a fonte dos campos (o mesmo ficheiro que a entrevista de linha de comando segue), e o fio publica-o em
  `catalogo`. Acrescentar um conector é acrescentar um ficheiro — a tela não tem uma segunda lista de campos. Um
  campo de segredo nunca é um campo de digitação: o valor não passa por aqui (só o NOME da credencial e o caminho
  para o valor).
- **a VISTA DE CONFIGURAÇÃO é um dash**, e não um documento: três colunas (o que existe · o documento escolhido · o
  conferidor e a escrita) e uma faixa de comandos. **A vista de configuração ESCREVE**: o mandato por par (pela
  porta validada das fichas), o ciclo de vida (PEDIDO numa fila — nenhum processo arranca do painel) e a **criação**
  de fichas de par e de contas (`criar`, no mesmo escritor, com o conferidor de cada família).

