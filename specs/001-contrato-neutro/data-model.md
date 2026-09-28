# Phase 1 — Data Model: as mensagens do contrato

Este documento é **desenho**, não fonte: a fonte normativa é `/contracts/*.schema.json`. Aqui diz-se
**o que cada mensagem tem de conter**, de onde vem cada campo e que regra o obriga. Quando o schema
existir, este ficheiro é o que confere se ele ficou certo.

Regras de forma que valem para **todas** as entidades (decisões D4 e D5 de `research.md`):

- **decimal textual** — dinheiro, preços e percentagens são texto (`-?(0|[1-9][0-9]*)(\.[0-9]+)?`),
  nunca número de vírgula flutuante; comparam-se por valor e registam-se como chegaram;
- **`null` não existe** no contrato; um campo que não existe **não está lá**;
- **objecto fechado** — `additionalProperties: false` em todo o objecto, `required` explícito;
- **unidades neutras** — nada em quantidade, lote, ponto, tick ou preço absoluto (fora da resolução e do
  desfecho, que são as mensagens de quem conhece o venue).

---

## 1. Envelope da mensagem

| Campo | Forma | De onde vem | Regra |
|---|---|---|---|
| `contrato` | texto (versão) | quem envia | RN-E18 — conferida por igualdade exacta (D7) |
| `tipo` | enum: `mercado` · `proposta` · `boleta` · `resolucao` · `desfecho` · `manifesto` | quem envia | define qual é o corpo |
| `id` | texto (correlação do ciclo) | mesa | RN-T3 — acompanha proposta, boleta, desfecho e registo |
| `carga` | objecto (um dos corpos abaixo) | quem envia | validado contra o schema daquele `tipo` |

O corpo **nunca** repete a versão. A conferência da versão acontece num só sítio — e antes de qualquer
envio (FR-002).

---

## 2. Objecto de mercado — `mercado`

A mesa entrega-o ao setup **e** ao humano, no mesmo instante lógico (RN-D5). Só factos (RN-D1, RN-D7.1).

| Campo | Forma | Pode faltar? | Regra |
|---|---|---|---|
| `instrumento` | texto (símbolo) | não | identidade |
| `tempo_do_venue_ms` | inteiro (UTC ms) | não | RN-D2 |
| `idade_do_dado_ms` | inteiro (ms) | não | RN-D3 — idade acima do limite **invalida o ciclo** |
| `estado` | enum: `aberto` · `fechado` | não | RN-D8 — mercado fechado é **estado**, não erro |
| `bid` · `ask` · `ultimo` | decimal textual | **sim** | RN-D1, RN-D4 |
| `livro` | `{ lados: [{preco, tamanho}], profundidade }` | **sim** | RN-D1 — profundidade **declarada** |
| `posicao` | `{ lado, unidades, preco_medio, marca }` | **sim** (ausente = sem posição) | RN-D1, RN-B10 |
| `equity` | decimal textual | não | RN-M3 — o CB mede sobre equity com não realizado |
| `funding` | `{ taxa, instante }` | **sim** | RN-D1 — ausente é ausente |

**Regra de ausência**: um campo que pode faltar, quando falta, é **declarado ausente pelo objecto** — a
mesa nunca preenche com valor neutro (RN-D4). É o setup que decide o que fazer com a ausência.

---

## 3. Proposta — `proposta`

| Campo | Forma | De onde vem | Regra |
|---|---|---|---|
| `setup` | `{ nome, versao }` | setup | RN-S7 — a assinatura que entra no registo |
| `lado` | enum **fechado**: `buy` · `sell` · `hold` · `caixa` | setup | RN-S1, RN-T4 |
| `relogio` | `{ proxima_consulta_ms }` (pode faltar) | setup | RN-S2, RN-T5 |

**A invalidade não é um valor do contrato.** Um `lado` fora do enum (ou ausente) é **inválido**: a mesa
trata como `hold`, registra a invalidade e conta-a para o limite de inválidos seguidos (RN-T4). O que
entra no registo é o **valor recebido**, não uma correcção dele (Princípio II).

