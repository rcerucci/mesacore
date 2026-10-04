#!/usr/bin/env bash
# A porta unica da maquina: corre TUDO o que prova o recorte 002, e sai 1 se alguma coisa falhar.
#
# Existe porque "corri as baterias" e uma frase que nao se verifica. Uma porta so, com uma saida so:
# ou passa, ou nao passa - e quando nao passa, diz qual.
#
# Uso:  bash tools/verificar-maquina/provar.sh [--rapido]
#       --rapido  salta a bateria do contrato (001), que e a mais lenta

set -u
cd "$(dirname "$0")/../.." || exit 1
RAIZ="$(pwd)"
RAPIDO=0
[ "${1:-}" = "--rapido" ] && RAPIDO=1

# ---------------------------------------------------------------------------------------------
# UMA BATERIA DE CADA VEZ. Duas ao mesmo tempo pisam-se: a prova negativa da frescura reescreve
# ficheiros gerados e o vigia escreve estado de runtime — e a segunda mede a sujeira da primeira.
# Quem chega depois RECUSA: nao espera, nao corre a meias. Uma bateria mede-se com o repositorio
# so para ela (foi assim que uma corrida concorrente deu "fronteira: 1 falhas" em codigo verde).
# A trava e um pid: se o processo ja morreu, a trava velha e limpa em vez de bloquear para sempre.
TRAVA=".provar.lock"
if [ -f "$TRAVA" ]; then
  outro=$(cat "$TRAVA" 2>/dev/null || echo "")
  if [ -n "$outro" ] && kill -0 "$outro" 2>/dev/null; then
    echo "provar: RECUSADO — outra bateria esta a correr (pid $outro); uma bateria mede-se sozinha"
    exit 1
  fi
  echo "provar: (trava do pid $outro, que ja nao existe — a limpar)"
fi
echo $$ > "$TRAVA"
# OS CLIENTES-FANTASMA DAS BANCADAS: uma bancada que morre a meio (timeout, SIGKILL) deixa o Chrome headless dela
# a correr — e um Chrome deixado a apontar ao painel e' uma SEGUNDA SESSAO a bater no sistema, para sempre (foi
# medido: um ficou 6 h depois de a bateria morrer). Antes e depois de cada bateria varrem-se os ORFAOS (o pai
# morreu, ppid=1): so' se toca em chromes NOSSOS (o perfil temporario da bancada), nunca no browser do dono, e
# nunca num que ainda tenha pai — esse esta' a ser usado por uma bancada viva.
varrer_as_bancadas_fantasmas() {
  for p in $(pgrep -f "user-data-dir=.*mesacore-bancada-chrome-" 2>/dev/null); do
    pai="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
    [ "$pai" = "1" ] && kill "$p" 2>/dev/null
  done
  true
}
varrer_as_bancadas_fantasmas
trap 'rm -f "$TRAVA"; varrer_as_bancadas_fantasmas' EXIT

falhas=0
corridas=0
declarar() {
  local nome="$1"; shift
  printf '%-42s ' "$nome"
  saida="$("$@" 2>&1)"
  if [ $? -eq 0 ]; then
    corridas=$((corridas + 1))
    echo "OK   $(echo "$saida" | tail -1)"
  else
    corridas=$((corridas + 1))
    falhas=$((falhas + 1))
    echo "FALHOU"
    echo "$saida" | tail -6 | sed 's/^/      /'
  fi
}

echo "=== a maquina dos recortes 001-003, do principio ao fim ==="
echo

