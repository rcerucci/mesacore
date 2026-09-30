PRONTIDÃO PARA O PRIMEIRO PLUGIN DE SETUP — o portão, item a item, medido
29/09/2026 · contrato 1.7.0 · pergunta do dono: «quero saber se estamos prontos para o plugin de setup»

RESPOSTA CURTA
--------------
**Ainda não.** Falta **um** item que é o portão absoluto — *quem escreve a leitura a cada volta* —, mais dois
defeitos da minha fila e **um valor que só o senhor pode declarar**. O SL/TP fica fora, como autorizou, e o
primeiro setup não o usa. O resto está entregue e medido.

A TABELA (estado de hoje, e a prova de cada linha)
--------------------------------------------------
| # | O que o setup precisa | Estado | Prova / onde está |
|---|---|---|---|
| 1 | **A LEITURA a chegar ao setup, a cada volta** — quem escreve o ficheiro de operação, e o vigia a arrancar o **conector real** (não o dublê) | **EM CURSO** (cartão `t_2ccdde89`, `running`) | medido: hoje só a bancada escreve o ficheiro de operação; o vigia escreve só o das portas, e o registo de plugins aponta para `contracts/mocks/conector/main.py` |
| 2 | **Dados de mercado para as features** (velas + livro, em formato que qualquer língua leia) | **FEITO** | `brokers/hyperliquid/mercado.ts`: 169 velas de BTC 1h, livro 20/20, 14 intervalos; JSONL + descritor; **os mesmos números lidos em Python e em TS** (média 5: 83484.6, média 20: 83664.4) |
| 3 | **O briefing do plugin** (o que recebe, o que entrega, em que língua, com que nome) | **FEITO** | `setups/O-QUE-UM-SETUP-RECEBE-E-ENTREGA.md` — com dois exemplos que correm, e as armadilhas medidas (o nome **não** admite hífen) |
| 4 | **D-009 — a idempotência** (reenviar a mesma referência não pode duplicar) | **EM ABERTO** (fila minha) | medido na testnet: a mesma referência criou **duas** ordens, as duas preenchidas (P6 da bateria). Bloqueia a **política de reenvio**, não a primeira ordem |
| 5 | **D-012 — o `limite` utilizável** | **EM ABERTO** (fila minha) | a boleta `limite` morre sempre em `valor_fora_da_banda` (o preço do limite é a marca crua, 6 algarismos contra os 5 do venue). Só é gate se o setup quiser entrada passiva |
| 6 | **Os valores do mandato** — as quatro bandas (`saldo_pct`, `alavancagem`, `stop_pct`, `tp_pct`) e `setup.prazo_de_resposta_ms` | **SÓ O DONO** | medido no inventário: as chaves têm **leitor** e **nenhum valor** em ficheiro nenhum; sem elas a ficha **não passa o arranque** |
| 7 | **A própria política do first setup** (o lado, o relógio, o template, a ficha) | **SÓ O DONO / quem escreve o setup** | é o conteúdo do plugin: o que ele decide e com que parâmetros |
| 8 | SL/TP | **FORA** (autorizado) | cartão `t_e802e344`, `running` — o primeiro setup não usa stop, e o OCO fica por confirmar |
| 9 | A superfície web | **NÃO É GATE** | `web/` tem só o README; quem opera o primeiro setup pode fazê-lo pelo registo |

O QUE ISSO QUER DIZER, EM ORDEM
-------------------------------
1. **O portão é o item 1.** Enquanto ninguém escrever o ficheiro de operação em produção, o setup tem a porta de
   mercado e **não recebe nada com que calcular**. Está em curso por cartão, e é o trabalho que falta terminar.
2. Quando ele aterrar, **valido-o** contra os cinco critérios de aceite que escrevi no próprio cartão
   (`mtime` a andar a cada volta, o vigia a arrancar o conector real, a leitura igual à do venue no mesmo
   instante, uma volta completa com um setup de exemplo, e a prova negativa com o conector morto).
3. Depois disso a minha fila fecha-se com **D-009** e **D-012** — os dois vivem em `conector.ts`/`ordens.ts`, que
   estão a ser editados agora pelos cartões em curso; começar antes disso seria um terceiro escritor no mesmo
   ficheiro, que é como se perdem medições (já aconteceu nesta sessão: o portão ficou vermelho por código a meio
   que não era meu).
4. Do lado do senhor, o que faz falta são **os valores do mandato** (item 6) — as bandas da conta de operação — e
   a escolha da política do primeiro setup. O resto é connosco.

O QUE JÁ ESTÁ PRONTO, E NÃO SE PERDE
------------------------------------
- a **porta de mercado** (velas/livro) e o **formato para cálculo**, provado nas duas línguas;
- o **briefing do plugin**, com os exemplos que correm e as armadilhas medidas (nome sem hífen; a virada de mão
  em dois passos; `hold` não faz nada; `caixa` fecha em `reduce_only`);
- a **bateria de teste do venue** (21 provas, 20 passaram; a que falha é o D-009) e a **varredura do
  vocabulário** (15 valores, todos com desfecho nomeado);
- e o **D-013 fechado** nesta sessão (o lado oposto a uma posição nossa reduz, nunca abre do outro lado).

UMA NOTA DE MÉTODO, porque custou medições hoje: o dispatcher trabalha **no mesmo directório**, sem cópia
isolada. Enquanto um cartão corre, eu não meço nem gravo em `brokers/` nem em `core/` — e o portão só vale
sobre uma árvore congelada.
