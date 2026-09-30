
---

> **NOTA DATADA — 30/09/2026: os exemplos deste documento são HISTÓRICOS.** Os dois setups de exemplo que ele
> usava (`cruzamento_de_media`, em TypeScript e Python) foram retirados do repositório a pedido do dono; o único
> setup que existe é `setups/sigma/`. Duas consequências para quem lê isto a escrever um setup novo:
> (1) onde os exemplos dizem `"nome":"cruzamento_de_media"`, leia-se **o nome do próprio setup** — a forma é
> `^[a-z][a-z0-9_]{1,31}$` (`contracts/_defs/forma.schema.json`); (2) **a versão do contrato nos exemplos não se
> copia**: era `1.7.0` escrito à mão, e uma versão escrita à mão envelhece sozinha e cala o plugin em operação
> (medido: um plugin MUDO por `versao_do_contrato_divergente`). A versão vigente lê-se de
> `contracts/versao.json` (`versaoVigente()` em `contracts/esqueleto/framing.ts`), nunca se escreve.

## NOTA DATADA — 30/09/2026: o RELÓGIO é da ficha de parâmetros do par (correcção do dono)

**O que estava errado no texto abaixo:** dava a entender que o intervalo das velas era uma escolha do setup
(o `mercado.intervalo` do `setup.json`) e que o assistente podia propô-lo. Não é nada disso.

**O que a espec diz (e eu fui ler depois de o dono me corrigir):**

- **Ficha** — "a configuração concreta de um instrumento: **dois arquivos**, um de risco e um do setup, mais o
  nome do setup e da variante" (RN-M6). Ou seja: **uma ficha por par**, duas peças.
- **Arquivo de risco** (forma fixa do core, RN-S10): percentagem do saldo, alavancagem, distância mínima de
  liquidação, e as **bandas onde os itens do setup têm de caber**. O setup **serve-o; não o inventa**.
- **Arquivo do setup** (a forma é publicada pelo setup, RN-S3): os parâmetros de estratégia **daquele par**.
- **RN-M5**, o Setup decide "o lado e **todo o parâmetro de estratégia, pelo seu template**: stop sim/não,
  distância, **janela**, limiares, parcial, aumentos".

**Consequência prática, e é a correcção:** o **relógio (a `janela`) é um parâmetro da ficha de parâmetros, por
par** — não do assistente, não do setup, não da mesa. O mesmo setup corre em H1 no BTC e em M30 no ETH: **é o
mesmo plugin e duas fichas**, e só os parâmetros mudam. O `default` de cada item vive no **template** que o
setup publica; o **valor** vive na ficha do par.

**Sítios onde isto ficou corrigido:** `fichas/<PAR>/{risco,setup}.json` (novo — uma pasta por par, dois
arquivos, com BTC a 1h e ETH a 30m como prova de que o relógio é da ficha); `setups/<nome>/setup.json` (só o
plugin e o template — os valores saíram de lá); `vigia/operador.ts` (`--conta` para o macro da conta e `--par`
para a ficha do par; as velas são pedidas no relógio da ficha).

**Fica dito o que ainda não está feito:** o leitor de configuração do core (`core/servidor.ts --config`) ainda
lê a ficha **num objecto só** (risco+setup juntos), e a espec diz **dois arquivos**. Registei o buraco em
`specs/002-maquina-de-estados/relatorios/DEFEITOS.md` como **D-014**, em vez de o tapar com um `merge`.

*O texto abaixo é o original, mantido como registo do que eu tinha escrito antes da correcção.*

---

O QUE UM SETUP RECEBE E ENTREGA — o briefing do primeiro plugin de setup
contrato 1.7.0 · escrito 29/09/2026 · para o dono e para quem escrever o plugin

0. A PERGUNTA QUE ISTO RESPONDE
-------------------------------
Dono: «informe para construção do primeiro plugin de setup. para dados de mercado é necessário considerar o
formato mais viável ao plugin para ele realizar cálculos. um plugin pode ser ts, python, etc.»

Este documento diz o que o plugin tem de ler, o que tem de escrever, em que formato, e o que ainda falta do
nosso lado antes de ele poder correr a sério.

1. O QUE É UM SETUP, E EM QUE LÍNGUA SE ESCREVE
----------------------------------------------
Um setup é um **plugin de política**: entrega **o lado** a executar (e o seu relógio) e mais nada. Não vê
tamanho, risco, execução nem a corretora; não preenche a boleta — quem preenche é a mesa (RN-S1, RN-S9).

**A língua é livre, e é decisão da spec do próprio setup (RN-E16).** O que o prende à casa não é a linguagem: é
**a mensagem do contrato** — ele declara a versão que fala (RN-E18) e valida contra os esquemas de
`contracts/`. Um setup em Python fala exactamente o mesmo que um em TypeScript.

