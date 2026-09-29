# Quickstart: como correr e ler este conector

## O que se pode correr sem chave e sem rede (e corre na bateria geral)

```bash
cd ~/Projects/MesaCore
bash tools/verificar-conector/provas-offline.sh    # casos em dado, contra o dublê e contra o conector
bash tools/verificar-maquina/provar.sh             # a bateria geral, que já inclui a linha do conector
```

O que estas provam: a tradução da boleta, as recusas nomeadas, a derivação da referência de cliente, a forma
do manifesto, e a interdição de importar o `core`. **Não** provam nada sobre o venue — e dizem-no.

## O que precisa do venue (ambiente de teste)

```bash
cd ~/Projects/MesaCore
bash tools/verificar-conector/conformidade.sh      # as oito provas, contra o ambiente de teste
cat brokers/hyperliquid/conformidade/<versao>.txt  # o resultado, por versão e data
```

- Precisa da credencial **por referência** (o valor vive fora do repositório). Sem ela, o script **não corre**
  — não corre pela metade.
- **Nenhuma prova usa dinheiro real**: o ambiente é o de teste do venue (RN-H17).
- Se uma prova não puder correr (venue indisponível), o resultado é **incompleto** — nunca «passou» (FR-026).

## Como se lê o resultado

Cada prova diz **o que mediu** e **o número que saiu**. Um resultado é legítimo quando uma prova que devia
falhar falhou — o mesmo princípio das outras bancadas deste repositório (a frescura que cura o gerado, o
conector que recusa o que não cabe).

## Onde está o quê

| Quero ver | Ficheiro |
|---|---|
| A regra de negócio do conector | `docs/regra-de-negocio-conector.md` |
| A máquina de estados | `docs/maquina-de-estados-conector.md` |
| O modelo de dados e os dois achados | `specs/004-conector-hyperliquid/data-model.md` |
| As decisões do plano | `specs/004-conector-hyperliquid/plan.md` |
| As tarefas | `specs/004-conector-hyperliquid/tasks.md` |
| O que ficou provado | `specs/004-conector-hyperliquid/relatorios/RESULTADO.md` |
