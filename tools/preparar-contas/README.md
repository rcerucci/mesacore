# preparar-contas — a entrevista que escreve a configuração de uma conta

Uma conta nova fica configurada em dois minutos, sempre igual, e **sem nenhum valor de chave no
repositório**. O script pergunta; quem responde é quem sabe — você para o que é seu, o plugin para o que
é do venue.

```sh
sh tools/preparar-contas/preparar-contas.sh
```

## Dois fluxos, e a fronteira entre eles

| Fluxo | Quem cria | Pergunta | Escreve em |
|---|---|---|---|
| **Conta** (`escreve_em: conta`) | o questionário do **conector** | a conta no venue: endereço master, ambiente, URL, credencial, a chave (segredo) + a macro da conta | `config/contas/<nome>.json` |
| **Ficha** (`escreve_em: ficha`) | o questionário do **setup**, um instrumento de cada vez | em que conta, que instrumento, e **só** os parâmetros **daquele** instrumento | a `fichas.<instrumento>` dessa conta, **preservando o resto** |

**Nada que o venue responda por pedido se pergunta ao dono.** A lista de instrumentos não está em questionário
nenhum: a sonda lê `meta.universe` no venue e publica-a no **manifesto** (`brokers/<corretora>/.manifesto.json`,
de runtime). O fluxo da ficha vai buscá-la lá; sem manifesto, cai para uma **restrição** declarada na conta
(`conta.instrumentos`, opcional — o que a conta *aceita* operar, nunca o que vai operar); e sem nenhum dos dois,
**recusa** em vez de inventar. `--manifesto <ficheiro>` aponta a outro manifesto (é o que a bateria usa).

**O conector sobe sem ficha nenhuma.** Ele configura a conta; o stop de 5% no BTC e o de 8% no ETH são
**fichas de instrumento**, e entram pelo fluxo do setup, uma a uma. Conta sem ficha é um estado legítimo —
o conferidor dá-o como **aviso**, nunca como recusa.

O fluxo da ficha **não cria contas**: se a conta não existir, ele **recusa** e diz que se corre primeiro o
questionário do conector. E o instrumento escolhido tem de estar em `conta.instrumentos` — o que a conta
**aceita** operar, não o que já opera.

### Risco do instrumento: forma do core, não do setup

As perguntas de risco de uma ficha (saldo %, alavancagem, stop, tp, desvio, prazo da passiva, versão do
mandato, prazo de resposta) são **forma do core** e vivem em `perguntas-do-risco.json`. Um setup não as
repete: pede-as com

```json
"incluir": ["risco_do_instrumento"]
```

e acrescenta as suas por cima (as médias, o lado, o que for). E o que o plugin sabe sozinho — a versão do
setup, as bandas que ele aceita — vai em `preenche_sempre`, **sem perguntar ao dono**:

```json
"preenche_sempre": {
  "fichas.<instrumento>.setup.versao_do_setup": "0.1.0",
  "fichas.<instrumento>.risco.bandas": {
    "saldo_pct": { "minimo": "0.1", "maximo": "10" },
    "stop_pct":  { "minimo": "0.2", "maximo": "20" }
  }
}
```

Um exemplo completo e comentado está em `setups/exemplo-cruzamento-de-media/questionario.json`.

## O script não sabe nada de nenhum venue

Ele lê os **questionários que os plugins publicam**:

```
brokers/*/questionario.json     (conectores)
setups/*/questionario.json      (setups de estratégia — quando existirem)
```

Pergunta **qual deles** vai ser configurado, segue aquele fluxo, e no fim manda o ficheiro ao
**conferidor** (`tools/verificar-config/conferir-config.ts`) — que é quem julga. **O script não decide se
está bom.** Se um plugin não publicar questionário, nenhum é improvisado: a lista é medida por comando,
não adivinhada.

Acrescentar um venue = acrescentar um ficheiro. Nunca se toca no script.

## Como se lê o resultado

