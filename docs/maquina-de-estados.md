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
| `sessao` | instante, equity de partida e a **configuração em vigor** (ficha, versão do setup e do mandato) | RN-M3.4, RN-M3.5 |
| `inibicao_cb` | que o circuit breaker disparou e o motivo | RN-M3.1, RN-M3.3 |
| `desconhecido` | desfecho sem confirmação, por instrumento | RN-T7.1, RN-V3 |

Há uma quarta marca que **não é nossa**: a **posse de uma posição** lê-se da **corretora**, pela marca de
posse que a ordem levou (RN-B10, RN-T16.1) — o ledger guarda só o mapa marca → ciclo/ficha. É por isso
que a mesa se pode reinstalar sem história e ainda saber o que é dela.

**`reset` não apaga marca nenhuma** (RN-V3). É a única razão de as marcas serem marcas e não estados: um
estado morreria com o processo.

---

## 2. Estado da mesa

| Estado | O que faz | O que suspende | Entra por | Sai para |
|---|---|---|---|---|
| `parada` | nada: o processo não corre | tudo | `stop` concluído; queda; CB | `em_operacao` (**start**, se a validação passar e não houver `inibicao_cb`); permanece com motivo registrado (**start** recusado) |
| `em_operacao` | lê, consulta o setup pelo relógio dele, monta boleta, envia, reconcilia, registra (RN-T1 a RN-T12) | — | validação do arranque aprovada | `pausada` (**pause**); `encerrando` (**stop** com posição, ou CB); `parada` (**stop** sem posição) |
| `pausada` | **reconcilia e defende**: lê, verifica o CB, adota ordens vivas | **abrir** (RN-V2) | **pause** | `em_operacao` (**start**/retomar); `encerrando` (**stop** com posição); `parada` (**stop** sem posição) |
| `encerrando` | para de abrir, apresenta o **resumo** e **pergunta** se fecha a mercado (RN-V7, RN-V8) | **abrir** | **stop** com posição aberta; CB | `parada` (**fechar a mercado** → liquida; **manter** → parada com posição viva); `em_operacao` **sem resposta** (RN-V9.1: volta ao normal, `stop` fica pendente) |

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
| `nova_sessao` | vigia (RN-V10) | único caminho fora de `inibicao_cb`; grava instante, equity de partida, autor, motivo e a **configuração em vigor** — é a fronteira entre duas configurações comparadas |
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

## 6. Lacunas que a máquina revelou — todas fechadas

1. **Falta um verbo — FECHADA.** Depois do CB a mesa está em `parada` com `inibicao_cb` e o `start`
   **recusa** (RN-M3.3); o `reset` não mexe em nada (RN-V3), logo não havia forma legal de abrir sessão
   nova. Entrou um **quinto verbo**, `nova_sessao` (RN-V1, RN-V10), que é o único caminho fora da inibição
   — e que ganhou uma segunda função: **fechar a unidade de comparação**, porque uma sessão tem uma
   configuração em vigor (RN-M3.5). Trocar de setup sem sessão nova somaria dois setups no mesmo número.
2. **O CB corre em `pausada` — FECHADA** (RN-V2.1): `pause` suspende **abertura**, nunca **defesa**. Se uma
   posição aberta caminhar para o limite com a mesa pausada, quem fecha é o CB.
3. **`encerrando` sem resposta — FECHADA** (RN-V9.1): volta ao normal, **abre incluído**, e o pedido de
   `stop` fica registrado como pendente. Um pedido ignorado não paralisa a mesa.
4. **Contradição entre o encerramento e o RN-T16 — FECHADA**, e com uma solução melhor do que a minha: a
   posse de uma posição lê-se da **corretora**, pela **marca de posse** que a ordem levou (RN-B10,
   RN-T16.1), e não do nosso registro. O `cloid` da HL, o `clientOrderId` do cTrader e o `magic`/`comment`
   do MT5 (na própria posição) existem para isto: a mesa reencontra o que é dela **pelos registros do
   venue**, sem base de dados própria de posições.
5. **`congelada` não avisava — FECHADA**: entrou na lista de eventos que exigem aviso (RN-E15), com a
   recusa ao fechar.
6. **Fechar foi recusado — FECHADA** (RN-T7.3): é alarme grave, com nova tentativa declarada, não uma
   tentativa falhada sem consequência.

---

## Nota de estado (28 set 2026): este documento é a **vista**, não a fonte

A partir do recorte 002, a fonte do comportamento é `core/estados/transicoes.json`, lida pelo intérprete
(`core/estados/maquina.ts`) e conferida pelos sete invariantes de `tools/verificar-maquina/tabela.ts`.

Este documento continua a ser o que se lê para **entender** — a vista de cima —, mas quando os dois
divergirem, **a tabela ganha**, e a divergência é um defeito deste documento. Nenhum dos dois é código: a
tabela é dado, e é por isso que a máquina pode mudar de comportamento sem mudar de programa.

### Emenda (28 set 2026): a condição `dado_velho` muda de fonte, não de existência

O **estado** fica: a mesa tem de saber dizer «não consigo ver o mundo agora», e com a vista tapada não abre
risco novo (e continua a defender). O que sai é o **limiar**: quem diz que a mesa está cega é o **estado da
ligação reportado pelo protocolo do conector**, não uma contagem de idade dos preços.

Razão: em varejo o instrumento fica quieto legitimamente, e silêncio de tick é indistinguível de ligação
morta. Um limiar que o dono tivesse de adivinhar seria um botão a fingir que governa a ligação.
