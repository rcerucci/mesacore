# Máquina de estados — MesaCore (v1)

| | |
|---|---|
| Papel | Os **estados** da mesa e do instrumento, as **transições legais** e os **eventos** que as disparam. É a vista que a prosa não dá: em texto, um estado sem saída ou um evento sem estado não se vê. |
| Deriva de | `docs/regra-de-negocio.md` (as regras `RN-*` citam-se aqui; nenhuma regra nova entra sem voltar para lá). |
| Regra de leitura | Um estado sem saída declarada é lacuna. Um evento que não muda nada é ruído. Um evento sem estado onde caiba é lacuna. |

---

## 1. As duas vistas, e por que não são uma só

A máquina tem **dois eixos** porque a mesa é um processo com `n` instrumentos (RN-E3): o ciclo de vida é
**da mesa**, e a condição de operação é **de cada instrumento**. Juntá-los num só eixo daria quarenta
estados em que trinta são combinações impossíveis — e é assim que se esconde uma lacuna.

| Eixo | Onde vive | Estados |
|---|---|---|
| **Estado da mesa** (ciclo de vida) | o processo | `parada` · `em_operacao` · `pausada` · `encerrando` |
| **Condição do instrumento** | cada instrumento, dentro da mesa a correr | `normal` · `sem_leitura` · `divergente` · `congelada` · `mercado_fechado` |
| **Posição do instrumento** | cada instrumento | `nenhuma` · `abrindo` · `aberta` · `fechando` |

E três **marcas persistidas**, que sobrevivem ao processo (é onde moram os defeitos difíceis):

| Marca | O que guarda | Regra |
|---|---|---|
| `sessao` | instante e equity de partida da corrida | RN-M3.4 |
| `inibicao_cb` | que o circuit breaker disparou e o motivo | RN-M3.1, RN-M3.3 |
| `desconhecido` | desfecho sem confirmação, por instrumento | RN-T7.1, RN-V3 |

**`reset` não apaga marca nenhuma** (RN-V3). É a única razão de as marcas serem marcas e não estados: um
estado morreria com o processo.

---

## 2. Estado da mesa

| Estado | O que faz | O que suspende | Entra por | Sai para |
|---|---|---|---|---|
| `parada` | nada: o processo não corre | tudo | `stop` concluído; queda; CB | `em_operacao` (**start**, se a validação passar e não houver `inibicao_cb`); permanece com motivo registrado (**start** recusado) |
| `em_operacao` | lê, consulta o setup pelo relógio dele, monta boleta, envia, reconcilia, registra (RN-T1 a RN-T12) | — | validação do arranque aprovada | `pausada` (**pause**); `encerrando` (**stop** com posição, ou CB); `parada` (**stop** sem posição) |
| `pausada` | **reconcilia e defende**: lê, verifica o CB, adota ordens vivas | **abrir** (RN-V2) | **pause** | `em_operacao` (**start**/retomar); `encerrando` (**stop** com posição); `parada` (**stop** sem posição) |
| `encerrando` | para de abrir, apresenta o **resumo** e **pergunta** se fecha a mercado (RN-V7, RN-V8) | **abrir** | **stop** com posição aberta; CB | `parada` (**fechar a mercado** → liquida; **manter** → parada com posição viva); *volta a operar sem decisão* (RN-V9 — ver lacuna 3) |

**`parada` com `inibicao_cb`** é o estado depois do alerta grave: o processo está em baixo, a posição foi
liquidada e o motivo está registrado. `start` **recusa** (RN-M3.3) — e é aqui que a máquina revelou o
buraco maior (ver §6, lacuna 1).

---

## 3. Instrumento: condição e posição

**Condição** — quando não é `normal`, o instrumento **não abre**. Se tem posição, o que se pode fazer é
diferente em cada caso (e é essa diferença que evita o erro clássico de "fechar às cegas"):

