# config

Os arquivos do **dono**. A mesa lê-os e valida-os e **nunca os escreve** (RN-E12); a web edita-os com
validação e assinatura (RN-M2). Três famílias, e só três:

| Arquivo | É de | Traz |
|---|---|---|
| `conta.*` — **macro** | a conta | instrumentos, corretora e conta, circuit breaker da sessão (5%), margem total máxima (100% é legítimo), **risco máximo por ordem**, política de contenção de margem, ordem de atendimento |
| `fichas/<instrumento>.risco.*` | a posição (forma **fixa**, do core) | percentagem do saldo, alavancagem, distância mínima de liquidação (**opcional** — sem ela, a ordem é livre), janela, e as bandas onde os itens do setup têm de caber |
| `fichas/<instrumento>.setup.*` | a estratégia (forma publicada pelo **setup**) | os itens que o template daquele setup declarou (ema_fast, ema_slow, stop, limiares) |

## A conta e a contenda — por que o macro existe

Uma ficha não vê as outras: três instrumentos com 50% do saldo cada **não cabem** ao mesmo tempo. Isso
não é erro de nenhuma ficha — é decisão de conta:

- no arranque, a mesa compara a **soma** das fichas com o teto e **avisa** (RN-M4.7);
- o dono **corrige** os números ou **declara** a política de contenção — sem declaração, o arranque
  **recusa**, porque contenda não se resolve por omissão;
- com a política `espera`, o instrumento sem margem fica **à espera de saldo** e entra quando houver
  lugar. Esperar **não** é uma ordem em fila: registra-se o motivo (`sem_margem`) e o ciclo seguinte
  corre o seu caminho normal — sinal velho não é sinal (RN-M4.8);
- quando dois instrumentos disputam o mesmo lugar, vale a **lista declarada** no macro (RN-M4.9); sem
  lista, a ordem é **alfabética pelo símbolo**, e o registro diz qual critério decidiu — com o nome
  `alfabetica_sem_criterio` quando o dono não declarou nenhum. A ordem só decide quem fica de fora:
  havendo lugar para todos, entram todos (RN-M4.10).

## A credencial: onde o valor pode, e onde não pode

**Neste repositório, nunca.** O que viaja aqui é a **referência** (`conta.credencial` = um nome, e no
conector `credencial.referencia` + `credencial.valor_em`) — nunca o valor (RN-E14, RN-C20). Quem editar um
`.json` deste repositório com a chave lá dentro está a escrevê-la no git, no histórico e possivelmente nos
logs: é o defeito que estas duas linhas existem para impedir (e o `.gitignore` tem agora a rede `*.key`,
`*credencia*`, `*wallet*`, com os exemplos isentos).

> **A CONFIG DAS CONTAS PASSOU A SER VERSIONADA — decisão do dono, 02/10/2026.** Era ao contrário: o
> `.gitignore` ignorava `config/contas/` («é ESTADO e não se versiona») e o ficheiro da conta estava rastreado
> **ao mesmo tempo** — uma contradição que o `git status` mostrava todos os dias e que ninguém resolvia sem
> decidir de quem era a decisão. O dono decidiu pelo **versionamento**, e é este parágrafo — a regra da
> referência, nunca o valor — que o torna seguro: `config/contas/<conta>.json` guarda o **nome** da credencial
> e o **caminho** onde o valor mora, e o valor continua **fora** do repositório (`*.key`, fora de pasta
> sincronizada, modo 600). Duas defesas que ficam de pé: a rede do `.gitignore` (para um `git add -A`
> distraído) e a recusa do carregador quando um **valor** aparece num ficheiro versionado
> (`credencial/valor-que-esta-no-repositorio-recusa`, na tabela abaixo).

### E fora do repositório? Aí o ficheiro é texto simples — e há duas defesas