declarar "tabela de transicoes"          bun run tools/verificar-maquina/tabela.ts
declarar "porteiro do estado (negativo)" bun run tools/verificar-maquina/tabela.ts --prova-negativa
declarar "a mesa (maquina + marcas)"     bun run core/mesa.prova.ts
# O CICLO CONTINUA DE ONDE FICOU (04/10/2026): a referencia `mesa-<ficha>-<ciclo>` alimenta o `cloid`; um ciclo a
# comecar em 0 re-usa as referencias da corrida anterior e o conector RECUSA-as no venue (o pedido perde-se). A
# bancada corre a MESA a serio com o registo a 47 e exige que a volta nova saia em 48 — e o controle (registo
# vazio) em 1; com o defeito reposto (`ciclo = 0`) fica vermelha.
declarar "ciclo continua de onde ficou (cloid)" bun run tools/verificar-maquina/ciclo-continua.ts
declarar "maquina de estados"            bun run core/estados/provar.ts
declarar "condicoes, ciclo, desfecho"    bun run core/ciclo/provar.ts
declarar "arranque (sete portas)"        bun run tools/verificar-maquina/arranque.ts
declarar "tipos (tsc)"                   bash tools/verificar-maquina/tipos.sh
declarar "sessao e CB"                   bun run tools/verificar-maquina/sessao.ts
declarar "pausa e encerramento"          bun run tools/verificar-maquina/pausa.ts
declarar "registo (SC-011)"               bun run tools/verificar-maquina/registo.ts
# O REGISTO DO VIGIA: ausente e' novo, ilegivel e' RECUSA — e a recusa vale para a gravacao (o dia da
# operacao nao se apaga por cima). Esteve fora da porta desde que existe: era o unico ficheiro do vigia
# que lia o ilegivel como ausente (medido 01/10/2026).
declarar "registo do vigia (ausente x ilegivel)" bun run tools/verificar-maquina/registo-do-vigia.ts
declarar "retencao do ledger (RN-L6)"    bun run core/estado/retencao.prova.ts
declarar "contenda (T066)"      bun run tools/verificar-maquina/contenda.ts  "resumo"
declarar "chaves do core (SC-012)"       bun run tools/verificar-maquina/chaves.ts
declarar "porteiro do estado (script)"   bash tools/verificar-maquina/porteiro-do-estado.sh
declarar "marcas sobrevivem ao reinicio" bash tools/verificar-maquina/reiniciar.sh
# O PRAZO DO OPERADOR (D-017): um par ligado cujo instrumento o conector nao le^ nao pode deixar o operador a'
# espera para sempre. A bancada corre o operador contra um conector FALSO (a costura `--conector`, so' para
# bancada) e exige a operacao escrita com `sem_leitura` e o processo terminado — sem rede, sem venue, sem chave.
declarar "operador: o prazo por leitura que nao vem (D-017)" bun tools/verificar-maquina/operador-nao-espera.ts
declarar "porta da mesa (T014-T016)"      bun run tools/verificar-maquina/servidor.ts
declarar "preparar contas (script + questionario)" bash tools/preparar-contas/provas.sh
declarar "conector hyperliquid (offline, US1)" bash tools/verificar-conector/provas-offline.sh
# O MANIFESTO ACOMPANHA AS FICHAS: uma ficha ligada a' QUENTE tem de poder ORDENAR, e nao so' ser lida e
# proposta. Era aqui que a ordem era recusada (`instrumento_desconhecido_no_manifesto`, medido a 02/10/2026
# com o ETH) — e o caso ficou fora de todas as bancadas porque so' aparece com a mao ABERTA.
declarar "manifesto acompanha as fichas (quente)" bun run tools/verificar-conector/manifesto-acompanha-as-fichas.ts
# O CAMINHO DO ENVIO faltava na porta unica: as 38 provas da porta de processo do conector (tradutor, precos,
# assinatura, as 8 portas do arranque) so corriam quando alguem se lembrava de as chamar. Um caminho que mexe
# em dinheiro fora do portao e um caminho que pode regredir sem ninguem dar por isso (medido 29/09/2026).
declarar "envio do conector (41 casos)"   bun run brokers/hyperliquid/processo.ts --bancada
# A TRADUCAO DE ORDENS entra no portao pela MESMA razao que o envio: e' ela que decide a quantidade que vai
# para o mercado, e e' o UNICO sitio onde uma reducao parcial se vira em numero (emenda 1.11.0). Corria so' a'
# mao (`casos/correr-ordens.ts`), fora de todas as bancadas — e um caminho que mexe em dinheiro fora do portao e'
# um caminho que pode regredir sem ninguem dar por isso (a licao de 29/09/2026, paga com o envio).
declarar "ordens do conector (53 casos)"  bun brokers/hyperliquid/casos/correr-ordens.ts
# O FEED DE MERCADO entra no portao: e' o processo que serve TODOS os setups, e nao tinha bancada nenhuma (o que
# havia era execucao ao vivo). A bancada mede o NUCLEO PURO (`feed-barras.ts`, modulo sem efeitos ao carregar):
# a barra agregada do `bbo` marcada e com `v`/`n` a zero, a barra do venue a substituir a agregada, o buraco
# NOMEADO e nunca inventado, a escrita atomica, e a primeira barra de um par novo (que se perdia em silencio —
# medido pela propria bancada a 02/10/2026). A 03/10/2026 entraram as duas regras que a corrida viva mostrou
# faltar: a agregacao so' toca em barra NOSSA (a do venue faz a agregacao CALAR-SE no periodo — antes ela mutava
# a barra do venue, 316 do ETH-1m) e a lista fica ORDENADA por `t` (a barra atrasada do venue toma o lugar dela, e
# a que e' anterior a' ultima fechada e' NOMEADA, nunca ignorada). A 04/10/2026 entrou a TROCA DE DONO INTEIRA
# (derivado -> fonte -> derivado outra vez): a derivacao nao fica calada para sempre depois de a fonte mandar. O
# que ela NAO prova, dito no cabecalho dela: a ligacao ao venue (o `SubscriptionClient`), que continua a ser prova
# de execucao ao vivo — a casa prefere a prova declarada mais fraca a uma prova que finge ser do portao. A prova
# NEGATIVA (10 defeitos injectados, a agregacao a mutar a barra do venue incluida) corre a' mao:
# `bash brokers/hyperliquid/casos/prova-negativa-do-feed.sh` — 10 de 10 nomes de caso conferidos.
declarar "feed de mercado (16 provas, SEM REDE)" bun run brokers/hyperliquid/casos/correr-feed.ts
# O UNICO SETUP do repositorio e' o `sigma`: os moldes de exemplo (`cruzamento_de_media`, TS e Python) foram
# retirados a pedido do dono (30/09/2026), e a bancada que os corria foi com eles. O que fica em pe' para o
# setup e' o que interessa: a traducao do indicador e a regra da entrada (as duas bancadas abaixo).
# A TRADUCAO DO INDICADOR entra na porta: o motor tem de fazer o mesmo que o `sign(mid - MA) + ZZ` do Pine em
# TODAS as combinacoes de `input`, e nao so' nas omissoes. Foi aqui que se apanhou o `na` do ATR (medido
# 30/09/2026: o motor calava-se nas primeiras 13 barras de 505, onde o grafico ja' tinha lado).
declarar "Pine x motor (todas as opcoes)" bash -c "cd contracts && uv run python ../tools/verificar-setup/varredura-pine.py"
# A REGRA DA ENTRADA (regra do dono, 30/09/2026): a entrada so' acontece na barra do FLIP — nao se abre no meio da
# perna, e uma ordem fechada a mao so' reabre no proximo flip. Sao oito casos, com as barras reais truncadas de
# proposito para que a ultima barra fechada seja (ou nao seja) a barra de uma viragem.
declarar "sigma: entrada so' no flip (10 casos)" bash -c "cd contracts && uv run python ../tools/verificar-setup/sigma-casos.py"
# AS FICHAS conferidas contra o que o sistema LE': as tres regras de identidade, os tipos (D4: o numero viaja em
# TEXTO) e a forma das bandas — e, sobretudo, a chave que NINGUEM le': «chave que ninguem le e' lixo» (o criterio
# do proprio inventario), com as que estao a espera de decisao do dono reportadas em vez de escondidas.
declarar "fichas (cabecalho, tipos, lixo)" python3 tools/verificar-setup/fichas.py