**Ponto onde a regra admite duas leituras** (registado, não escondido): RN-S2 diz "o setup declara o seu
relógio" e RN-T5 diz "nos ciclos em que o setup não quer ser consultado, a mesa mantém a posição". Este
desenho escolhe: **o relógio é declaração** (vive no template do setup, RN-S3) **e** a proposta pode
adiantá-lo em `relogio.proxima_consulta_ms`; ausente, vale o do template. A outra leitura — o "não quero
ser consultado" ser um valor de resposta — daria um **quinto valor** à proposta, o que colidiria com
"a mesa aceita exactamente quatro valores" (RN-T4). A escolha fica aqui escrita para ser revista.

---

## 4. Boleta — `boleta`

A mensagem central: **nenhum campo em unidade de corretora** (RN-B0). De onde vem cada campo é
conferência do inventário de chaves (secção 4).

| Campo | Forma | De onde vem | Regra |
|---|---|---|---|
| `instrumento` | texto | mesa | identidade (RN-T3) |
| `lado` | enum (4) | setup | RN-S1 |
| `tipo` | enum (da política de execução) | `setup.politica_de_execucao` | RN-B8, RN-S11 |
| `saldo_pct` | decimal textual (% do saldo) | `fichas/<i>.risco` | RN-M4.3 |
| `alavancagem` | decimal textual (múltiplo) | `fichas/<i>.risco` | RN-M4.3 |
| `stop_pct` | decimal textual (% de movimento) | setup, **limitado pela banda** | RN-B7, RN-S11 |
| `tp_pct` | decimal textual (% de movimento) | setup, limitado pela banda | RN-B7 |
| `parcial` | enum: `tudo_ou_nada` · `o_que_der` | setup | RN-B6 — **obrigatório** |
| `desvio_maximo` | decimal textual (% de movimento) | setup | RN-B8, conferido no manifesto (RN-B3) |
| `prazo_da_passiva_ms` | inteiro (ms) | `setup.prazo_da_passiva_ms` | RN-B8 |
| `destino_do_resto` | enum: `agressivo` · `cancelar` | `setup.destino_do_resto` | RN-B8 |
| `reduce_only` | booleano | mesa (saída) | RN-B5 |
| `referencia_do_cliente` | texto | mesa | RN-C4 — reenvio com a mesma referência não duplica |
| `marca_de_posse` | inteiro (31 bits) | mesa | RN-B10, D6 |

`stop_pct` e `tp_pct` podem faltar (há setups sem stop — RN-S3). `parcial` **não** pode faltar.

---

## 5. Resolução — `resolucao`

O que o conector **vai** enviar, devolvido **antes** de executar (RN-C10). É a única mensagem, com o
desfecho, onde aparecem unidades de corretora — e é por isso que a mesa a pode conferir contra a banda.

| Campo | Forma | Regra |
|---|---|---|
| `quantidade` | decimal textual, na unidade do instrumento | RN-C9 — nunca arredondada em silêncio |
| `nocional` | decimal textual | RN-C10 |
| `margem_empenhada` | decimal textual | RN-C10 |
| `alavancagem_efectiva` | decimal textual | RN-C10 |
| `preco_de_liquidacao` | decimal textual | RN-C10, RN-M4.13 |

Recusa em vez de arredondar: se o mínimo do instrumento exigir mais do que a banda autorizada, **não há
resolução** — há desfecho `recusado` com motivo (RN-C9, RN-B4).

---

## 6. Desfecho — `desfecho`

| Campo | Forma | Regra |
|---|---|---|
| `classificacao` | enum **fechado**: `aceite` · `parcial` · `desconhecido` · `recusado` | RN-C2 |
| `motivo` | texto **obrigatório** quando `recusado` | RN-C2 — a recusa traz motivo, nunca silêncio |
| `resolucao` | objecto (secção 5) | RN-C10 — a resolução faz parte do desfecho |
| `resposta_do_venue` | objecto/bruto | FR-021 — o registo não depende de interpretação |

**Transições**, todas com saída declarada:

```
                ┌──────────── aceite
boleta ─▶ resolucao ─▶ enviado ─┼──────────── parcial
                                ├──────────── recusado  (com motivo)
                                └──────────── desconhecido
                                                 │
                                    reconciliação │ (leitura do venue)
                                                 ▼
                                        aceite · parcial · recusado
```