**1. A chave que o conector carrega deve ser uma *API wallet* (agent wallet), não a carteira principal.**
Está na documentação oficial do venue: «A master account can approve API wallets to sign on behalf of the
master account», e «API wallets are **only used to sign**». Ou seja: a máquina fica com uma chave que assina
ordens em seu nome, **não** com a chave que pode retirar fundos. Ela pode ser **desregistada** (basta mandar
um `ApproveAgent` novo), **expira**, e é podada quando a conta deixa de ter fundos — e a documentação é
explícita num ponto: **não reutilize o endereço do agent**; uma vez desregistado, o estado de nonces pode ser
podado e acções assinadas antes podem ser repetidas. Consequência prática para nós: agent novo a cada vez que
o antigo for desregistado, e o manifesto declara **duas identidades** — o **agent** que assina e o **endereço
da conta** que se consulta (a documentação avisa que consultar com o endereço do agent devolve vazio — é a
armadilha mais comum).

**2. Onde o valor fica, com o custo de cada sítio:**

| Onde | Custo real | Quando faz sentido |
|---|---|---|
| **variável de ambiente** (`env:HL_TESTNET_PRIVATE_KEY`) | legível pelo mesmo utilizador via `/proc/<pid>/environ`, e herda-se pelos processos filhos | teste, e produção em máquina só sua |
| **ficheiro fora do repo**, modo `0600` (`ficheiro:~/.mesacore/x.key`) | texto simples no disco; o perigo é a cópia de segurança e a sincronização (Drive/Dropbox) levarem-no | produção, se a pasta não for sincronizada |
| **ficheiro cifrado** (`gpg`, que é o único gestor instalado neste host) | uma frase-passe ou um agente a mais para gerir | quando o valor tiver de estar em disco e durar |

Recomendação para agora (teste): **variável de ambiente** + agent wallet, e o valor nunca escrito no
repositório. Quando passar a produção, decidimos entre o ficheiro `0600` fora de pasta sincronizada e o
cifrado — é decisão sua, e fica declarada.

## Como colocar a chave, em concreto (o processo levanta com isto)

**O URL da API não é segredo** e já está no `brokers/hyperliquid/conector.exemplo.json` — é lá que ele vive
(versionado, sem risco).

**A chave é segredo. O sítio é este, e só este:**

```bash
# 1. a pasta (0700) e o ficheiro (0600), FORA do repositorio e fora de pasta sincronizada
install -d -m 700 ~/.config/mesacore/credenciais
install -m 600 /dev/null ~/.config/mesacore/credenciais/hl_teste.key

# 2. escrever a chave SEM a passar pela linha de comando (nao fica no historico do shell)
read -rs -p "chave da API wallet: " K && printf '%s' "$K" > ~/.config/mesacore/credenciais/hl_teste.key
unset K
chmod 600 ~/.config/mesacore/credenciais/hl_teste.key

# 3. conferir que so o dono a le (tem de dizer 600)
stat -c '%a %n' ~/.config/mesacore/credenciais/hl_teste.key
```

E no `brokers/hyperliquid/<nome>.conector.json`:

```json
"credencial": { "referencia": "hl_teste", "valor_em": "ficheiro:~/.config/mesacore/credenciais/hl_teste.key" }
```

A alternativa, igualmente aceite, é a variável de ambiente:

```bash
export HL_TESTNET_PRIVATE_KEY='...'     # exportada no ambiente onde o conector corre
```
```json
"credencial": { "referencia": "hl_teste", "valor_em": "env:HL_TESTNET_PRIVATE_KEY" }
```

### O que o conector faz com isto (medido, não prometido)

O carregador `brokers/hyperliquid/credencial.ts` resolve a referência **nestes dois sítios e em mais nenhum**
e **recusa** — com motivo nomeado — quando:

| Situação | Motivo | Caso |
|---|---|---|
| o ficheiro é legível por grupo ou por outros (ex.: 644) | `valor_fora_da_banda` | `credencial/ficheiro-legivel-por-outros-recusa` |
| o **valor** aparece num ficheiro **versionado** do repositório | `valor_fora_da_banda` | `credencial/valor-que-esta-no-repositorio-recusa` |
| a referência não diz de onde vem | `formato_invalido` | `credencial/formato-sem-forma-recusa` |
| a variável/ficheiro não existe, ou está vazio | `campo_obrigatorio_ausente` / `valor_nulo_nao_permitido` | os dois casos de ausência |