# As bancadas da camada de OPERACAO (003): correm processos a serio (vigia + mesa), por isso ficam na porta
# completa - a `--rapido` e a que se corre a cada passo.
if [ "$RAPIDO" -eq 0 ]; then
  # AS PROVAS DA TELA (o painel). Nao sao `grep` ao CSS nem a um formulario: abrem o painel num Chrome headless
  # (o mesmo motor do dono) e medem o DOM — e a prova da escrita e da criacao falam com o `servidor.ts` A SERIO
  # (`POST /api/ficha`), que e' a porta que o gesto do dono usa. Ficam na porta COMPLETA porque cada uma sobe um
  # Chrome (~5 s) e a da escrita cria e apaga uma ficha de bancada.
  declarar "painel: o recolhido conserva o botao"  bun run tools/painel/prova-do-recolhido.ts
  # O ARRANQUE DE PRIMEIRA VEZ: o que falta e' dito pelo NOME, e as fichas ARMADAS ao venue sao contadas. O
  # lancador corre o MESMO comando de checagem (`tools/checar-o-arranque.sh`) antes de levantar processo nenhum —
  # a bancada corre-o contra repositorios de bancada, sem tocar no venue.
  declarar "painel: o arranque de primeira vez"      bun run tools/painel/prova-do-arranque.ts
  declarar "painel: o catalogo dos conectores"     bun run tools/painel/prova-do-catalogo.ts
  declarar "painel: escrever ficha pela tela"      bun run tools/painel/prova-da-escrita.ts
  # A FONTE UNICA: o que a tela serve E' o que o repositorio tem, byte a byte, e ha' UMA pasta servida. Era aqui
  # que a 8788 servia uma COPIA a mao (`scratch/painel-v2`) sem as correccoes — medido a 03/10/2026.
  declarar "painel: uma so' pasta servida (a fonte)" bun run tools/painel/prova-da-fonte.ts
  # O VIVO: o painel diz o que esta' vivo, o que esta' parado e porque, com horas — medido no DOM.
  declarar "painel: o que esta' vivo e o que esta' parado" bun run tools/painel/prova-do-vivo.ts
  # OS BURACOS DO HISTORICO: o vao e' MARCADO e NOMEADO (de/ate + faltam), nunca silencioso nem uma barra
  # inventada. Mede os dois vaos reais (1 barra e 17,5 h) e o controle (sem vao, nenhum aviso).
  declarar "painel: o vao do historico (marcado)"  bun run tools/painel/prova-dos-buracos.ts
  # O DASH DE CONFIGURACAO: os quatro numeros do dono («impraticavel, confuso e cheio de bugs») — alvos de toque
  # ≥44 no telefone, o gesto de editar À VISTA, ZERO chaves duplicadas, e o fio vazio DITO. E as duas garantias de
  # 04/10/2026: o formulario de CRIAR CONTA nao abre «cheio de erros» (o que falta vai em tom neutro, e abre no
  # conector que ja' se usa) e a TELA RECARREGA-SE SOZINHA quando o servidor serve outra versao (`tela_em_ms` no fio)
  # — e' isto que impede DUAS SESSOES do painel com codigo diferente. Com provocacao (sem a comparacao, `cargas 1 -> 1`).
  declarar "painel: o dash de configuracao"        bun run tools/painel/prova-do-dash.ts
  # A CREDENCIAL PELA TELA: o dono cola o VALOR de uma chave e ele fica gravado no padrao da casa (um ficheiro
  # por valor, fora do repo, 0600), a conta a apontar por REFERENCIA. A prova arranca o servidor A SERIO com uma
  # pasta de credenciais de BANCADA, grava, confirma que o valor NAO esta' na resposta nem no registo, e prova as
  # guardas (origem/cabecalho, caminho dentro da pasta, valor curto). Apaga o que criou.
  declarar "painel: a credencial pela tela"        bun run tools/painel/prova-da-credencial.ts
  # O LOG MISTO: o `operador.log` tem prosa (o conector) e JSON (o operador); a prosa nao e' falta, e um `{` que
  # nao fecha e'. E a costura do buffer nao parte linhas a meio.
  declarar "painel: o log misto (prosa x truncagem)" bun run tools/painel/prova-do-log.ts
  declarar "vigia + mesa (--arranque)"     bash tools/verificar-maquina/vigia.sh --arranque
  declarar "vigia: orfandade (--orfandade)" bash tools/verificar-maquina/vigia.sh --orfandade
  declarar "encerramento (--encerramento)" bash tools/verificar-maquina/vigia.sh --encerramento
  declarar "verbos (--verbos, T044)"       bash tools/verificar-maquina/vigia.sh --verbos
  declarar "contrato neutro (recorte 001)" bash tools/verificar-contrato/ponta-a-ponta.sh
  # A PORTA DO CONTRATO: o vocabulario e' um CONJUNTO FECHADO nas DUAS direcoes (o que o produto emite e o que o
  # `vocabulario.json` declara) e a paridade dos dois motores caso a caso. Esteve FORA do portao — e foi ela que
  # apanhou a deriva do espelho dos motivos (`_defs/forma.schema.json`: dois nomes em falta desde a emenda 1.10.0,
  # atravessaram uma entrega inteira). Um conferidor que so' corre a' mao encontra o defeito uma vaga depois de ele
  # entrar; entrando aqui, encontram-no no dia.
  declarar "porta do contrato (2 motores)" bun tools/verificar-conector/porta-do-contrato.ts
  declarar "frescura do contrato"          bash tools/verificar-contrato/frescura.sh
  declarar "frescura (prova negativa, T057)" bash tools/verificar-contrato/frescura.sh --prova-negativa
  declarar "fallbacks (ZERO exigido)"          bash -c "cd contracts && uv run python ../tools/verificar-contrato/py/fallbacks.py --exigir-zero"
declarar "fronteira (SC-003, T046-T049)" bash tools/verificar-contrato/fronteira.sh
  declarar "duble de mesa (US6, SC-004)"   bash tools/verificar-contrato/duble-de-mesa.sh
  declarar "inventario de chaves (SC-012)" bash tools/verificar-contrato/inventario.sh
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "provar: $corridas de $corridas passaram — a maquina decide o que devia, e explica o que nao fez"
  exit 0
fi
echo "provar: $falhas de $corridas FALHARAM"
exit 1
