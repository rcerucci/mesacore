# tools/painel

**O retrato** — o leitor que junta o que a corrida já escreveu e produz o fio que a tela consome
(`web/painel/painel.json`). **O servidor** (`servidor.ts`) — serve a tela e aceita o *pedido* de escrita de uma
ficha; quem escreve é `tools/escrever-ficha`, não ele. O desenho da tela, a vista de configuração e as decisões
estão em `docs/INTERFACE-DE-CONTROLO.md`.

Regras que este directorio cumpre (as mesmas de `tools/`: é do dono e **não opera** — não decide nada da mesa, não
lança processos, não toca na operação):

- **o retrato não escreve nada**: nem na operação, nem em ficha nenhuma. Se estiver parado, a mesa opera igual;
- **o servidor também não escreve fichas**: aceita um pedido e entrega-o à porta única (`tools/escrever-ficha`),
  que valida antes de aplicar e regista. As três guardas do endpoint (origem + cabeçalho próprio, impressão do
  ficheiro visto, validação antes de escrever) estão ditas no cabeçalho do `servidor.ts`;
- **não recalcula o que a mesa sabe** (RN-E9): preço, posição, decisão e ordens vivas são **os ficheiros do
  sistema**, copiados com o nome do campo que lá está; e o veredicto sobre uma ficha é do conferidor do portão;
- **não conhece o nome de setup nenhum**: a série do indicador sai do **comando que o próprio setup declara**
  (`setup.json` → `sobreposicao`), corrido com o instrumento, o relógio e as constantes **da ficha**;
- **não esconde o que falta**: o que não se conseguiu ler sai como **falta nomeada**, com o porquê — nunca como
  zero nem como vazio silencioso.

## Uso

```bash
bun run tools/painel/retrato.ts                                  # a corrida de risco mais recente
bun run tools/painel/retrato.ts --corrida <dir>                   # outra corrida
bun run tools/painel/retrato.ts --para /caminho/painel.json       # outro destino
bun run tools/painel/retrato.ts --conta <nome>                    # outra conta
```

A saída na consola é o resumo que se cola num relatório: a mesa, o estado, os instrumentos com a ficha, as
contagens e as faltas.

## A correr com o sistema (a unit do host)

O painel **não vive na sessão de quem o abre**. Quem o mantém de pé é a unit de utilizador
`mesacore-painel.service` — do host, não desta sessão nem de outra —, que corre:

    /usr/bin/bash <repo>/tools/painel/servir.sh --porta 8788 --intervalo 60

com `Restart=on-failure` / `RestartSec=5`, `WantedBy=default.target` e `loginctl enable-linger cerucci`
(sem o linger, a unit morreria com a sessão gráfica — e é isso que ela existe para evitar). A cópia
versionada da unit está em `tools/painel/mesacore-painel.service`; a que corre vive em
`~/.config/systemd/user/`.

```bash
systemctl --user status mesacore-painel.service          # estado
systemctl --user restart mesacore-painel.service         # reiniciar
systemctl --user disable --now mesacore-painel.service   # parar E tirar do arranque automático
journalctl --user -u mesacore-painel.service -f          # o registo (o log em ficheiro já não existe)

# instalar/actualizar a partir da cópia do repositório
cp tools/painel/mesacore-painel.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now mesacore-painel.service
```

Enquanto a unit estiver ligada, **lançar `servir.sh` à mão falha com `EADDRINUSE`**: a porta 8788 tem dono.
Para voltar a correr à mão, desligue primeiro a unit (`disable --now`, acima).

**Medido** (2026-10-01, não é intenção): `is-enabled`=enabled · `is-active`=active · `Linger=yes` ·
amarra **só** `192.168.15.24:8788` (nunca `0.0.0.0`/`[::]`) · `GET /index.html` → **200** com sha256
`33e8e604…612a1` **igual** ao de `web/painel/index.html` em disco · travessia de directório `404` ·
`painel.json` reescrito pelo ciclo da própria unit a cada 60 s · corre sob
`user@1000.service/app.slice/mesacore-painel.service` (não sob a sessão de ninguém).

## O que ele lê

| fonte | o que tira |
|---|---|
| `<corrida>/operacao.json` | leitura do venue (bid/ask/último/equity/posição/ordens vivas), proposta, risco, parâmetros |
| `<corrida>/registo.jsonl` | estado da mesa, ciclos (`acao`/`motivo`), mandato |
| `<corrida>/operador.log` | o que o setup disse (`setup_falou`) e as passagens do carteiro |
| `<corrida>/mercado/velas-*.jsonl` | as velas (do venue) |
| `<corrida>/desfechos-*.jsonl`, `marcas-*.jsonl` | o que saiu para o venue e as marcas de posse |
| `fichas/<setup>/<PAR>-<CONTA>.json` | a ficha do dono: `run`, `enviar`, risco, constantes |
| `setups/<nome>/setup.json` | o template (descritor) e o comando da `sobreposicao` |
| `setups/<nome>/sobreposicao.ts` | **a série do indicador** — corre como processo, com o ambiente do plugin |

## O ambiente que ele passa à sobreposição

O mesmo que o plugin recebe em operação, para não haver duas maneiras de dizer a mesma coisa:

`INSTRUMENTO`, `RELOGIO`, `CONSTANTES` (JSON da ficha), `PASTA_DE_MERCADO`, `AGORA_MS` (o instante do venue,
para a barra "a que decidiu" ser a mesma que a mesa viu).

## Os dois relógios (e porque são dois)

O painel tem **dois** ciclos, e não é por gosto: são duas coisas com ritmos próprios.

| ciclo | ficheiro | por omissão | o que traz |
|---|---|---|---|
| **retrato** (completo) | `web/painel/painel.json` | 60 s (`--intervalo`) | tudo, **incluindo as velas e a série** do setup — é dele que sai o gráfico |
| **vivo** | `web/painel/vivo.json` | 2 s (`--intervalo-vivo`) | o «agora»: leitura (preço, idade do dado), posição, proposta, última decisão, risco, faltas |

**Medido** (02/10/2026, 3 voltas de cada): o retrato completo custa **0,43 s** e pesa **2,7 MB** (1,67 MB só de
séries, porque pergunta a cada setup a sua série — um processo por par). O modo leve (`--sem-serie`) custa
**0,11 s** e pesa **28 KB** (98× menos). A série muda **por barra**; a leitura e a decisão mudam **a cada
segundo** no motor (o operador escreve a operação a 1 s) — e era isso que faltava: com os dois ciclos amarrados a
60 s, o ecrã mostrava um retrato de até ~120 s de idade enquanto a mesa já tinha decidido outra coisa.

A tela segue os dois: o `vivo.json` repinta os números (a cada 2 s) e o `painel.json` redesenha o gráfico (a cada
60 s). O que o vivo **não** traz (as velas e a série) é preservado do retrato que já está desenhado — e a fita
mostra **as duas idades**, porque o «agora» fresco com um gráfico velho seria uma meia-verdade.

`--sem-serie` também serve para pedir um retrato à mão sem pagar o custo da série:

```bash
bun run tools/painel/retrato.ts --sem-serie --para web/painel/vivo.json --corrida <dir>
```