São **9 casos**, todos offline, todos a passar (`credencial: 9 casos · 9 ok · 0 divergentes`), e entram na
bancada do conector. A varredura do repositório faz-se **em memória, ficheiro a ficheiro** — o valor nunca
entra numa linha de comando (nem no `ps`, nem no histórico).

## O cTrader: quatro ficheiros, o MESMO sítio, e o nome é da APLICAÇÃO

O conector cTrader tem **quatro** valores (`client_id`, `client_secret`, `access_token`, `refresh_token`) e cada
um vive no **seu** ficheiro. O sítio é o mesmo de sempre — `~/.config/mesacore/credenciais/` — e o que muda é o
nome: `ctrader_mesa_<campo>.key`. O nome da pasta é o da conta na Hyperliquid por uma razão, e aqui é o da
aplicação por outra (abaixo).

```bash
# 1. a pasta (0700) — a MESMA de sempre; o `install -d` nao se repete por venue
install -d -m 700 ~/.config/mesacore/credenciais

# 2. um valor de cada vez, por um programa que esta' no disco
#    (e nao por um bloco de comandos colado: um `read` dentro de um bloco ENGOLE as linhas seguintes do
#     proprio bloco, e o que fica gravado e' texto de comando — medido a 01/10/2026)
bash tools/guardar-credencial.sh gravar client_id
bash tools/guardar-credencial.sh gravar client_secret
bash tools/guardar-credencial.sh gravar access_token
bash tools/guardar-credencial.sh gravar refresh_token

# 3. conferir sem mostrar valor nenhum: modo, tamanho e FORMA de cada um
bash tools/guardar-credencial.sh conferir
```

O `guardar-credencial.sh` mostra a **forma** do que foi colado (comprimento e os primeiros caracteres), pergunta
antes de gravar, escreve com modo 600, e no fim confere. O valor nunca aparece no ecrã, nunca passa por um
argumento de comando (logo não fica no histórico do shell nem no `ps`) e nunca é impresso pelo programa.

**Porque um ficheiro por valor, e não um só com os quatro dentro:** o venue **RODA o par de tokens** e reescreve
os ficheiros deles. Com tudo num ficheiro só, a rotação passava por cima do `client_secret` da aplicação.

**Porque `ctrader_mesa_*` e não o nome da conta:** os tokens deste venue são do **utilizador (cTID)**, não da
conta — depois do `ApplicationAuth` (`client_id` + `client_secret`), a lista de contas **vem do token**
(`ProtoOAGetAccountListByAccessTokenReq`), e a conta escolhe-se pelo `ctidTraderAccountId` **na ficha do
conector**. Um conjunto de credenciais serve contas de demonstração **e** contas reais; trocar de conta é trocar
um número declarado, não um ficheiro. Na Hyperliquid é o contrário — a chave é de **uma** conta, e é por isso que
lá o ficheiro se chama `hl-teste-plugin.key` (o nome da conta).

**Sobre o cifrado**: o que esta página diz acima (o ficheiro `0600` fora de pasta sincronizada *ou* cifrado) é
decisão declarada do dono **na passagem a produção**, e vale igual aqui. Hoje, medido: o ficheiro da Hyperliquid
tem 66 bytes, uma linha, `0x` + 64 hexadecimais, e **não tem cifra nenhuma** — o carregador lê o valor cru.

E no `brokers/ctrader/<nome>.conector.json`:

```json
"credencial": {
  "referencia": "ctrader_mesa",
  "arquivos": {
    "client_id":      "ficheiro:~/.config/mesacore/credenciais/ctrader_mesa_client_id.key",
    "client_secret":  "ficheiro:~/.config/mesacore/credenciais/ctrader_mesa_client_secret.key",
    "access_token":   "ficheiro:~/.config/mesacore/credenciais/ctrader_mesa_access_token.key",
    "refresh_token":  "ficheiro:~/.config/mesacore/credenciais/ctrader_mesa_refresh_token.key"
  }
}
```

As recusas do carregador são as **mesmas nove** da tabela acima — a mesma regra, quatro ficheiros em vez de um, e
o motivo nomeia **qual** dos quatro falhou (ex.: ``[client_secret] o ficheiro da credencial é legível por grupo
ou por outros (modo 644)``).
