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
| `vocabulario.json` | os conjuntos fechados e os **motivos normalizados** de recusa, com a prioridade entre eles. Os runners leem daqui: não há esta lista escrita em código em lado nenhum |
| `versao.json` | a versão vigente do contrato, num só sítio |
| `casos/*.casos.json` | **81 casos** — válidos e **inválidos de propósito**. Um conjunto que só sabe aceitar prova metade |
| `esqueleto/` | o enquadramento e os runners, nas **duas** linguagens (`framing.ts`/`casos.ts` e `framing.py`/`casos.py`) |
| `mocks/setup/main.ts` | o setup falso: só decide o lado, e sabe ser inválido de propósito |
| `mocks/conector/main.py` | o conector falso: traduz, resolve **antes** de executar, recusa em vez de arredondar, e sabe ficar em silêncio |
| `gerado/ts` · `gerado/py` | os tipos derivados dos schemas, **versionados** (o `frescura.sh` recusa se não corresponderem) |

## Como se corre

```bash
cd contracts && bun install && uv sync
bun run esqueleto/casos.ts --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-ts.jsonl
uv run python esqueleto/casos.py --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-py.jsonl
uv run python ../tools/verificar-contrato/comparar.py ../specs/001-contrato-neutro/relatorios/us1-us3-{ts,py}.jsonl
cd .. && bash tools/verificar-contrato/ponta-a-ponta.sh
```

Os números do que isto deu estão em `specs/001-contrato-neutro/relatorios/RESULTADO.md`.
