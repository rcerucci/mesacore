# Contrato da fronteira vigia ↔ mesa (recorte 003)

Esta fronteira **não existia** como contrato: o comando era interface interna (`core/estados/comando.ts`, e o
§1 do `specs/002 .../contracts/interface.md`). Aqui ele passa a ser **mensagem**, com versão, vocabulário e
recusa com motivo — porque agora há **dois processos** e dois processos não se governam por acordo tácito
(`DEFEITOS.md`, D-005).

## 1. O que atravessa

| Tipo | Sentido | O que é |
|---|---|---|
| `comando` | vigia → mesa | um dos **cinco** verbos, com autor e correlação |
| `resposta_de_comando` | mesa → vigia | aceito (com **efeito**) ou recusado (com **motivo**), mais a transição |
| `pergunta_do_encerramento` | mesa → vigia | o resumo com números da corretora, as opções e o prazo |
| `decisao_do_encerramento` | vigia → mesa | a resposta do dono, identificada pela pergunta |

## 2. O envelope (o de sempre)

Versão, tipo, correlação (`pedido_id`) e carga. Os mesmos cinco requisitos do envelope do recorte 001 — nenhum
campo novo, nenhum campo a menos. A versão é comparada por **igualdade exacta**: mensagem de versão diferente
é **recusada**, nunca adaptada.

## 3. `comando`

```
{"contrato":"1.1.0","tipo":"comando","id":"c-1","carga":{"verbo":"start","autor":"dono","pedido_id":"c-1"}}
{"contrato":"1.1.0","tipo":"comando","id":"c-2","carga":{"verbo":"nova_sessao","autor":"dono","pedido_id":"c-2","motivo":"limite batido em dia de notícia"}}
```

Validação (a que já existia, re-alojada — R1):

- campo a mais → `comando_com_campo_a_mais` (a porta não se alarga sozinha: é por aqui que a mesa seria
  comandada a partir da web em nome de uma estratégia);
- sem `verbo`, `autor` ou `pedido_id` → `comando_incompleto`;
- tipo errado → `comando_com_tipo_invalido`;
- verbo fora do conjunto fechado → `verbo_desconhecido`;
- `nova_sessao` sem `motivo` → `comando_incompleto`.

## 4. `resposta_de_comando`

```
{"contrato":"1.1.0","tipo":"resposta_de_comando","id":"c-3","carga":{"pedido_id":"c-1","aceito":false,"motivo":"mesa_ja_em_operacao","transicao":{"de":"em_operacao","para":"em_operacao"},"instante_ms":1790628000000}}
```

- **Recusa não é erro de protocolo:** é resposta. A mesa responde sempre, e o motivo vem do conjunto fechado.
- Quando **aceito**, o campo é `efeito` (ex.: `sessao_nova_gravada`), não `motivo`.
- A `transicao` traz **estado anterior e posterior** e o `instante` é do **relógio da mesa** (RN-M4.9: quem
  recebe é que carimba; instante de fora não se usa).

## 5. `pergunta_do_encerramento`

```
{"contrato":"1.1.0","tipo":"pergunta_do_encerramento","id":"p-1","carga":{"pedido_id":"p-1","opcoes":["fechar_a_mercado","manter"],"prazo_de_resposta_ms":<chave do dono — RN-A3>,"aviso_de_manter":"...","numeros":{"posicao":"...","nocional":"...","margem":"...","distancia_de_liquidacao":"...","resultado_nao_realizado":"..."}}}
```

O `aviso_de_manter` é **campo**, não nota de rodapé: quem escolhe `manter` tem de ler **antes** que a posição
fica sem defesa. Os números são **da corretora** (RN-V8), nunca estimados por nós.

## 6. `decisao_do_encerramento`

```
{"contrato":"1.1.0","tipo":"decisao_do_encerramento","id":"d-1","carga":{"pedido_id":"p-1","resposta":"fechar_a_mercado"}}
```

**Não é um verbo.** Os verbos do vigia são cinco (RN-V1) e o `verbo_desconhecido` diz, no próprio texto, que
um sexto não entra «por omissão nem por extensão». A decisão é a **resposta a uma pergunta**, e viaja
identificada pela pergunta — `pedido_id`. Sem `pedido_id`, não se sabe a que resumo ela responde, e uma
decisão sem pergunta é uma decisão sem contexto.

## 7. A versão: **1.1.0**, aditiva

Nada do que existia mudou de sentido: o que entra são **quatro tipos** e uma **família de motivos**. Quem não
conhece o tipo recusa com `tipo_desconhecido` — comportamento declarado. A versão é comparada por igualdade
exacta, logo **todos** os casos existentes migram: **354 ocorrências em 45 ficheiros**, e a tarefa mede
**zero** ocorrências de `1.0.0` fora do histórico no fim.

## 8. Os motivos que atravessam: **20 dos 42**

Os **15 de recusa** e os **5 de efeito** produzidos pelo interpretador de comando e pelo encerramento (a lista
completa está no `research.md`, R7). Os outros **22** são motivos de **ciclo, posição e reconciliação**: não
são resposta a comando nenhum e ficam onde nascem (léem-se no ledger e nas marcas).

**A conferência corre nas duas direcções, com o âmbito declarado:** motivo produzido pelo interpretador de
comando (ou pelo encerramento) e **ausente** do vocabulário é falha; motivo do vocabulário **sem quem o
produza** também. Sem o âmbito declarado, a conferência passaria a exigir que o vigia soubesse motivos de
ciclo — que não são dele.

## 9. O que **não** atravessa (para a porta não se alargar)

- **Estratégia, ficha, instrumento, saldo, lado, preço, credencial:** nada disto passa por aqui. É a mesma
  regra que o `comando_com_campo_a_mais` defende, agora com contrato à volta.
- **A conta:** o campo entra no dia em que a mesa servir mais do que uma conta (FR-020). Antes disso seria um
  campo sem leitor.
- **A conformidade da corretora:** nada nesta fronteira a prova. É a bateria por venue (RN-C6).