`desconhecido` **nunca** é reportado como sucesso nem como falha (RN-T7.1); enquanto não reconciliar, o
instrumento fica marcado e nenhuma ordem nova sai. Os **números** da execução (quantidade cheia, taxas,
funding) não vivem no desfecho: vêm do histórico da corretora (RN-C11, RN-D6) — a mesa mostra, não
reconstrói.

---

## 7. Manifesto — `manifesto`

Sondado no arranque, **nunca** constante escrita no código (RN-C1). Campos, todos por RN-C1:

`instrumentos[]` com unidades (mínimo, passo, tick) · `alavancagem_maxima` por instrumento e por escalão
de valor · `sabe_ajustar_alavancagem` + modos (cruzado/isolado) · `teto_de_valor_por_ordem` ·
`modelo_de_posicao` (netting/hedging) · `tipos_de_ordem[]` · `parcial_suportada[]` · `desvio_maximo` ·
`reduce_only_nativo` · `stop_anexo` · `profundidade_de_livro` · `funding` · `relogio_de_fecho_de_barra` ·
`idempotencia` · `marca_de_posse` (forma aceita: `cloid` · `clientOrderId` · `magic` · `comment` ·
`nenhuma`, e se liga ordem a posição) · `estado_do_mercado` (RN-D8) · `versao` (RN-E18).

**Divergência detectada** entre manifesto e comportamento observado recusa a operação (RN-C7) — a
bateria de conformidade do venue é de `brokers/<nome>` e está fora deste recorte.

---

## 8. Marca de posse — `marca`

| Propriedade | Valores |
|---|---|
| Forma | inteiro sem sinal, **31 bits** — cabe em todas as formas dos três venues (D6) |
| Composição | identificador curto da **ficha** + contador de **ciclo** |
| Gerada por | mesa, **determinística** (RN-B10) |
| Forma declarada | no **manifesto** do conector (RN-C1): `cloid` · `clientOrderId` · `magic` · `comment` · `nenhuma` |
| Mapa | o registo guarda **marca → ciclo/ficha**; a **posse** lê-se do venue (RN-T16.1) |

Se o manifesto declarar `nenhuma`, a mesa **diz que cai para o registo** (FR-027) em vez de fingir uma
marca que o venue não guarda.

---

## 9. Envelope do registo (ledger) — a decisão inteira, reexecutável

Envelope comum a todas as linhas (RN-L1): `ciclo`, `instante`, `instrumento`, `tipo_de_linha`, `ficha`,
`versao_do_setup`, `versao_do_mandato`, `versao_da_mesa`, `nome_e_versao_do_conector`.
Por ciclo grava-se **snapshot normalizado, proposta, boleta e desfecho** — nada mais (RN-L2). O que é
privado do setup vive num campo `payload` próprio, **nunca no envelope** (RN-L3). As linhas são
acrescentadas, e o desfecho pode ser escrito mais tarde com escrita **idempotente** (RN-L4).

É este envelope que torna possível o que a spec promete: a decisão inteira como **unidade
reexecutável** — re-correr o setup sobre o snapshot tem de produzir a mesma proposta (RN-L5).

---

## Vocabulário normalizado

`/contracts/vocabulario.json` reúne os enums e os **motivos normalizados** de recusa (um conjunto
fechado, partilhado pelas duas linguagens) — para que SC-003 possa comparar motivos **por identificador**
e não por texto livre. Texto humano só como mensagem adicional; o veredicto é o identificador.

## Rastreio spec → desenho

| Requisito | Onde vive no desenho |
|---|---|
| FR-007 a FR-012 | entidade 2 (mercado) e 3 (proposta) |
| FR-013 a FR-018 | entidade 4 (boleta) |
| FR-019 a FR-022 | entidades 5 (resolução) e 6 (desfecho) |
| FR-023 e FR-024 | entidade 7 (manifesto) |
| FR-025 a FR-027 | entidade 8 (marca) |
| FR-028 | entidade 9 (envelope do registo) — o histórico é da corretora, por isso **não** tem schema próprio aqui |
| FR-001 a FR-006 | Envelope da mensagem + regras de forma (D1, D4, D5, D7) |