| Condição | O que aconteceu | Abre? | Fecha? | Sai por |
|---|---|---|---|---|
| `normal` | tudo conforme | sim | sim | — |
| `sem_leitura` | não consigo ler a posição (RN-D7) | **não** | **não** — fechar sem saber o que existe é adivinhar | leitura volta → reconcilia |
| `divergente` | o que a mesa espera ≠ o que a corretora reporta (RN-T13) | **não** | **não** por iniciativa própria | reconciliação que explique; ordem viva desconhecida → decisão do dono |
| `congelada` | falha do setup: excepção, valor fora dos quatro, silêncio além do prazo (RN-S8, RN-T10) | **não** | **não** — congelar é não enviar ordem nova nem cancelar o que serve | o setup volta a responder |
| `mercado_fechado` | estado **declarado pelo conector** (RN-D8) | **não** | não | o conector declara aberto |

**Posição** — o ciclo de vida, com a marca `desconhecido` como única saída suja:

```
nenhuma --(proposta buy/sell conforme)--> abrindo
abrindo --(aceite)--> aberta
abrindo --(parcial)--> aberta, com o resto tratado pela política da boleta (RN-B6, RN-B8)
abrindo --(recusado)--> nenhuma   (motivo registrado)
abrindo --(desconhecido)--> MARCA desconhecido  (bloqueia ordem nova nesse instrumento, RN-T7.1)
aberta  --(proposta de saída | stop no venue | CB | encerrar a mercado)--> fechando
fechando --(aceite)--> nenhuma
fechando --(relutado/recusado)--> aberta (recusa de fechar é alarme, não silêncio)
fechando --(desconhecido)--> MARCA desconhecido
MARCA desconhecido --(reconciliação decide)--> aberta | nenhuma     (NUNCA por reset, RN-V3)
```

**`sem_margem` NÃO é estado.** É motivo registrado no ciclo: o instrumento que não coube no teto fica
simplesmente de fora e o ciclo seguinte corre o seu caminho (RN-M4.8). Declaro-o aqui porque é o estado
que alguém inventaria primeiro.

---

## 4. Eventos

| Evento | Vem de | Efeito |
|---|---|---|
| `start` / `stop` / `pause` / `reset` | vigia (RN-V1) | transições da §2; `reset` = reinício sem mexer em nada (RN-V3) |
| `nova_sessao` | **verbo que falta** (§6, lacuna 1) | único caminho fora de `inibicao_cb` |
| `buy` · `sell` · `hold` · `caixa` | setup (RN-S1) | monta (ou não) boleta, respeitando mandato e template (RN-T6) |
| proposta inválida (5º valor, ausente) | setup | trata como `hold` e registra a invalidade (RN-T4) |
| silêncio além do prazo do setup | setup | **congela** o instrumento (RN-S8, RN-T10) |
| dado novo / **dado velho** | conector | velho **invalida o ciclo**: pode fechar e reduzir, nunca abrir (RN-D3) |
| **leitura falhada** | conector | condição `sem_leitura`: não abre, não fecha (RN-D7) |
| mercado aberto/fechado | conector | condição `mercado_fechado` (RN-D8) |
| desfecho: aceite · parcial · desconhecido · recusado | conector | §3 e RN-T7 |
| reconciliação coincide / **diverge** | conector | `normal` ou `divergente` (RN-T8, RN-T13) |
| ordem viva desconhecida | arranque ou ciclo | `divergente` + alarme; cancelar só com decisão (RN-T14) |
| **CB atingido** | mesa, em cada ciclo | `encerrando` por CB → liquida → `parada` com `inibicao_cb` (RN-M3.1) |
| margem total esgotada | mesa, no ciclo | instrumento fica de fora, motivo registrado (RN-M4.8) |
| risco por ordem excedido | mesa, antes de enviar | **não envia** e registra (RN-M4.12) |
| banda violada | mesa | recusa, nunca corrige (RN-M6.2, RN-M9) |

