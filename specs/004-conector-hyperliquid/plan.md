# Implementation Plan: O primeiro conector real — Hyperliquid, em ambiente de teste

## Summary

Construir `brokers/hyperliquid/` — o primeiro conector a sério — que fala o contrato neutro de um lado e o
venue do outro: sonda e publica o manifesto, traduz a boleta (recusando o que não cabe), devolve a resolução
antes de executar e o desfecho depois, trata o silêncio como estado, reconcilia antes de agir, e passa a
**bateria de conformidade de oito provas** no ambiente de teste do venue, com o resultado registado por versão.

## Technical Context

- **Linguagem do plugin**: **TypeScript** — decisão deste plano (RN-E16). O SDK oficial do venue é TypeScript e
  já opera uma conta a sério no outro projeto; escrever o protocolo à mão (assinatura, codificação, sockets)
  seria reconstruir uma biblioteca provada para ganhar nada.
- **Dependências**: `@nktkas/hyperliquid` (SDK oficial do venue), `viem` (assinatura) e `ajv@^8.20.0` (validação contra o contrato — a mesma linha que `core/` e `contracts/` já usam). Ambas já provadas na
  conta real no outro projeto. **Instalar pacote é fora do meu âmbito**: a instalação vai pedida ao sysadmin
  com o comando exacto e a verificação (ver «Pedido ao sysadmin», abaixo).
- **O conector importa `contracts`, NUNCA `core`** (RN-E1) — verificado por comando, como no dublê de mesa.
- **Onde corre**: processo próprio, arrancado pelo vigia (RN-E21); **uma ligação, uma chave, um processo**.
- **Ambiente**: **teste** do venue primeiro; produção é decisão declarada do dono (RN-H17).
- **Estado do dono que este recorte lê**: as chaves do inventário (`docs/inventario-de-chaves.md`) — a
  credencial entra por **referência**, e o valor vive **fora** do repositório (RN-H16, RN-E14).

## Constitution Check

| Princípio | Como este plano o cumpre |
|---|---|
| I — a inteligência é humana; o código é burro | o conector não escolhe lado, tamanho, preço nem momento (FR-024); todo o juízo fica na mesa e no dono |
| II — recusar, nunca degradar em silêncio | nada arredonda para caber: fora do passo/mínimo/intervalo é **recusa nomeada** (FR-007, FR-008) |
| III — língua neutra, dinheiro não é float | a boleta chega em unidades neutras; os números do venue voltam como os recebemos (decimal textual no contrato) |
| IV — o conector traduz, declara antes de executar, e prova | resolução antes do envio (FR-006) e a **bateria de oito provas** como aceite (FR-025) |
| V — incerteza é estado de primeira classe | `espera` e `desconhecido` são desfechos de primeira classe (FR-012, FR-013) |
| VI — o dinheiro e a posse são da corretora | posição, margem e liquidação são **lidas** do venue; resultado realizado não se reconstrói (FR-015, FR-018) |
| VII — a dependência aponta para o contrato | importa `contracts`, nunca `core` (FR-024) |
| VIII — sem prova, não está feito | cada FR tem bancada; oito SC medidos; bateria registada por versão |

**Portões:** nenhuma violação a justificar. O plano **não** cria tipo novo no contrato (R8) — se criar, é
aditivo e declarado.

## As cinco decisões deste plano

### D1 — A linguagem do plugin é TypeScript, com o SDK oficial do venue

O plugin é livre de escolher a linguagem (RN-E16) e declara a versão do contrato que fala (RN-E18). Escolhemos
TypeScript porque **a linguagem do venue, na prática, é essa** — o SDK oficial existe, é mantido, e já opera a
conta real no outro projeto. E há uma segunda razão, mais forte: o dublê de mesa e o do conector (Python) já
provam o contrato nos dois sentidos; um conector real em TypeScript **não** reduz a cobertura que existe, e
aumenta-a.

**Consequência declarada:** o repositório ganha três dependências de runtime (`@nktkas/hyperliquid`, `viem`, `ajv`). O `ajv` entrou **por medição, não por gosto**: os corredores de casos do conector importavam-no sem ele estar declarado em manifesto nenhum, servido pelo auto-install global do `bun` — enquanto a raiz não tinha manifesto, a bancada passava **por acidente** (medido em 29/09: a instalação do SDK criou `package.json`/`node_modules` na raiz, o fallback desligou, e a bateria caiu de 26/26 para 25/26).
Instalá-las é do sysadmin (abaixo), e o `bun.lock` é a prova de que a instalação é reprodutível.

### D2 — O manifesto é ficheiro do **runtime**, nunca versionado

Como o `.vigia.json` e o `.arranque.json`: versiona-se a **forma**, não o conteúdo. O manifesto é escrito no
arranque do conector e lido pela porta `conectores`/`manifesto` da mesa a cada `start` (é assim que uma
mudança de limites no venue aparece sem ninguém tocar em código). O `.gitignore` ganha a entrada, e o esquema
(`contracts/manifesto.schema.json`) garante a forma.

### D3 — A bateria de conformidade é bancada própria, e separa o que precisa de rede

