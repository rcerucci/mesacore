# Dublê de mesa

A mesa **de mentira**, para quem constrói um **plugin** — um setup ou um conector — e não tem (nem precisa de
ter) a mesa real de pé (`docs/regra-de-negocio.md`, **RN-E24**).

## O que ele promete

Falar a costura do contrato, nas duas direcções:

- **para um setup:** entrega o **snapshot de mercado** (uma linha JSON) e confere a **proposta** recebida
  contra o que o caso declara;
- **para um conector:** entrega a **boleta** e confere o **desfecho** recebido — as quatro classificações
  (`aceite`, `parcial`, `desconhecido`, `recusado`) e a **resolução** com os números.

Os casos são **dado** (`*.casos.json`), nunca ramos de código: um caso novo é um ficheiro novo, e a bateria
não muda.

## O que ele **não** promete

- **Não substitui a conformidade da corretora** (RN-C6). Nenhuma linha daqui toca num venue: a bateria de
  conformidade é o aceite do conector **real**, no recorte dele.
- **Não é a mesa.** Ele responde o que os casos dizem; não decide risco, não contende, não mede CB.
- **Não vale como prova de comportamento da mesa.** Se um dia divergir dela, a divergência é **defeito de um
  dos dois** e aparece como falha (SC-004) — é por isso que **os mesmos casos** correm nos dois.

## As regras que ele tem de cumprir

- Escrito **do contrato** (lê `contracts/*.schema.json`), **nunca** importando `core/`: um dublê copiado do
  core prova compatibilidade com a nossa implementação, não com o contrato — e esconde o defeito dos dois
  lados ao mesmo tempo (RN-E17, RN-E24).
- Em linguagem **que não a do core**: **Python 3 + `jsonschema`** (o core é TypeScript).
- **Adversário**: sabe recusar, atrasar, **calar-se** e devolver números **fora da banda**. Um dublê que diz
  sempre sim prova a fiação, não o comportamento — e este projecto já aprendeu isso à sua custa no
  `ponta-a-ponta.sh`, onde o venue simulado tem de começar **limpo**, senão a idempotência responde pela
  corrida anterior e o caso da recusa passa **sem recusar**.

## Como se corre

```
bash tools/verificar-contrato/duble-de-mesa.sh          # os casos declarados, nas duas direções
```
