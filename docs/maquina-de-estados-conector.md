# A máquina de estados do conector

Companheira da `regra-de-negocio-conector.md`. Aqui está **o que o conector pode estar a fazer**, o que o faz
mudar, e o que se diz quando muda. As regras (`RN-H*`) são as da regra de negócio; as mensagens são as do
contrato neutro.

## Porquê uma máquina própria, se o conector «só traduz e transporta»

Porque traduzir e transportar **tem estados**, e a maior parte dos defeitos caros mora neles: uma ordem que
pode ter sido aceite e não se sabe; uma ligação que caiu a meio de um envio; um pedido repetido; um
`desconhecido` que ficou por reconciliar. O conector não decide risco — mas decide **o que fazer quando não
sabe**, e isso tem de ser uma tabela, não um improviso por ramo de código.

**Quem manda no conector:** o pedido (a boleta) e o venue. O conector **não** decide se se opera (RN-C5): ele
executa o que a boleta diz, e o que ele acrescenta é **conhecimento do venue** — o que existe, em que passo,
com que mínimo, e o que aconteceu.

## Os três eixos

Um estado do conector é o cruzamento de três coisas. Nenhuma delas se adivinha:

| Eixo | Estados | Quem o diz |
|---|---|---|
| **Ligação** | `sem_ligacao` · `a_ligar` · `pronta` · `em_duvida` | o **protocolo do venue** (RS-*/WS), nunca o silêncio (RN-H2) |
| **Ordem em curso** (por instrumento) | `nenhuma` · `a_resolver` · `a_enviar` · `enviada` · `a_aguardar` · `fechada_aceite` · `fechada_parcial` · `fechada_recusada` · `desconhecida` | a resposta do venue, e o prazo declarado |
| **Reconciliação** (por instrumento) | `em_dia` · `pendente` | o que o venue conta do que aconteceu (posição, ordens, execuções) |

`em_duvida` na ligação **não** é «caída»: é «não sei» (RN-H2). E `desconhecida` na ordem **não** é «falhou»:
é «pode ter acontecido» (RN-H12).

## Os acontecimentos

| Acontecimento | Vem de |
|---|---|
| `pedido` | uma `boleta` do contrato |
| `resposta_do_venue` | a resposta à ordem (preenchida, em repouso, recusada, com erro) |
| `sem_resposta_no_prazo` | o relógio: o prazo declarado passou |
| `ligacao_caiu` / `ligacao_voltou` | o protocolo do venue |
| `leitura_da_conta` | o estado da conta (posição, ordens, execuções) |
| `eco_da_referencia` | a mesma referência de cliente outra vez (RN-H9) |
| `pedido_de_outra_conta` | um pedido que nomeia outra conta (RN-H15) |

## A tabela

| Estado (ordem) | Acontecimento | Passa a | Acção | O que sai |
|---|---|---|---|---|
| `nenhuma` | `pedido` | `a_resolver` | traduzir e resolver (RN-H4) | **a `resolução`**, antes de enviar (RN-H10) |
| `a_resolver` | resolução calculada | `a_enviar` | enviar | — |
| `a_resolver` | não cabe no passo/mínimo/banda | `nenhuma` | **não envia** | `recusado` + motivo do venue ou da conversão (RN-H5) |
| `a_enviar` | `resposta_do_venue` = preenchida | `fechada_aceite` | compor o desfecho | `desfecho` `aceite`, com os números do venue |
| `a_enviar` | `resposta_do_venue` = parcial | `fechada_parcial` | compor o desfecho | `desfecho` `parcial` |
| `a_enviar` | `resposta_do_venue` = recusa/erro | `fechada_recusada` | registar a palavra do venue | `desfecho` `recusado` + motivo (RN-H11) |
| `a_enviar` | `sem_resposta_no_prazo` | `desconhecida` | marcar e **não** reenviar às cegas | `desfecho` `desconhecido` (RN-H12) |
| `enviada`/`a_aguardar` | `sem_resposta_no_prazo` | `desconhecida` | idem | idem |
| `desconhecida` | `leitura_da_conta` | `em_dia` | **reconciliar**: posição, ordens, execuções (RN-H13) | o desfecho verdadeiro, corrigido |
| `desconhecida` | `pedido` (novo) | `desconhecida` | **recusar** o pedido novo | `recusado` — `desconhecido_por_reconciliar`; **fechar/reduzir continua permitido** (RN-H19) |
| `nenhuma` | `eco_da_referencia` | `nenhuma` | não duplicar | o desfecho da **mesma** ordem (RN-H9, RN-C4) |
| qualquer | `pedido_de_outra_conta` | (igual) | recusar | `recusado` — `pedido_de_outra_conta` (RN-H15) |
| qualquer | `ligacao_caiu` | ligação `em_duvida` | parar de enviar | — (o que está em curso passa a `desconhecida` se havia ordem viva) |
| ligação `em_duvida` | `ligacao_voltou` | `pronta` | ler a conta antes de qualquer ordem nova | — |
| `fechada_*` | (fim) | `nenhuma` | guardar o desfecho | — |

