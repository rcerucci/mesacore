# Phase 1 — Interface: o seam e as regras de forma

As mensagens (corpos, campos, regras) estão em [../data-model.md](../data-model.md). Aqui está **como
elas atravessam** a fronteira, **quem pode ver o quê** e o que o contrato deliberadamente **não** tem.

## As duas fronteiras

```
        ┌─────────────┐   mercado (factos)   ┌────────┐   proposta   ┌──────┐
        │   mesa      │ ───────────────────▶ │ setup  │ ───────────▶ │ mesa │
        │  (core)     │                      └────────┘              └──────┘
        └─────┬───────┘
              │  boleta            ┌───────────┐   resolução + desfecho
              └──────────────────▶ │ conector  │ ─────────────────────────▶ mesa
                                   └─────┬─────┘
                                         │  (define a sua própria ligação)
                                         ▼
                                    corretora
```

- **mesa ↔ setup**: a mesa entrega o objecto de mercado; o setup responde com a proposta.
- **mesa ↔ conector**: a mesa entrega a boleta; o conector devolve a **resolução antes de executar** e,
  depois, o **desfecho**. O manifesto é pedido **no arranque** e guardado em memória (nunca em ficheiro
  de config).

## O seam: processo + uma mensagem por linha

- Cada plugin é um **processo** levantado pela mesa; a conversa é **texto JSON, uma mensagem por linha**
  (UTF-8, uma linha = um envelope completo, sem quebras internas).
- A conversa é **pedido → resposta**, uma de cada vez, com **prazo declarado** por troca.
- O prazo estourado **não é excepção**: é estado. Setup silencioso → `congelada` (RN-S8). Conector
  silencioso → desfecho `desconhecido` (RN-T7.1). No contrato **não existe** campo para espera infinita.
- Não há porta, socket, daemon, TLS nem segredo no contrato. Uma ligação e uma chave por processo
  (RN-E3): a credencial vive no **ambiente do processo da ponta**, e o contrato transporta apenas o
  **nome de referência** (RN-E14).

### Porquê

Porque é o seam mais pobre que ainda funciona entre linguagens diferentes, e porque o host **não tem**
runtime de container (constituição). Menos peças significa menos sítios onde uma falha se esconde — e é
testável à mão, com um `echo`.

## Regras de forma (valem para toda mensagem)

| Regra | Consequência |
|---|---|
| **Fechado** | objecto que traga um campo que o contrato não declara é **recusado**, com motivo normalizado |
| **Decimal textual** | sem expoente, sem `+`, sem `1.`; comparação por valor; **registado como chegou** |
| **Sem `null`** | ausência é a chave que não está lá — nunca um valor neutro, nunca uma ambiguidade |
| **Versão conferida** | igualdade exacta, verificada **antes** de qualquer envio |
| **Motivo normalizado** | toda recusa traz um identificador do vocabulário, não texto livre |
| **Unidades neutras** | fora da resolução e do desfecho, nada em unidade de corretora |

## Quem pode ver o quê

| Ponta | Vê | **Nunca** vê |
|---|---|---|
| **setup** | o objecto de factos (mercado, posição, equity, idade do dado) | tamanho, risco, execução, a corretora, a boleta |
| **mesa** | tudo o que está nas mensagens e no config | a linguagem do plugin, o protocolo do venue, o estado privado do setup |
| **conector** | a boleta (unidades neutras) e as suas próprias credenciais | a estratégia, o config da ficha, o mandato |
| **humano** | o mesmo objecto que o setup, mais o registo | — |

## O que o contrato **não** tem (e porquê)

| Não tem | Porque |
|---|---|
| framework de RPC, geração de clientes, esquema binário | "o que a regra não nomeia não entra" (Princípio VIII); um seam de texto resolve |
| estado persistido de posição | a posse lê-se do venue, pela marca (RN-T16.1) |
| credenciais, tokens ou segredos | RN-E14 — só referências |
| números ajustáveis embutidos | RN-A1 — a forma viaja, o valor vem do config |
| quantidade, lote, ponto, tick, preço absoluto **na boleta** | RN-B0 — isso é da resolução |
| campo para a mesa recalcular resultado | RN-D6 — o trilho do dinheiro é da corretora |

## Os mocks (e o que cada um prova)

| Mock | Linguagem | Exerce |
|---|---|---|
| `contracts/mocks/setup/` | **TypeScript** | as quatro respostas e os inválidos de propósito (`limpar`, vazio, número); o relógio; a ausência declarada |
| `contracts/mocks/conector/` | **Python** | a tradução, a recusa por mínimo do instrumento, os quatro desfechos, o desconhecido por silêncio, a marca e a sua forma |

O mock de conector está noutra linguagem **de propósito** (RN-E17): é ele que transforma "o contrato é
neutro" de intenção em medição. Ambos têm de **saber ser inválidos** — um mock que só sabe ser válido
prova metade do contrato.

## Formato do relatório da bateria (comum às duas linguagens)

Uma linha JSON por caso, para que a comparação de SC-002 seja mecânica:

```json
{"caso":"boleta/unidade-de-corretora-recusada","mensagem":"boleta","veredicto":"recusado","motivo":"campo_em_unidade_de_corretora","implementacao":"py"}
```
