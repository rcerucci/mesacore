# As fichas — `fichas/<SETUP>/<PAR>-<CONTA>.json`

**O `setup` agrupa; a `CONTA` nomeia.** Sem pasta por conta: duas contas na mesma corretora são dois nomes de
ficheiro, não duas árvores. A conta é o nome do ficheiro de credencial (`config/contas/<conta>.json`), e é o
mesmo nome aqui, no nome do ficheiro e no cabeçalho.

## O nome do instrumento é **o do venue** — e é isso que dispensa o dicionário

O contrato já o diz, textual (`contracts/_defs/forma.schema.json`):

> `"instrumento"` — `"pattern": "^[A-Z0-9][A-Z0-9._/-]{1,31}$"` — **«Símbolo do instrumento, como o venue o
> escreve.»**

Medido, e é isto que faz a regra valer: **nada no sistema traduz nomes de instrumentos.**

- a sonda copia o universo do venue **«a forma crua, sem traduzir»** (`brokers/hyperliquid/sonda.ts`, tipo
  `LinhaDoUniverso`);
- o conector **compara** o que o venue devolve com o nome da ficha, tal e qual (`historico.ts`:
  `if (coin !== pedido.instrumento) continue`), e chama a API com esse nome (`l2Book({ coin })`,
  `candleSnapshot({ coin, … })`);
- o ficheiro das velas (`velas-<INSTRUMENTO>-<RELOGIO>.jsonl`), as chaves da config da mesa, o registo e o
  `--par` do operador: todos usam o nome **verbatim**.

Logo, o valor certo é o que **cada venue** escreve — e é o venue que decide, ficha a ficha:

| venue | o que ele publica | o que a ficha tem de dizer |
|---|---|---|
| hyperliquid (perpétuos) | o nome da moeda, sozinho — medido nos fixtures do universo: `BTC`, `ETH`, `MATIC`; e a corrida de 30/09 leu livro, velas e equity com `coin: "SOL"` | **`SOL`** (é o nome dele) |
| venue que escreve o par inteiro (p.ex. Binance/cTrader-style) | `SOLUSDC`, `SOLUSD`, … | **o que ele escrever** — `SOLUSDC` se for assim |

Um nome errado **não é traduzido em silêncio**: a porta `sonda_e_manifesto` do arranque recusa, porque o venue
não publica esse instrumento. Sem conector para a corretora, o nome da ficha é uma **assunção** — e é isso que o
`tools/verificar-setup/fichas.py` reporta a cada corrida do portão, com o nome dela ao lado.

## As três regras de identidade — o operador RECUSA se não baterem

Medidas em `vigia/operador.ts` (função `lerFichasDaConta`), e não são gosto:

1. o ficheiro tem de se chamar **`<instrumento>-<conta>.json`**, com o `instrumento` e a `conta` **do cabeçalho**
   (não do olho de quem o nomeou);
2. a **pasta** tem de ser igual ao `cabecalho.setup` (a pasta diz `sigma`, o cabeçalho diz `sigma`);
3. `setups/<setup>/setup.json` tem de **existir** — a ficha aponta para um plugin que está lá.

**O cabeçalho é a verdade; o nome é para o olho.** Um ficheiro renomeado passaria a mentir em silêncio, e é por
isso que aqui se recusa em vez de se adivinhar.

## O cabeçalho — o que QUALQUER setup tem de preencher

Dez chaves, e cada uma com quem a lê (medido a 30/09/2026, `grep cabecalho.<chave>` no produto):

| chave | tipo | quem lê | deixa correr sem ela? |
|---|---|---|---|
| `conta` | texto | operador — e tem de bater com o nome do ficheiro | **não** (recusa) |
| `instrumento` | texto | operador; é o nome que o **venue** conhece (com ele se lê o livro e se manda a ordem) | **não** (recusa) |
| `setup` | texto | operador; tem de bater com a pasta | **não** (recusa) |
| `relogio` | texto (`"1h"`, `"30m"`, …) | operador → vai na operação; é ele que define a **barra** | **não** (recusa) |
| `run` | booleano | operador (`run === true`); só as fichas ligadas se calculam | **não** (recusa) |
| `enviar` | booleano | operador — **o interruptor**: `false` = a boleta fica no registo | **não** (recusa) |
| `saldo_pct` | **texto** decimal (D4: o número viaja em texto) | operador → config da mesa → banda e contenda | a mesa recusa |
| `alavancagem` | **texto** decimal (D4) | operador → config da mesa → banda | a mesa recusa |
| `bandas` | objecto: `saldo_pct`, `alavancagem`, `stop_pct`, `tp_pct`, cada um `{ "minimo": texto, "maximo": texto }` | a mesa (`core/ciclo/banda.ts`), a conferir o que o setup pede antes de a boleta sair | a mesa recusa |
| `prazo_de_resposta_ms` | inteiro > 0 | a mesa (`core/servidor.ts`), o prazo do dono | a mesa recusa |

