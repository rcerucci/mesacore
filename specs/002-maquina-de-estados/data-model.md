# Data model — a máquina de estados

**Fase 1** do plano de `specs/002-maquina-de-estados`. Cada campo tem **forma**, **de onde vem** e a
**regra** que o obriga. Onde a origem é um valor do dono, a chave do inventário é citada — e o
conferidor do inventário (recorte 001) passa a cobrir estas chaves também (SC-012).

Notação: **[dado]** vive em ficheiro de dado · **[runtime]** vive em memória do processo ·
**[marca]** sobrevive ao processo · **[decisão]** é saída observável do ciclo.

---

## 1. `EstadoDaMesa` — [runtime]

O ciclo de vida do processo. **Não persiste** (R3): ao arrancar, a mesa está sempre `parada`.

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `estado` | `parada` · `em_operacao` · `pausada` · `encerrando` | a máquina, ao aplicar um verbo legal | FR-001, RN-V1 |
| `desde_ms` | instante, relógio do venue | registrado na transição | FR-041 |
| `motivo_da_entrada` | texto do vocabulário de motivos | a transição que a causou | FR-007 |

*Invariante*: `estado` nunca muda sem uma linha da tabela que o autorize; e toda a mudança deixa
registro com instante e motivo (FR-004, FR-041).

## 2. `CondicaoDoInstrumento` — [runtime]

O que se sabe sobre um instrumento agora. **Não persiste**: recalcula-se das leituras a cada arranque
(o que persiste é a leitura, não a conclusão).

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `instrumento` | símbolo | configuração do dono (`conta.instrumentos[]`) | RN-M1 |
| `condicao` | `normal` · `sem_leitura` · `divergente` · `congelada` · `mercado_fechado` | das leituras: leitura falhada (RN-D7), reconciliação divergente (RN-T13), setup mudo/falho (RN-S8, RN-T10), estado declarado pelo conector (RN-D8) | FR-002, FR-015 |
| `dado_velho` | booleano | `idade_do_dado_ms` do objecto de mercado ≥ `conta.idade_maxima_do_dado_ms` | FR-020, RN-D3 |
| `abre` | booleano derivado | `condicao == normal` **e** não `dado_velho` | FR-015, FR-020 |
| `fecha` | booleano derivado | `normal` **ou** `dado_velho` (nunca em `sem_leitura`, `divergente`, `congelada`, `mercado_fechado`) | FR-016 a FR-020 |
| `alarma` | booleano derivado | `dado_velho` ou condição ≠ `normal` | FR-042, RN-E15 |

**A distinção que este objecto existe para forçar** (as "três confusões" do documento de estados):

| | `dado_velho` | `sem_leitura` | `divergente` |
|---|---|---|---|
| abre | não | não | não |
| fecha/reduz | **sim** | **não** | **não** por iniciativa própria |
| sai por | dado novo | leitura voltar | reconciliação explicar |

## 3. `Posicao` — [runtime], derivada, nunca guardada

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `instrumento` | símbolo | — | — |
| `estado` | `nenhuma` · `abrindo` · `aberta` · `fechando` | da posição reportada pelo venue **+** as ordens em voo do ciclo | FR-003, FR-022 |
| `unidades` | decimal textual | objecto de mercado (`posicao.unidades`) | RN-D1 |
| `marca_de_posse` | inteiro de 31 bits | objecto de mercado (`posicao.marca_de_posse`) | RN-T16.1 |
| `nossa` | booleano derivado | `marca_de_posse` ∈ marcas que a mesa sabe compor | FR-022 |

**O que este objecto NÃO é**: um registo. Não é escrito em lado nenhum, e o ficheiro de marcas
**não pode** ter um mapa instrumento → posição (R2). Uma posição sem a nossa marca é `nossa = false`,
relatada como alheia e **não gerida** — o comportamento já medido no recorte 001 (`reinicio.sh`).

## 4. `Marca` — [marca], persistida em `core/estado/.marcas.json`

| Marca | Campos | De onde vem | Regra que obriga |
|---|---|---|---|
| `sessao` | `instante_ms`, `equity_de_partida`, `autor`, `motivo`, `configuracao_em_vigor{ficha, versao_do_setup, versao_do_mandato}` | `nova_sessao` | FR-034, RN-M3.4, RN-M3.5 |
| `inibicao_cb` | `motivo`, `instante_ms`, `perda_medida` | o CB a disparar | FR-036, FR-037, RN-M3.1, RN-M3.3 |
| `desconhecido` | por instrumento: `instrumento`, `motivo`, `instante_ms`, `referencia_do_cliente` | desfecho sem confirmação | FR-027 a FR-030, RN-T7.1 |

**Forma do ficheiro**: `{"sessao": {...} | null, "inibicao_cb": {...} | null, "desconhecido": [...]}`.
Escrita atómica (temporário + `rename`), nunca parcial: um ficheiro de marcas meio escrito seria uma
mesa que não sabe se está inibida.