### 4.1. As seis portas do arranque (`start`)

O `start` só leva a `em_operacao` se **todas** passarem; qualquer uma recusa o arranque e registra o motivo
— a mesa nunca corrige nada para entrar:

1. **manifesto** declara os instrumentos e as unidades (RN-M1, RN-C1);
2. **mandato** dentro das bandas: nada zero, negativo ou absurdo (RN-M9);
3. **contenda resolvida**: soma das fichas ≤ teto **ou** política de contenção declarada (RN-M4.7);
4. **inventário de chaves** fecha: nenhuma chave em uso fora dele (RN-A2);
5. **versão do contrato** compatível em cada ponta (RN-E18);
6. **sessão**: retomada do registro, e não inibida — ou o arranque recusa (RN-M3.3, RN-M3.4).

---

## 5. As três confusões que a máquina separa

Três situações parecidas com comportamentos diferentes — foi o eixo das condições que as obrigou a
distinguir-se:

| | **Dado velho** (RN-D3) | **Sem leitura** (RN-D7) | **Divergência** (RN-T13) |
|---|---|---|---|
| O que é | cheguei a ler, mas o dado envelheceu | não consegui ler | li, e não bate com o que eu esperava |
| Abrir | não | não | não |
| Fechar/reduzir | **sim** (fechar com dado velho é legítimo) | **não** (não sei o que existe) | **não** por iniciativa própria |
| Alarme | sim | sim | sim |
| Sai por | dado novo | leitura voltar | reconciliação explicar |

---

## 6. Lacunas que a máquina revelou

1. **Falta um verbo.** Depois do CB a mesa está em `parada` com `inibicao_cb` e o `start` **recusa**
   (RN-M3.3). `reset` não serve — é reinício sem mexer em nada (RN-V3). Logo, **não existe forma legal de
   abrir sessão nova**: a regra exige uma decisão explícita e o sistema não tem onde a receber. Duas
   saídas: **(a)** um **quinto verbo** `nova_sessao` (autor, instante, motivo, e é o único que limpa a
   inibição) — recomendado; **(b)** `start` com motivo obrigatório quando há inibição, o que enfraquece o
   `start` como verbo determinístico.
2. **O CB corre em `pausada`?** A regra diz que em `pause` a mesa "continua a reconciliar" (RN-V2), mas não
   diz se o **CB continua a ser verificado**. Tem de continuar: `pause` suspende **abertura**, nunca
   **defesa** — se uma posição aberta caminhar para o limite com a mesa pausada, quem fecha é o CB.
3. **`encerrando` sem resposta.** O RN-V9 diz que sem decisão a mesa "continua a correr e a reconciliar",
   mas não diz se volta a **abrir**. Ambiguidade real na minha própria escrita: parada perpétua (nunca
   mais abre, e o `stop` fica pendente para sempre) ou volta ao normal (abre, com o pedido de stop
   registrado). Recomendo **voltar ao normal** — um pedido ignorado não deve paralisar a mesa — e está à
   tua palavra.
4. **Contradição entre o encerramento e o RN-T16.** Se o encerramento for "manter posição" (RN-V8), a mesa
   fica em baixo com posição viva. No arranque seguinte, o RN-T16 manda **não governar** o que a mesa não
   abriu — e, sem memória própria (a posição é a da corretora, RN-T8), a mesa não sabe que foi ela. A
   posição ficaria sem governo para sempre. **Correcção:** a posse da posição **lê-se do ledger** — se há
   ciclo que a registre como aberta por esta mesa e nenhum que a feche, é dela; se não há, é manual.
5. **`congelada` não está na lista de eventos que avisam** (RN-E15): sem isso, um setup quebrado deixa a
   mesa em gelo e o dono sem saber.
6. **Fechar foi recusado** (transição `fechando --recusado--> aberta`) não tinha tratamento declarado: é
   alarme grave, não uma tentativa falhada.
