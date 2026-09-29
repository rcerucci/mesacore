# contracts

As portas do sistema, e só isso — e o **schema** delas é **neutro de linguagem** (RN-E16):

- a porta do **setup** (o que a mesa lhe entrega e o que ela aceita de volta: a proposta e o template);
- a porta do **conector** (a boleta, a resolução, o desfecho, o manifesto de capacidades, as leituras);
- o **objecto normalizado** de mercado e conta (RN-D1 a RN-D5);
- a **boleta** (RN-B1 a RN-B8) e os seus campos, com o prazo da passiva e o destino do resto;
- a **versão do contrato**, que cada ponta declara e a mesa confere no arranque (RN-E18).

O schema é a **fonte**: o core (TypeScript) e o `/tools` (Python) geram dele o que precisam, e um plugin
pode ser escrito em qualquer linguagem que fale a mensagem — a linguagem decide-se na **spec daquele
plugin** (RN-E16). No contrato, dinheiro e percentagem viajam como **decimal textual**, nunca como
vírgula flutuante (RN-E19), para que duas linguagens cheguem ao mesmo número.

`mocks/` traz um **setup falso** e um **conector falso** que provam as fronteiras (RN-E17). Pelo menos um
deles é escrito **noutra linguagem** que não a do core: é isso que prova a neutralidade, em vez de a
afirmar. A prova de contrato é aqui; a prova contra a corretora de verdade é a bateria de conformidade
(RN-C6), em `brokers/<nome>/`.

Nada aqui conhece as tripas da mesa, o nome de um setup ou o nome de uma corretora: este diretório
**não importa** `core`, `setups/<nome>` nem `brokers/<nome>`, e é o
`tools/verificar-contrato/porteiro-dependencias.sh` que o mede a cada corrida (hoje: 0 dependências
proibidas). Quem importa **daqui** é o core (pelos tipos gerados), cada plugin, e o `/tools` — que
verifica o contrato e por isso tem de o ler.

## O que existe hoje

| Ficheiro | O que é |
|---|---|
| `envelope.schema.json` | versão, tipo, correlação e carga — o que atravessa a fronteira |
| `mercado` · `proposta` · `boleta` · `resolucao` · `desfecho` · `manifesto` `.schema.json` | as seis mensagens que as duas pontas trocam |
| `historico.schema.json` | o trilho do dinheiro, como o venue o conta (taxas e funding em campos próprios) |
| `_defs/forma.schema.json` | o que **todas** as mensagens partilham: decimal textual, instante, versão, correlação, motivo, marca de posse, os quatro lados |
| `vocabulario.json` | os conjuntos fechados, os **motivos normalizados** de recusa com a prioridade entre eles, e o **layout do campo da marca** (bits de ficha, bits de ciclo). Os runners leem daqui: não há esta lista escrita em código em lado nenhum |
| `versao.json` | a versão vigente do contrato, num só sítio |
| `origem-das-grandezas.json` | **de onde vem o valor de cada grandeza** (dono · setup · mesa · venue), com a chave de `/config` quando é do dono ou do setup. É o que torna o RN-A1 conferível: `tools/verificar-contrato/inventario.sh` reprova grandeza sem origem e chave fora do inventário |
| `casos/*.casos.json` | **111 casos de mensagem** — válidos e **inválidos de propósito**. Um conjunto que só sabe aceitar prova metade |
| `casos/referencia.decisoes.json` | **9 decisões da mesa** (reenviar, esperar, reconciliar, não enviar). Família separada de propósito: os casos de mensagem correm nas **duas** linguagens; as decisões correm só na implementação da mesa |
| `casos/conferencia.conformidade.json` | **17 casos de conformidade** contra manifestos-fixture, cada um com o número de mensagens que seriam enviadas (`enviadas=0` em toda a recusa) — é o que mede o SC-003 |
| `esqueleto/` | o enquadramento, os runners e as peças partilhadas, nas duas linguagens: `framing.{ts,py}`, `casos.{ts,py}`, `marca.ts` (a marca e os seus seis invariantes), `conferir.ts` (conferência contra o manifesto), `referencia.ts` (não-duplicação), `validar_linha.{ts,py}` (validar uma mensagem à mão) |
| `mocks/setup/main.ts` | o setup falso: só decide o lado, e sabe ser inválido de propósito |
| `mocks/conector/main.py` | o conector falso: traduz, resolve **antes** de executar, recusa em vez de arredondar, cumpre a idempotência que declara, e sabe ficar em silêncio |
| `mocks/conector/venue.py` · `conta.json` · `manifesto.json` | o **venue simulado**: as ordens e as posições como a corretora as guardaria. Não guarda nenhuma noção de "nossa" — é isso que faz do reinício um teste à corretora, e não a uma cópia |
| `mocks/conector/posicoes.py` · `historico.py` | ler a posse **do venue** pela marca (`--reiniciar`), e o histórico com taxas e funding em campos próprios, sem reconstruir o resultado |
| `gerado/ts` · `gerado/py` | os tipos derivados dos schemas, **versionados** (o `frescura.sh` recusa se não corresponderem) |

## Como se corre

```bash
cd contracts && bun install && uv sync

# a bateria de mensagens, nas duas linguagens, e a comparação entre elas
bun run esqueleto/casos.ts --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-ts.jsonl
uv run python esqueleto/casos.py --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-py.jsonl
uv run python ../tools/verificar-contrato/comparar.py ../specs/001-contrato-neutro/relatorios/us1-us3-{ts,py}.jsonl

# as três peças que a mesa acrescenta por cima do contrato
bun run esqueleto/marca.ts            # a marca e os seis invariantes
bun run esqueleto/conferir.ts --bateria   # conferência contra o manifesto
bun run esqueleto/referencia.ts       # reenviar? esperar? reconciliar?

# as provas de linha de comando (uma por assunto)
cd .. && bash tools/verificar-contrato/ponta-a-ponta.sh    # as duas fronteiras, sem corretora
bash tools/verificar-contrato/reinicio.sh                  # marcar → reiniciar → reencontrar
bash tools/verificar-contrato/reenvio.sh                   # a mesma referência não duplica
bash tools/verificar-contrato/inventario.sh                # toda grandeza tem dono (e o conferidor reprova)
bash tools/verificar-contrato/porteiro-dependencias.sh     # /contracts não depende do core
bash tools/verificar-contrato/frescura.sh                  # o gerado corresponde aos schemas
```

Os números do que isto deu estão em `specs/001-contrato-neutro/relatorios/RESULTADO.md`.