**O nome tem forma, e a forma não admite hífen.** Medido em `contracts/_defs/forma.schema.json`:
`nome_de_plugin` = `^[a-z][a-z0-9_]{1,31}$` (minúsculas, underscore). Consequência: o directório de exemplo que
já existe aqui, `setups/exemplo-cruzamento-de-media/`, **violaria o contrato do próprio repositório** — o
primeiro plugin a sério tem de se chamar, por exemplo, `cruzamento_de_media` (e o exemplo, quando for usado a
sério, muda de nome). Isto é medido, não é gosto.

Directório: `setups/<nome>/` — com o **template de configuração** (um item por parâmetro: nome, tipo, unidade,
omissão, significado) e o `questionario.json` (o exemplo do repositório serve de molde). Variante do mesmo
plugin é **ficha**, não plugin novo (RN-S5).

2. O QUE O PLUGIN RECEBE — METADE 1: A LEITURA (o ficheiro de operação)
----------------------------------------------------------------------
A mesa não lê o venue; lê o **ficheiro de operação** (`core/servidor.ts --operacao f.json`), campo
`instrumentos.<instrumento>.leitura`, na forma do contrato (`mercado`):

```
instrumento · tempo_do_venue_ms · idade_do_dado_ms · estado ("aberto"|"fechado") · equity (texto)
bid? · ask? · ultimo?                      (texto, opcionais: o que o venue publicou)
posicao? { lado, unidades, preco_medio, marca_de_posse }
```

Não há número de corretora nenhum aqui: quantidade, lote, preço absoluto, pontos, tick e tamanho de contrato
são proibidos nestas mensagens (`contracts/vocabulario.json`, `campos_em_unidade_de_corretora`) — quem os
manuseia é o conector.

**ATENÇÃO, e é honesto dizê-lo:** em produção **ninguém escreve ainda este ficheiro**. Medido: o vigia escreve
só o ficheiro das portas, o servidor não escreve nada, e o único produtor é a bancada. Está em cartão
(`t_2ccdde89`) com desenho e critério de aceite, e é o **portão** do primeiro setup.

3. O QUE O PLUGIN RECEBE — METADE 2: OS DADOS DE MERCADO
-------------------------------------------------------
O formato foi fixado por medição e por esta pergunta do dono. É **JSONL**: um objecto JSON **por linha**, com
os **nomes de campo do próprio venue** e os números **em texto** (o venue publica-os assim; texto não perde
precisão quando o plugin calcula — é a regra D4 da casa, que proíbe vírgula flutuante em dinheiro).

```json
{"t":1790733600000,"T":1790737199999,"s":"BTC","i":"1h","o":"83405.0","c":"83414.0","h":"83581.0","l":"83250.0","v":"219.34953","n":5163}
```

Ao lado, um **descritor** (JSON) que diz o que está dentro sem ser preciso ler o ficheiro: instrumento,
intervalo, ambiente, janela (`desde_ms`/`ate_ms`), `quantas`, as chaves da vela, e quando se escreveu.

**Porque este formato, e não outro:** qualquer linguagem o lê na biblioteca de base (`JSON.parse` no TS,
`json.loads` no Python) — sem dependências e sem um formato que só uma língua sabe ler; **uma linha por vela é
appendável** (o colector acrescenta a vela nova a cada volta, sem reescrever o histórico); e uma linha truncada
a meio é detectável **linha a linha**, sem corromper o resto.

Como se obtém (o próprio plugin, ou um script de arranque, ou o colector a cada volta):

```
bun run brokers/hyperliquid/mercado.ts --velas BTC --intervalo 1h --dias 30 --ambiente producao --para-pasta <pasta>
bun run brokers/hyperliquid/mercado.ts --velas BTC --intervalo 1h --dias 30 --ambiente producao --para-pasta <pasta> --actualizar
```

O `--actualizar` **não duplica**: medido, `ja_tinha: 73 · novas: 0 · agora_tem: 73` em duas corridas seguidas.
Os intervalos disponíveis são os **14** do venue (`1m…1M`), lidos do SDK instalado (`--intervalos`), e um
intervalo fora deles é recusado pelo venue — não por nós.

**E o que o estudo tem de saber, medido:** a TESTE responde nos mesmos instantes que a produção, com preços na
mesma forma, mas o **volume não é real** (`0.40` na TESTE contra `630` na produção, na mesma hora). Para forma
de preço serve; para volume, não.

4. O QUE O PLUGIN ENTREGA — A PROPOSTA
--------------------------------------
Uma linha JSON no `stdout`, o envelope do contrato:

```json
{"contrato":"1.7.0","tipo":"proposta","id":"<opaco>","carga":{"setup":{"nome":"cruzamento_de_media","versao":"0.1.0"},"lado":"buy"}}
```

`lado` tem **exactamente quatro** valores (RN-T4), e a diferença entre eles governa tudo:

| valor | o que a mesa faz |
|---|---|
| `buy` | abre comprado (a mesa compõe a boleta; o plugin não vê tamanho nem preço) |
| `sell` | abre vendido |
| `hold` | não faz nada — e **regista** que a proposta não tinha lado a executar |
| `caixa` | fecha a posição em `reduce_only` (nunca inverte) |

**A virada de mão não existe no vocabulário, e não é preciso:** faz-se com **dois passos** — `caixa` (fecha) e
depois o lado inverso. É assim que funciona nos dois modelos de posição (netting e hedge), e a bateria prova-o
ao vivo (`buy → sell/ro → sell → buy/ro`, com o sinal a inverter).

`relogio` (opcional) é o relógio do próprio setup — a barra que ele considera fechada. Sem ele, vale o da mesa.

5. O QUE O PLUGIN **NÃO** FAZ
-----------------------------
- não calcula quantidade, margem, alavancagem efectiva nem preço de liquidação — **lê-os** da resolução;
- não escolhe a corretora, o tamanho, nem a política de risco (isso é do mandato do dono e da ficha);
- não importa o `core` (RN-E1) — fala o contrato e mais nada;
- não manda nada ao venue: **a mesa decide, o conector transporta**;
- não guarda segredo nenhum. O estado que ele guardar é dele, com namespace e versão
  (`estado/<setup>/<versão>/<instrumento>`, RN-S6).

6. DOIS EXEMPLOS MÍNIMOS (o mesmo plugin, nas duas línguas que o dono nomeou)
----------------------------------------------------------------------------
**TypeScript**

```ts
const velas = (await Bun.file("velas-BTC-1h.jsonl").text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const fecho = (n: number) => velas.slice(-n).reduce((s, v) => s + Number(v.c), 0) / n;
const lado = fecho(5) > fecho(20) ? "buy" : "sell";
console.log(JSON.stringify({ contrato: "1.7.0", tipo: "proposta", id: `c${Date.now()}`, carga: { setup: { nome: "cruzamento_de_media", versao: "0.1.0" }, lado } }));
```

**Python**

```python
import json, time
from decimal import Decimal
velas = [json.loads(l) for l in open("velas-BTC-1h.jsonl") if l.strip()]
media = lambda n: sum(Decimal(v["c"]) for v in velas[-n:]) / n
lado = "buy" if media(5) > media(20) else "sell"
print(json.dumps({"contrato": "1.7.0", "tipo": "proposta", "id": f"c{int(time.time()*1000)}",
                  "carga": {"setup": {"nome": "cruzamento_de_media", "versao": "0.1.0"}, "lado": lado}}))
```

**Ambos foram exercitados contra os ficheiros reais, e dão os MESMOS números** — é a prova de que o formato
serve a língua que o dono escolher:

```
Python  velas lidas: 73 · media 5: 83484.6 · media 20: 83664.4   (Decimal sobre o TEXTO da vela)
TS      velas: 73 · media 5: 83484.6 · media 20: 83664.4         (proposta: {"lado":"sell"}, 5 < 20)
```

O formato serve o cálculo, e não o contrário.

7. O QUE AINDA FALTA DO NOSSO LADO (para o plugin poder correr a sério)
-----------------------------------------------------------------------
1. **A ligação do mercado** (`t_2ccdde89`) — quem escreve o ficheiro de operação a cada volta, e o vigia a
   arrancar o conector **real** em vez do dublê (falta o registo de plugins). É o portão.
2. **O registo de plugins** no vigia — hoje o mapa nome → processo aponta para `contracts/mocks/conector/main.py`.
   Um setup em Python entra no mesmo mapa, e é essa a peça que o torna um plugin de verdade.
3. **SL/TP** (`t_e802e344`) — o primeiro setup não usa stop; quando usar, há o cartão (com o mapa de posse e o
   cancelamento como pré-requisitos, e o OCO a confirmar).
4. **A forma de velas no contrato** — hoje o ficheiro de mercado é dado do venue com os nomes do venue; não há
   esquema no contrato para velas. Se as velas tiverem de atravessar a fronteira num envelope do contrato, é
   uma emenda aditiva (e decide-se quando o segundo consumidor existir, não antes).
5. **O estado do setup persistido** (RN-S6) — o esquema tem forma declarada; o sítio onde ele vive em operação
   é o mesmo trabalho da ligação.