```
Questionarios publicados pelos plugins:
  1) brokers/hyperliquid/questionario.json  [conector]
Qual deles vai ser configurado? (numero) 1

── Que nome quer dar a esta conta? (vira config/contas/<nome>.json e a chave em ~/.config/mesacore/credenciais/<nome>.key)
── Qual o ENDERECO (master) da conta na Hyperliquid?
   E o endereco 0x... da conta que opera, nao o da API wallet. ...
   resposta: 0x1111...
   ...
   chave gravada em /home/cerucci/.config/mesacore/credenciais/hl-teste-a.key (modo 600)

configuracao escrita: config/contas/hl-teste-a.json

── o conferidor julga (o script nao decide se esta bom):
conferidor: aprovado — 0 recusa(s), 0 aviso(s) · fichas: BTC
```

## As quatro regras que ele garante

| Regra | Porquê |
|---|---|
| **O JSON é escrito pelo `jq`**, nunca por concatenação de texto | um `"` ou um `$( )` num valor partiria o ficheiro — e a falha seria silenciosa |
| **A escrita é atómica** (`mktemp` + `mv`, `umask 077`) | nunca existe um ficheiro de conta a meio, nem com modo frouxo desde o primeiro byte |
| **Um campo de tipo `segredo` nunca entra no ficheiro** | vai para `$CREDENCIAIS/<conta>.key` com modo **600** (pasta 700), lido com `read -rs` para não passar pelo histórico do shell; na configuração fica só a **referência** (`ficheiro:…`) |
| **Questionário com segredo sem destino de credencial é recusado** | é esta regra que impede alguém escrever «cole a chave aqui» e a chave acabar num `git add -A` |

E o ficheiro de respostas (`--respostas`) **não pode viver dentro do repositório** — o script recusa-o:
ele pode conter um segredo.

## Formato do questionário

É um ficheiro de dados que o plugin publica. A conta de exemplo fica em
`brokers/hyperliquid/questionario.json`.

```jsonc
{
  "plugin": "hyperliquid",
  "tipo": "conector",
  "versao_do_questionario": "1.0.0",
  "conta_de_exemplo": "hl-teste-a",
  "preenche_sempre": {                  // verdade do PLUGIN, não pergunta ao dono
    "conta.corretora": "hyperliquid",
    "conta.conectores": ["hyperliquid"]
  },
  "perguntas": [
    {
      "id": "identificador",            // a chave nas respostas (id@instrumento, com mais de um)
      "chave": "conta.identificador",   // o caminho no ficheiro de conta (setpath do jq)
      "tipo": "texto",                  // texto | decimal | inteiro | lista | enum | segredo | objeto
      "obrigatorio": true,
      "opcional": false,
      "pergunta": "Qual o ENDERECO (master) da conta na Hyperliquid?",
      "explicacao": "E o endereco 0x... da conta que opera, nao o da API wallet. ...",
      "omissao": "hl-teste-a",
      "opcoes": ["teste", "producao"],
      "destino": "ficheiro_de_credencial"   // OBRIGATORIO em tipo=segredo
    }
  ],
  "ficha_do_instrumento": {
    "nota": "Estas perguntas repetem-se por instrumento. <instrumento> e substituido pelo nome.",
    "perguntas": [
      { "id": "saldo_pct", "chave": "fichas.<instrumento>.risco.saldo_pct", "tipo": "decimal", "obrigatorio": true, "pergunta": "…", "explicacao": "…" }
    ]
  }
}
```

- `decimal` e `inteiro` são gravados como **texto**, com a forma do contrato (sem expoente, sem `null`) —
  é o conferidor que o exige.
- Uma pergunta `opcional` sem resposta significa «não declaro», e o campo fica **ausente** (não `null`).
  O `null` é RECUSA; a ausência, num campo opcional, é uma decisão legítima.
- As bandas (`risco.bandas.*`) ainda não são perguntadas: são opcionais e o conferidor só as julga se
  existirem. Quem as quiser, escreve-as à mão no ficheiro — e o conferidor confere se contêm o valor.

## Modo sem perguntas

Para uma segunda conta, para uma máquina nova, ou para a bateria:

```sh
sh tools/preparar-contas/preparar-contas.sh --sem-perguntas --respostas r.json \
  --config-dir config/contas --credenciais ~/.config/mesacore/credenciais
```

`r.json` é um mapa `id → valor` (mais `_questionario` e, com mais de um instrumento, `id@BTC`).

