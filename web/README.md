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
| RN-E8 (registo de mesas) | o fio traz **uma lista** de instalações (`registo_de_mesas`) — hoje com uma entrada e `endereco: null`. A tela já não muda de forma com uma ou três; **falta** a mesa publicar a identidade num caminho fixo, para a descoberta ser descoberta e não manutenção à mão |
| RN-E9 (uma só superfície, sem recalcular) | a tela desenha o que o fio traz; **as velas são do venue** e **a série do indicador é do setup** (a mesma função pura que decide) — não há segunda conta de nada no browser |
| RN-E10 (não mostra a topologia) | o agrupamento é por **instrumento**, com a conta como atribuição; nada no ecrã diz quantos processos existem |
| RN-S4 (configuração pelo template) | um campo por **descritor** do template do setup, com o valor vindo da ficha; a tela não conhece o nome de um item |
| RN-E12 (editar com validação e assinatura) | **não existe ainda**: nesta fatia a tela não escreve ficha nenhuma — mostra o estado e o comando exacto que o muda |
