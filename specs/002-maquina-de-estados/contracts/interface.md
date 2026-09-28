# Interface — o que a máquina aceita e o que responde

**Fase 1** do plano de `specs/002-maquina-de-estados`. Este recorte **não** mexe no contrato do recorte
001: as mensagens entre a mesa e as pontas continuam a ser as de `/contracts`. O que se define aqui é a
**interface interna** que a máquina expõe a quem a comanda (o vigia, a web) e a quem a pode ler
(o registo).

## 1. Comandos — o que entra

Um comando é uma linha. A forma é deliberadamente pobre: **não** traz configuração, **não** traz
números, **não** traz estratégia.

| Campo | Forma | Obrigatório | Nota |
|---|---|---|---|
| `verbo` | `start` · `pause` · `stop` · `reset` · `nova_sessao` | sim | conjunto fechado; um sexto valor é recusado |
| `autor` | texto | sim | quem pediu — vai para o registo e para a marca de sessão |
| `motivo` | texto | em `nova_sessao` | a razão de abrir sessão nova é do dono, e é registrada |
| `pedido_id` | correlação | sim | para a resposta poder ser ligada ao pedido |

**O que um comando NÃO tem**: ficha, instrumento, saldo, alavancagem, lado, preço, credencial. Um
comando que traga qualquer destes campos é **recusado** — a mesa não aceita ordens pela porta dos
verbos, e aceitar um campo a mais seria a porta a alargar-se sozinha.

## 2. Respostas — o que sai

Toda a resposta diz o que aconteceu **e o que não foi tocado**.

| Campo | Forma | Quando | Nota |
|---|---|---|---|
| `pedido_id` | correlação | sempre | liga a resposta ao comando |
| `resultado` | `aceite` · `recusado` | sempre | dois valores; uma recusa nunca é "aceite com aviso" |
| `estado_anterior` | um dos 4 | sempre | para a resposta ser conferível sem histórico |
| `estado_novo` | um dos 4 | sempre | igual ao anterior quando recusado |
| `motivo` | motivo do vocabulário | na recusa | obrigatório — recusa sem motivo é defeito |
| `nao_tocado[]` | lista de nomes | em `reset` | a lista explícita do que o `reset` **não** mexeu (marcas) |
| `resumo_do_encerramento` | `{posicoes[], escolha_necessaria}` | em `encerrando` | o que está aberto, e a pergunta |

**`resumo_do_encerramento` tem uma obrigação escrita na spec** e que se repete aqui porque é fácil de
perder: quando o dono escolher "manter", a mesa fica `parada` **com a posição viva e nada a defendê-la**.
O resumo tem de dizer isso **antes** da escolha — a diferença entre uma decisão informada e uma
surpresa é o texto deste campo.

## 3. Porta de leitura — o que a máquina consome

Uma função, não um processo (neste recorte): devolve as mensagens do contrato de que o ciclo precisa.

| O que devolve | Mensagem do contrato | Se faltar |
|---|---|---|
| preço, estado do mercado, idade do dado, equity, posição | `mercado` | condição `sem_leitura` (não abre, não fecha) |
| manifesto de capacidades da corretora | `manifesto` | o arranque falha na porta do manifesto |
| posições do venue (para reconciliar) | leitura de posições (`mercado.posicao`) | condição `sem_leitura` |
| relógio do setup | `proposta` (o setup declara quando quer ser consultado) | `congelada` ao fim do prazo |

Todas as mensagens que entram por aqui são **validadas contra o contrato** antes de a máquina decidir
(R4): uma fixture inválida é um erro de execução, nunca uma decisão sobre dado inválido.

## 4. Saída do ciclo — decisões, não ordens

O ciclo devolve `Decisao[]` (§6 do data-model). **Nenhuma** decisão sai deste recorte como mensagem para
a corretora: quem envia é o processo que liga o core ao conector. É por isso que o SC-002 («zero
aberturas fora de `normal`») se mede contando decisões de `abrir` — sem corretora, sem chave, sem rede.

## 5. O que esta interface **não** tem, e é deliberado

- **Nenhum campo de estratégia**: o lado e a janela vêm do template do setup (RN-S3), e o ciclo recebe-os
  prontos. Se um comando trouxesse `lado`, a mesa passaria a poder ser comandada a partir da web em nome
  de uma estratégia — que é precisamente o que a constituição não permite.
- **Nenhum valor ajustável**: limites, prazos e a lista de eventos que avisam vivem em `/config`
  (inventário), não aqui (RN-A1, SC-012).
- **Nenhuma credencial**: nem em comando, nem em resposta, nem na marca de sessão (RN-E14).
- **Nenhuma posição guardada**: a interface não aceita nem devolve um mapa de posições próprias; a posse
  é sempre lida da corretora (FR-022).