## Editar uma configuração que já existe

Três caminhos, do mais guiado ao mais directo. **Nenhum deles apaga o resto do ficheiro**: a gravação
parte sempre do que já lá está (uma conta nova é a única que começa de zero).

**0. Não sabe o nome?** Sem valor, `--conta` **lista as contas que existem** e deixa escolher pelo número; a
pergunta do nome, no fluxo normal, também já mostra a lista. Sem perguntas (`--respostas`), ele não adivinha:
**recusa** e diz os nomes existentes, para um guião saber as opções.

```sh
sh tools/preparar-contas/preparar-contas.sh --conta     # lista, e pergunta qual
```

**1. Entrevista sobre a conta existente** — mostra os valores actuais como omissão; `Enter` mantém, escrever
substitui:

```sh
sh tools/preparar-contas/preparar-contas.sh --conta config/contas/hl-teste-plugin.json
```

**2. Sem perguntas, mudando só o que quer** — um ficheiro de respostas com as chaves a mudar e mais nada.
**Não precisa da chave**: a referência (`conexao.credencial.valor_em`) é preservada, e o valor continua onde
estava:

```sh
cat > /tmp/editar.json <<'EOF'
{ "_questionario": "brokers/hyperliquid/questionario.json", "perda_maxima_pct": "10" }
EOF
sh tools/preparar-contas/preparar-contas.sh --sem-perguntas --respostas /tmp/editar.json \
  --conta config/contas/hl-teste-plugin.json
```

**3. Um `jq` à mão** (o ficheiro é JSON simples e **não tem nenhum valor de chave**), com o conferidor a
julgar logo a seguir:

```sh
tmp=$(mktemp) && jq '.conta.perda_maxima_pct = "10"' config/contas/hl-teste-plugin.json > "$tmp" \
  && mv "$tmp" config/contas/hl-teste-plugin.json
bun tools/verificar-config/conferir-config.ts config/contas/hl-teste-plugin.json
```

E para **acrescentar um instrumento** (uma ficha só daquele instrumento), é o fluxo do setup:

```sh
sh tools/preparar-contas/preparar-contas.sh --respostas /tmp/ficha.json --sem-perguntas
# _questionario: setups/<setup>/questionario.json · conta_alvo: hl-teste-plugin · instrumento: ETH
```

## Opções

```
--raiz DIR          raiz do repositorio (omissao: a que contem este script)
--config-dir DIR    onde escrever a configuracao (omissao: config/contas)
--credenciais DIR   onde guardar as chaves (omissao: ~/.config/mesacore/credenciais)
--conta FICHEIRO    refazer uma conta existente (mostra os valores actuais como omissao)
--respostas FICHEIRO  respostas pre-gravadas; implica --sem-perguntas
--sem-perguntas     nao pergunta nada
```

## A bateria

```sh
sh tools/preparar-contas/provas.sh
```

Corre sem rede, contra um directorio temporário, e prova cinco coisas: (1) o ficheiro produzido **passa
no conferidor**; (2) a chave fica **fora do repositório** com modo **600**; (3) a configuração traz a
**referência** e o valor **não aparece** nela nem em ficheiro versionado nenhum; (4) um questionário com
segredo sem destino é **recusado**; (5) **responder só com Enter** aplica as omissões declaradas no
questionário e produz um ficheiro válido — o prompt promete «Enter aceita …», logo a omissão tem de valer
como resposta (foi um defeito real, apanhado em campo: o script só olhava para uma conta já existente).

Nos textos do questionário, `{{conta}}` é substituído pelo nome da conta — é assim que a credencial assume
o nome da conta sem ninguém o escrever duas vezes. Nenhum segredo real entra na bateria: a «chave» de prova é uma string
inventada.

## O que ainda não existe

- `config/contas/` está vazio de conteúdo: nenhuma conta está configurada ainda. Este script existe
  exactamente para isso.
- O **conector real** ainda não corre: o questionário configura a conta, mas quem usa a configuração
  (o corpo do conector, T010 em diante) ainda está por construir.
- `setups/*/questionario.json` ainda não existe — nenhum setup foi escrito.