### O que a tabela **não** tem, de propósito

- **Uma transição para «esperar mais um pouco» como acontecimento.** Esperar não é acontecer: uma volta do
  relógio que nada mudou **não** reescreve o estado nem reinicia o prazo. É a lição que o recorte 003 pagou
  a medir (um `encerrando → encerrando` a cada volta reiniciava o prazo para sempre).
- **Uma transição que «arredonda para caber».** Não existe: fora da banda ou fora do passo é `recusado`
  (RN-H5), e o degrau de alavancagem que não existe também (RN-H6).
- **Uma transição de sucesso por silêncio.** `desconhecido` só sai de `desconhecida` por **leitura do
  venue** (RN-H13), nunca por tempo nem por otimismo.

## As invariantes

1. **A resolução precede o envio** onde o venue deixa perguntar; onde não deixa, sai depois, com os números
   do venue (RN-H10, RN-E20).
2. **Uma ordem em curso por instrumento.** Não há duas a voar: a segunda espera ou é recusada.
3. **Com `desconhecido` pendente, não entra ordem nova** naquele instrumento. Sair (fechar/reduzir) é sempre
   permitido (RN-H19) — é a única ordem que não precisa de leitura.
4. **A credencial nunca entra na máquina.** Nem no estado, nem no log, nem na mensagem: o conector guarda
   uma **referência** à ligação (RN-H16, RN-C20, RN-E14).
5. **Uma ligação, uma chave, um processo** (RN-H15).

## Dois percursos, para conferir a tabela

**Entrada post-only que fica em repouso.** `pedido` → `a_resolver` (traduz percentagem do saldo para
quantidade, com o passo sondado) → **sai a `resolução`** → `a_enviar` → o venue responde `resting` →
`a_aguardar` → preenche depois → `fechada_aceite`, com `avgPx`/`totalSz` do venue. Se o post-only cruzar, o
venue **recusa** e sai `recusado` — não se «corrige» o preço para caber (é a diferença 1 da §1 da regra de
negócio).

**Saída a mercado que não é servida.** `pedido` → `a_resolver` → `a_enviar` → o venue não diz nada →
`sem_resposta_no_prazo` → `desconhecida`, com `desfecho` `desconhecido` → **leitura da conta**: se a posição
existe, o desfecho verdadeiro é `aceite`/`parcial` com os números lidos; se não existe, é `recusado` ou
`fechada_recusada` conforme o que o venue contar. Noutro instrumento, a operação continua: o `desconhecido`
é **daquele** instrumento.

## Como isto se mede (o que a spec terá de trazer)

As bancadas do conector são as mesmas dos outros dublês: **casos em dado** (`*.casos.json`), e os **mesmos
casos** corridos no conector real e no dublê de mesa — divergência é falha (o padrão do SC-004). O que muda é
que agora há um venue a sério do outro lado: a bateria de conformidade (§3 da regra de negócio) corre
**primeiro em ambiente de teste**, com o tamanho mínimo possível, e nada nela pede uma chave real no
repositório (RN-H16, RN-H17).
