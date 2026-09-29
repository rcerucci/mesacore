# Data Model — recorte 003 (o vigia, a mesa e os dublês)

As entidades **novas** (e o que muda nas que já existiam). As entidades do recorte 002 — marcas, sessão,
inibição do CB, desconhecido, transições — ficam como estão.

## 1. Vigia (processo)

| Campo | Tipo | Notas |
|---|---|---|
| `verbos` | conjunto fechado de 5 | `start`, `pause`, `stop`, `reset`, `nova_sessao` — nenhum outro (RN-V1) |
| `registro` | caminho do ficheiro do runtime | `.vigia.json`, escrita atómica |
| `conectores` | lista de nomes | os que a configuração da mesa nomeia; o vigia **arranca-os** (RN-E21, FR-005) |
| `mesa` | nome/caminho do processo | o vigia arranca e para a mesa |

**Invariantes:** não lê estratégia, mercado nem ledger; **não valida** mandato nem substitui o porteiro
(RN-V5); **não reinterpreta** a recusa que vem da mesa — a recusa **é** o resultado.

## 2. Comando (mensagem)

| Campo | Tipo | Notas |
|---|---|---|
| envelope | versão (`1.2.0`), `tipo=comando`, `pedido_id` (correlação) | a versão é comparada por igualdade exacta |
| `verbo` | texto, do conjunto de 5 | obrigatório |
| `autor` | texto | obrigatório — sem autor não se audita |
| `motivo` | texto, só no `nova_sessao` | obrigatório nesse verbo |

**Validação (a que já existe, re-alojada):** campo a mais → `comando_com_campo_a_mais`; falta de verbo, autor
ou `pedido_id` → `comando_incompleto`; tipo errado → `comando_com_tipo_invalido`; verbo fora do conjunto →
`verbo_desconhecido`.

## 3. RespostaDeComando (mensagem)

| Campo | Tipo | Notas |
|---|---|---|
| envelope | versão, `tipo=resposta_de_comando`, `pedido_id` | a **mesma** correlação do comando |
| `aceito` | booleano | recusa não é erro de protocolo: é resposta |
| `motivo` | nome do conjunto fechado | quando recusado (R7) |
| `efeito` | nome do conjunto fechado | quando aceito (R7) |
| `transicao` | `{de, para}` | estado anterior e posterior (RN-V4) |
| `instante` | inteiro (ms) | o relógio é o **da mesa** (RN-M4.9) |

## 4. PerguntaDoEncerramento e DecisaoDoEncerramento (mensagens)

`pergunta_do_encerramento`: `{resumo, opcoes: ["fechar_a_mercado","manter"], prazo_de_resposta_ms,
aviso_de_manter}` — o resumo traz **números da corretora** (RN-V8) e o aviso de manter é **campo**, não nota de
rodapé (é a decisão do recorte 002 que fica).

`decisao_do_encerramento`: `{pedido_id, resposta}` — a decisão do dono, identificada pela pergunta que a
pediu; **não** é um verbo (R5).

## 5. TransicaoDoVigia (linha do `.vigia.json`)

`{instante, verbo, autor, pedido_id, de, para, motivo}` — é o registro que torna o vigia auditável por leitura
(RN-V4). Ficheiro do runtime, escrita atómica, retenção **própria** (não é o ledger).

## 6. DubleDeMesa

| Campo | Tipo | Notas |
|---|---|---|
| `casos` | ficheiro de dado | `*.casos.json` — o caso é dado, nunca `if` |
| entradas | `mercado`, `boleta` | o que o dublê entrega a um setup / a um conector |
| conferências | `proposta`, `desfecho` | o que ele confere contra o declarado |
| modo adversário | recusa, atraso, silêncio, fora da banda | o que dá valor ao dublê |

**Invariante:** escrito do **contrato** (esquemas), em linguagem que **não** a do core, sem importar `core/`
(RN-E17, RN-E24).

## 7. O que muda nas entidades existentes

- **Motivos da mesa** (`core/estados/motivos.json`): o conjunto continua fechado, e passa a ter um **espelho
  parcial** no vocabulário do contrato (20 dos 42 — R7), com a conferência nas duas direcções **e o âmbito
  declarado**.
- **Marcas** (`.marcas.json`): inalteradas; e passam a coexistir com o `.vigia.json`, que é **outro** ficheiro
  e **outro** dono de escrita.
- **Ledger**: inalterado nos tipos de linha; ganha a chave da conta no dia em que houver mais de uma conta
  (RN-L7), não neste recorte.