**Invariante de forma (porteiro)**: `desconhecido[]` tem `instrumento` e `motivo`; **nenhum** campo do
ficheiro aponta para `unidades`, `quantidade` ou `posicao`. Se aparecer, o porteiro reprova (R2).

**`reset` não escreve aqui** (FR-005): a única operação do `reset` é registar que não tocou em nada.

## 5. `Transicao` — [dado] em `core/estados/transicoes.json`

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `de` | um dos 4 estados | a tabela | R1 |
| `verbo` | `start` · `pause` · `stop` · `reset` · `nova_sessao` | o vigia/web | FR-001, RN-V1 |
| `para` | estado novo **ou** ausente | a tabela | FR-004 |
| `recusa` | motivo do vocabulário, quando `para` está ausente | o vocabulário normalizado | FR-004 |
| `guarda` | condição de contexto (ex.: `sem_posicao_viva`, `sem_inibicao`) | a tabela | FR-008, FR-012, FR-037 |
| `nota` | a regra `RN-*` que obriga a linha | a tabela | — |

**Invariantes conferidos por programa** (é a razão de a tabela ser dado, R1):

1. todo o estado tem **pelo menos uma saída** (`para` não vazio numa das suas linhas);
2. todo o verbo aparece **pelo menos uma vez** — um verbo sem casa é ruído;
3. nenhum estado é **inalcançável** a partir de `parada`;
4. toda a `recusa` traz motivo, e o motivo consta do **conjunto próprio da mesa**
   (`core/estados/motivos.json` — R7: o vocabulário do contrato é da língua que cruza a fronteira, não
   dos comandos internos);
5. `reset` **nunca** leva a estado novo nem a `para` diferente do `de`.

## 6. `Decisao` — [decisão], a saída do ciclo

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `instrumento` | símbolo | o ciclo | — |
| `acao` | `abrir` · `fechar` · `adoptar` · `nada` | a condição + o que o setup propôs | FR-015 a FR-026 |
| `motivo` | motivo do vocabulário | a mesa (por que **não** fez, quando `nada`) | FR-007 |
| `boleta` | mensagem do contrato (recorte 001) | montada do mandato + do template | FR-009, RN-T6 |
| `avisa` | booleano | se a condição exige aviso | FR-042, RN-E15 |

`acao: abrir` é o **único** caminho para uma boleta. É este campo que o SC-002 conta (zero aberturas
fora de `normal`), sem inspecção de código (R5).

## 7. `PedidoPendente` — [marca]

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `verbo` | `stop` (por agora, só este) | o vigia | FR-014, RN-V9.1 |
| `instante_ms` | instante | quando foi pedido | FR-041 |
| `motivo` | texto | sem resposta no prazo declarado | RN-V9.1 |

## 8. `Ciclo` — [decisão], o resultado de uma passagem

| Campo | Forma | De onde vem | Regra que obriga |
|---|---|---|---|
| `instante_ms` | instante do venue | a leitura | RN-D3 |
| `estado_da_mesa` | um dos 4 | a máquina | FR-001 |
| `por_instrumento[]` | lista de `Decisao` | o ciclo | FR-007 |
| `pedidos_pendentes[]` | lista de `PedidoPendente` | os pedidos do dono | FR-014 |
| `equity` | decimal textual | objecto de mercado | RN-M3 |

**Ordem dentro do ciclo** (importa, e é a razão de o ciclo ser uma entidade e não um laço solto):
ler → conferir o CB → condição de cada instrumento → decidir → (quem executa envia) → reconciliar.
O CB corre **antes** das decisões de abrir, e corre também com a mesa `pausada` (FR-040).

---

## Relações

```
EstadoDaMesa 1 ── n CondicaoDoInstrumento      (uma por instrumento configurado)
CondicaoDoInstrumento 1 ── 1 Posicao           (derivada das leituras, nunca guardada)
Ciclo 1 ── n Decisao                           (uma por instrumento, por passagem)
Ciclo 1 ── n PedidoPendente
Marca 1 ── 1 EstadoDaMesa                      (a inibição é quem decide se o `start` passa)
Marca desconhecido n ── 1 Instrumento          (bloqueia ordem nova naquele instrumento)
```

## O que este modelo **não** tem

- **Nenhum campo de estratégia** (lado, stop, janela): isso vem do template do setup, e o ciclo recebe-o
  pronto (RN-S3).
- **Nenhum campo em unidade de corretora** (quantidade, lote, preço absoluto): a boleta viaja em
  unidades neutras e quem traduz é o conector (recorte 001, SC-001 — continua medido).
- **Nenhuma credencial**: nem no ficheiro de marcas, nem no registo, nem na tabela (RN-E14).
- **Nenhum mapa de posições**: a posse é deduzida da corretora (FR-022, R2).