`tools/verificar-conector/conformidade.sh` corre as **oito provas** e escreve o registo por versão
(`brokers/hyperliquid/conformidade/<versao>.txt`). As provas que **não** precisam do venue (tradução, recusas,
derivação da referência, forma do manifesto) correm **sempre**, offline, e entram na bateria geral
(`tools/verificar-maquina/provar.sh`) — como as outras. As que precisam do venue correm contra o **ambiente de
teste**, quando a credencial estiver disponível, e o resultado é **incompleto** se não correrem — nunca
«passou» (FR-026). Isto mantém o `provar.sh` verde sem rede e, ao mesmo tempo, mede o venue a sério quando ele
está lá.

### D4 — Os casos são em dado, e correm nos dois lados

`brokers/hyperliquid/casos/*.casos.json`, com o mesmo formato dos outros (`esperadoOk`, `motivo_esperado`): os
mesmos casos correm contra o conector real e contra o **dublê do conector** do recorte 001 — divergência é
falha (SC-008). É o padrão do SC-004 do recorte 003, e é o que impede o conector real de divergir do contrato
sem ninguém notar.

### D5 — A credencial entra por referência, e o valor vive fora

O conector recebe **o nome** da credencial (do inventário de chaves) e vai buscá-la a um local declarado na
configuração, fora do repositório. Não há valor em `/config`, no ledger, no log nem na mensagem (RN-C20,
RN-E14). Faltando a credencial, o conector **não arranca** e diz **qual** falta — nunca tenta com o que tem à
mão (FR-023).

## Pedido ao sysadmin (fora do meu âmbito)

**O que preciso**: as duas dependências de runtime do conector, instaladas no repositório `~/Projects/MesaCore`.

- **Comando**: `cd ~/Projects/MesaCore && bun add @nktkas/hyperliquid viem ajv@^8.20.0`
- **Pronto quando**: `bun.lock` tem as duas entradas e `bun -e "import('@nktkas/hyperliquid').then(m=>console.log(typeof m.InfoClient))"` imprime `function` (ou o equivalente exportado).
- **Se der errado**: nada se quebra fora do repositório; a reversão é `bun remove @nktkas/hyperliquid viem ajv` e o `git checkout bun.lock package.json`.
- **Reversão medida (29/09)**: o `git checkout bun.lock package.json` escrito aqui **não funcionava** antes de os dois ficheiros serem versionados — devolvia `rc=1 (pathspec ... did not match)`, porque na raiz eram novos. Passou a funcionar com o commit `ae33a52`; em qualquer caso a reversão limpa é `bun remove ...` e apagar `node_modules/`.
- **Porta nova**: `tools/verificar-conector/porta-das-dependencias.ts` — todo import nu do conector tem de estar declarado no manifesto da raiz, com prova negativa (`--manifesto` sem `ajv` tem de reprovar). Corre dentro da bancada do conector.
- **Nota de versão**: fixar a mesma linha que o outro projeto usa em produção (`@nktkas/hyperliquid` da mesma série), para o comportamento do venue ser o já medido.

*(Enquanto a instalação não estiver feita, as tarefas de tradução/recusas/derivação da referência — que não
precisam do SDK — correm contra o dublê e ficam provadas. Nada neste plano espera parado.)*

## Project Structure

### Documentation (this feature)

```text
specs/004-conector-hyperliquid/
├── spec.md              # 7 histórias, 28 FR, 8 SC
├── plan.md              # este ficheiro (as cinco decisões)
├── research.md          # R1–R9: o que se mediu no venue, com fonte
├── data-model.md        # manifesto, boleta, resolução, desfecho, leitura
├── contracts/           # a interface do conector (os casos e as mensagens)
├── quickstart.md        # como correr a bateria e ver o resultado
├── checklists/requirements.md
├── tasks.md
└── relatorios/          # saídas cruas + RESULTADO.md
```

### Onde o código toca

```text
brokers/hyperliquid/
├── manifesto.ts         # a sonda e a publicação (FR-001 a FR-005)
├── traducao.ts          # boleta → ordem, com recusas nomeadas (FR-006 a FR-011)
├── desfecho.ts          # normalização e reconciliação (FR-012 a FR-015)
├── leituras.ts          # posição, equity, marcas, os cinco números (FR-016 a FR-018)
├── ligacao.ts           # uma ligação, uma chave, estado por protocolo (FR-019 a FR-023)
├── processos.ts         # a porta de processo (o vigia arranca)
├── casos/*.casos.json   # os casos (correm nos dois lados — D4)
└── conformidade/        # o registo por versão (D3)
tools/verificar-conector/
├── conformidade.sh      # as oito provas
└── provas-offline.sh    # as que não precisam do venue
```

## Complexity Tracking

| Complexidade | Porquê | Alternativa recusada |
|---|---|---|
| Duas dependências de runtime novas | o SDK oficial do venue e a assinatura | reimplementar o protocolo à mão: mais código nosso a validar, com zero ganho de segurança |
| Bateria partida em offline/teste | o `provar.sh` tem de continuar verde sem rede | tudo contra o venue: a bateria geral ficaria dependente de uma chave e de um serviço |

## Progress

**Fase 1** (preparação e linha de base) por começar. A linha de base do recorte será medida antes da primeira
tarefa de código, como nos recortes anteriores (`relatorios/linha-de-base.txt`).
