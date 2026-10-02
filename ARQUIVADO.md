# ARQUIVADO — este ramo NÃO se usa

O ramo `fix/recusa-em-vez-de-presumir` foi publicado a 01–02/10/2026 por um agente e **arquivado a 02/10/2026**,
depois de auditado contra o `master`. Fica como registo; **não se faz merge dele** — e, a partir de 02/10, um
merge apagaria trabalho que o `master` já tem (a bancada `tools/verificar-maquina/registo-do-vigia.ts`).

## O que tem de errado

- **`core/estados/motivos.json` foi TRUNCADO**: passou de **55 motivos para 4**. O próprio ficheiro confessa o
  corte — `"_livro": "58 motivos no disco; este envio carrega os tres novos e a chave unidade. O corpo completo
  segue no mesmo commit se a chamada o aceitar."`. Com o livro em 4, `motivoConhecido`
  (`core/livro-de-motivos.ts`) lança «motivo de recusa fora do conjunto fechado» no arranque: o registo
  histórico do dono passa a ser ilegível e a mesa não arranca.
- **`core/ciclo/ciclo.ts` foi gravado uma vez com 0 (zero) linhas** (`64bfe5d`) e «reposto» a seguir com 238 das
  424 — perdeu-se a documentação, e o commit seguinte di-lo: «o commit anterior gravou a palavra no lugar do
  ficheiro».
- Dois commits do meio gravaram `motivos.json` **não-JSON** (`1a249b1`, `8b321bd`).

## O que foi aproveitado, e onde está

Aplicado ao `master` com caso de bancada **e** prova negativa — commit `32991f0`:

- `vigia/registro.ts` — registo **ausente** é registo novo; registo **ilegível RECUSA** (e a gravação não passa
  por cima). Bancada nova: `tools/verificar-maquina/registo-do-vigia.ts`, dentro da porta única.
- `setups/sigma/plugin.ts` — a linha ilegível do stdin **recusa** em vez de ser descartada em silêncio
  (`tools/verificar-setup/sigma-casos.py`, casos I e J).

Registado, com o que falta a cada um — `docs/ONDE_ESTAMOS.md` §«02/10/2026» (commit `b88d204`):

- `tolera_posicao_manual` (RN-T16) — falta a **costura**: `vigia/operador.ts` monta a vista `fichasParaAMesa`
  com uma lista explícita de campos e a chave não está nela; a guarda do ciclo, a exigir booleano, faria a mesa
  rebentar em todos os ciclos.
- `bandas.tempo_maximo_em_posicao` (RN-S11) — o motivo diz «sem instante de abertura» e a condição não o
  confere; e o instante de abertura **não existe em parte nenhuma do repositório** (0 ocorrências).
- O reenvio da boleta sem desfecho (`intencoesSemDesfecho`) — código morto: ninguém a chama nem escreve o
  ficheiro `intencoes-<conta>.jsonl`.

O texto dos três motivos escritos no livro truncado está preservado no `docs/ONDE_ESTAMOS.md` (dois servem para
o dia em que a RN-T16 e a RN-S11 fecharem; o terceiro, `ciclo_rebentou`, é uma discordância de desenho sem
código, contra a decisão declarada de `core/servidor.ts` — «grita e continua»).

Não se aproveitam: o alargamento `bandas | string` (0 ocorrências que o justifiquem), a mudança cosmética do
`join` em `decisao.ts`, e a remoção dos comentários «porquê» em quatro ficheiros.
