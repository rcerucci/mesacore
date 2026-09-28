# RESULTADO — recorte 002, a máquina de estados

Os **12 critérios de sucesso**, cada um com o comando que o mediu. Data da última corrida: **28 set 2026**.

Porta única: `bash tools/verificar-maquina/provar.sh` → **15 de 15 passaram**.
Regressão do recorte 001 incluída (`ponta-a-ponta.sh`, `frescura.sh`, `inventario.sh`).

| SC | O que exige | Comando que mediu | Medido |
|---|---|---|---|
| **SC-001** | 100% dos pares (estado, verbo) com transição legal ou recusa **com motivo** | `bun run core/estados/provar.ts` | **29 casos · 13 aceites · 16 recusados · 0 divergentes · 0 recusas sem motivo** |
| **SC-002** | Zero aberturas fora de `normal` | `bun run core/ciclo/provar.ts` | **0 aberturas de 4 casos fora de `normal`** (contagem de decisões de abrir, não inspecção de código) |
| **SC-003** | Com dado velho: 100% dos fechos legítimos permitidos e zero aberturas | `bun run core/ciclo/provar.ts` | **0 de 3 aberturas com dado velho · 1 de 1 fechos legítimos permitidos** |
| **SC-004** | Silêncio nunca vira `aceite` nem `recusado`; a marca fica `desconhecido` | `bun run core/ciclo/provar.ts` | **0 de 3 silêncios e 0 de 2 confirmações ilegíveis promovidos · 100% marcados** |
| **SC-005** | Com a marca `desconhecido`: zero ordens novas, zero marcas removidas por `reset` | `bun run core/ciclo/provar.ts` | **0 de 1 aberturas passaram** (com par de controle) · **`reset` não limpa** |
| **SC-006** | Porta falhada: zero arranques, 100% com o motivo **daquela** porta | `bun run tools/verificar-maquina/arranque.ts` | **0 arranques com porta falhada · 11 de 11 recusas com o motivo da porta** (15 casos) |
| **SC-007** | Depois do CB: zero `start` aceites, 100% das sessões novas gravam a configuração em vigor | `bun run tools/verificar-maquina/sessao.ts` | **0 de 1 `start` aceites · 1 de 1 sessões novas com a configuração em vigor** |
| **SC-008** | Em `pausada`: zero aberturas e o CB continua a disparar em 100% | `bun run tools/verificar-maquina/pausa.ts` | **0 de 1 aberturas em pausa · 1 de 1 CB disparado** |
| **SC-009** | Em `encerrando` sem resposta: 100% voltam a `em_operacao` com o `stop` pendente | `bun run tools/verificar-maquina/pausa.ts` | **2 de 2 voltaram, com o `stop` arquivado nas marcas** (o caso lê o ficheiro, não a frase) |
| **SC-010** | Reinício: zero marcas perdidas, com motivo e data | `bash tools/verificar-maquina/reiniciar.sh` | **3 processos + 1 leitura externa em Python · 0 marcas perdidas** |
| **SC-011** | Dia de operação reconstruível do registo, e cada decisão de **não** fazer com motivo | `bun run tools/verificar-maquina/registo.ts` | **11 linhas reconstruídas · 0 de 5 decisões de não-fazer sem motivo · cadeia de 3 transições sem buracos · fecha no estado final real** |
| **SC-012** | 100% das decisões apontam a chave que as governa, nas duas direções | `bun run tools/verificar-maquina/chaves.ts` + `inventario.sh` | **7 chaves lidas pelo core, 0 ausentes · 0 declaradas sem quem as leia · + as 19 grandezas do contrato (001)** |

## O que a conferência do SC-012 apanhou

Duas coisas que estavam no código e não estavam declaradas:

1. **`conta.politica_de_contencao` (código) vs `conta.contencao` (documento)** — duas coisas diferentes
   com o mesmo sentido. O código passou a ler o nome declarado.
2. **A política de arranque depois do CB estava num `if`.** A porta da sessão recusava por inibição sem
   ler `conta.arranque_apos_cb` — o valor estava escrito no código (RN-A1). Passou a ler a chave, e se
   ela faltar ou trouxer um nome não declarado, a mesa **grita** em vez de escolher por omissão o caminho
   que a deixa arrancar.

Nas duas direcções: **7 chaves lidas pelo core, 0 ausentes · 6 declaradas na secção deste recorte, 0 sem
quem as leia**.

## O que NÃO foi medido — declarado como não medido

- **SC-002** conta as decisões de abrir **da mesa** (a decisão de enviar). O que sai para o conector é o
  passo seguinte, e essa contagem é do recorte do ledger/conector: aqui mede-se que a mesa **decidiu não
  abrir**, não que a mensagem não saiu — a mesa não envia ($R5$).
- **SC-012, a terceira direcção**: o prazo de resposta do encerramento **não tem chave** no inventário
  (entra como parâmetro do pedido). Está declarado como **lacuna** no `docs/inventario-de-chaves.md` §7,
  com o nome que lhe falta — é uma decisão do dono, e o recorte não a inventa.
- **A web** manda verbos e desenha estado: o que ela mostra não é medido por este recorte (assunção
  declarada na spec).
- **Valores concretos** (5%, 2%, prazos, listas): não são medidos porque não são o que se prova — prova-se
  que as **chaves existem e são lidas**. Os números que aparecem nos casos são exemplos.

## Os artefactos brutos

`specs/002-maquina-de-estados/relatorios/`: `fundacional.txt`, `us1.jsonl`, `us2.{txt,jsonl}`,
`us3.{txt,jsonl}`, `us4.{txt,jsonl}`, `us5.{txt,jsonl}`, `us6-us7.{txt,jsonl}`, `registo.jsonl`.
Cada ficheiro `.txt` traz a corrida real colada (comando + saída), e não um resumo escrito à mão.