E, ao lado do cabeçalho, **`constantes`**: as constantes do indicador. **É a única parte que vai ao setup** —
com o `relogio` e o instrumento. O `saldo_pct`, a `alavancagem` e as `bandas` **nunca** passam por lá (RN-M4.1).

### O cabeçalho, escrito

```json
{
  "cabecalho": {
    "conta": "hl-teste-plugin",
    "instrumento": "SOL",
    "setup": "sigma",
    "relogio": "1h",
    "run": true,
    "enviar": false,
    "saldo_pct": "10",
    "alavancagem": "1",
    "bandas": {
      "saldo_pct": { "minimo": "0.5", "maximo": "20" },
      "alavancagem": { "minimo": "1", "maximo": "3" },
      "stop_pct": { "minimo": "0.1", "maximo": "5" },
      "tp_pct": { "minimo": "0.1", "maximo": "10" }
    },
    "prazo_de_resposta_ms": 5000
  },
  "constantes": { "…": "as do indicador, da ficha do par" }
}
```

`run` e `enviar` são as duas chaves que parecem iguais e não são: **`run` decide se o par é calculado;
`enviar` decide se o que ele propõe chega ao venue.** Um par pode estar ligado (`run: true`) e não enviar
(`enviar: false`) — é assim que se observa sem mexer em dinheiro.

## As chaves que andam por aí e NINGUÉM lê (medido a 30/09/2026)

O critério é o do próprio inventário: **chave que ninguém lê é lixo; valor lido sem chave é defeito.**

| chave | quem é o dono a sério |
|---|---|
| `corretora` | a conta — `config/contas/<conta>.json` → `conta.corretora` (a mesa lê no arranque, RN-M1) |
| `ambiente` | a conta — `conexao.ambiente` (`teste` \| `producao`) |
| `endereco` | a conta — `conta.identificador` |
| `nome_do_par` | **ninguém** (nasceu numa ficha, sozinha) |

Estas quatro eram cópias do que a conta já diz — e uma cópia pode **mentir**: muda-se a corretora na conta e a
ficha continua a dizer a antiga. Pior: nas fichas de produção o `endereco` é o **texto** `0x<ENDERECO DA CONTA>`,
um lugar vazio à espera de ser preenchido por alguém que nunca vai ser lido.

> **NOTA DATADA — 30/09/2026: `ao_desligar` promete comportamento que ninguém cumpre.** A nota antiga deste
> ficheiro dizia «`ao_desligar` — `fechar`: par desligado com posição viva ⇒ o setup propõe `caixa`». Medido:
> **nenhum código lê `ao_desligar`** (o único `caixa` do produto é o da liquidação no encerramento,
> `core/servidor.ts`), e uma ficha com `run: false` **nunca é corrida** — o operador só carrega as ligadas
> (`todas.filter(f => f.cabecalho.run === true)`). Ou seja: hoje, desligar um par deixa a posição viva **aberta,
> sem quem a feche**. Está por decidir: implementar o fecho ao desligar, ou retirar a chave e a promessa.
> *(O texto antigo, mantido por baixo — o registo é auditável: «`ao_desligar` — `fechar` (decisão do dono): par
> desligado com posição viva ⇒ o setup propõe `caixa`.»)*

## O que está aqui

| ficheiro | conta | instrumento | `run` | `enviar` |
|---|---|---|---|---|
| `sigma/SOL-hl-teste-plugin.json` | `hl-teste-plugin` (hyperliquid, **teste**) | SOL | `true` | `false` |
| `sigma/BTC-hl-teste-plugin.json` | `hl-teste-plugin` (hyperliquid, teste) | BTC | `false` | `false` |
| `sigma/SOL-hl-real-sol.json` | `hl-real-sol` (hyperliquid, produção) | SOL | `true` | `false` |
| `sigma/SOL-hl-real-sol-2.json` | `hl-real-sol-2` (hyperliquid, produção) | SOL | `false` | `false` |
| `sigma/SOL-ctrader-real-sol.json` | `ctrader-real-sol` (ctrader — **sem conector**) | SOL | `false` | `false` |
