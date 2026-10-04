# tools/escrever-ficha

**A porta única de escrita de uma ficha** — o gesto do dono, com validação antes de aplicar e registo do que mudou.

Existe por causa de `RN-E12` («`/config` é do dono: a mesa lê-o, valida-o e **nunca o escreve**; a web edita-o com
validação e **assinatura**») e de `RN-M2` («o valor em vigor **e a sua origem** DEVEM ser registados, para que a
divergência entre o que se quis e o que corre nunca seja silenciosa»). A tela não escreve: **pede**, e quem escreve
é este.

```bash
# simular (valida e NÃO escreve) — é o primeiro passo sempre
bun run tools/escrever-ficha/escrever-ficha.ts --ficha fichas/sigma/BTC-hl-teste-plugin.json \
    --mudar cabecalho.prazo_de_resposta_ms=6000 --simular

# escrever
bun run tools/escrever-ficha/escrever-ficha.ts --ficha fichas/sigma/BTC-hl-teste-plugin.json \
    --mudar cabecalho.enviar=false

# com a impressão do ficheiro que se viu (recusa se a ficha tiver mudado entretanto)
bun run tools/escrever-ficha/escrever-ficha.ts --ficha … --mudar … --visto <sha256>
```

## A ordem das operações é o desenho

1. **lê** a ficha como ela está e guarda a sua impressão (`sha256`);
2. se quem pede trouxe a impressão do que **viu**, compara-as: uma página (ou um terminal) velha **não passa por
   cima** de uma mudança nova;
3. **compõe o candidato** — só as chaves que mudam; tudo o resto fica como estava, palavra por palavra;
4. **valida o candidato ANTES de tocar no ficheiro**: copia a árvore das fichas para um sítio temporário, põe lá o
   candidato e corre o **mesmo conferidor do portão** (`tools/verificar-setup/fichas.py`). Se ele reprovar, não se
   escreve nada — e a razão que ele deu é a resposta. Não há aqui uma segunda conta das regras (RN-E9);
5. **escreve de forma atómica** (ficheiro novo + troca de nome) e deixa a **linha no registo**: instante, ficha,
   origem, impressão antes e depois, e o que mudou.

## O que ele recusa, e porquê

- **um valor fora da banda que a própria ficha declara** (`saldo_pct`, `alavancagem`, `stop_pct`, `tp_pct`): o
  conferidor confere a *forma* e não o valor contra a banda — quem confere o valor é a mesa, na boleta —, e uma
  ficha escrita fora da banda deixa o par a ser recusado em tempo de execução, **em silêncio**. A recusa diz os
  números da banda;
- **um caminho fora de `fichas/`** (no `escrever`) e fora de `fichas/`+`config/contas/` (no `criar`): esta porta
  existe para estas famílias, e uma porta que serve para tudo não é uma porta, é um buraco;
- **uma ficha que mudou desde que foi lida** (a impressão não bate);
- **um valor igual ao que já lá está** (não há nada para escrever);
- **criar por cima do que existe**: `criar` recusa um caminho que já exista — criar não é sobrepor.

## CRIAR: a outra operação (o que ainda não existe)

`escrever` exige um ficheiro que exista (precisa de um «antes» e de uma impressão). `criar` parte de um CANDIDATO,
e a guarda que substitui a impressão é outra: **o ficheiro não existir**. Cria duas famílias, e só duas:

```
fichas/<setup>/<PAR>-<CONTA>.json     ← conferidor: tools/verificar-setup/fichas.py <pasta>
config/contas/<nome>.json             ← conferidor: tools/verificar-config/conferir-config.ts <ficheiro>
```

**Cada família tem o SEU conferidor** — e usar o das fichas para uma conta daria um «veredicto» que não existe, a
pior espécie de aprovação. O candidato é escrito numa **cópia temporária** da família e é o conferidor que decide;
se reprovar, nada é criado. O registo leva `"criado": true`.

Chamada pela linha de comando (a partir de um ficheiro JSON com o documento inteiro) e pela porta do painel
(`POST /api/ficha` com `{"criar": true, "conteudo": {...}}`). Na tela, o formulário **compõe o candidato a partir
do que existe** (uma ficha nova clona a ficha do mesmo setup, troca a identidade e desarma `run`/`enviar`; uma conta
nova clona a conta que existe) — a tela não reimplementa esquemas, e quem julga é o conferidor.

## O registo

`~/.config/mesacore/historico-de-fichas.jsonl`, uma linha por mudança:

```json
{"instante":"…","ficha":"fichas/sigma/BTC-hl-teste-plugin.json","origem":"vista de configuração",
 "de":"<sha256 antes>","para":"<sha256 depois>","mudancas":[{"chave":"cabecalho.enviar","de":true,"para":false}]}
```

Vive **fora do repositório**: em `/config` há três famílias de ficheiro e só três (RN-E12) — um histórico lá dentro
seria uma quarta, e a regra não é uma sugestão.
