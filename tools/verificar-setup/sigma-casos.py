#!/usr/bin/env python3
"""OS CASOS DA DECISÃO DO `sigma` — a regra do dono: **sem flip não há entrada**.

Regra (30/09/2026, palavras do dono): «um flip de sinal tem que fechar a ordem aberta e inverter»; «na
inicialização do setup a primeira operação só no primeiro flip»; «nao pode abrir ordem no meio da perna»;
«se uma ordem for fechada à mão só pode ser aberta no próximo flip de sinal».

O que se prova aqui, caso a caso, com as barras REAIS do repositório (`barras/velas-SOL-1h.jsonl`) e a série
truncada de propósito para que a última barra FECHADA seja (ou não seja) a barra de uma viragem:

  A plano, sem flip na última barra            -> SILÊNCIO (nada no stdout, e o motivo nomeado)
  B plano, a última barra É o flip             -> proposta no lado do flip (a primeira carga)
  C plano, flip na barra mas já atendida       -> SILÊNCIO (D-021: uma entrada por barra)
  D plano, sem flip, com o flip antigo no estado-> SILÊNCIO (o caso «fechada à mão»)
  E posição do lado do indicador               -> `hold`
  F posição contra o indicador, sem flip       -> proposta no lado do indicador (fecha; a entrada espera o flip)
  G posição contra o indicador, E a barra é o flip -> proposta no lado do flip (fecha e inverte, dois passos)
  H sem leitura no stdin                       -> SILÊNCIO (não se decide sobre o que não se leu)

Uso: sigma-casos.py            (sai 1 se algum caso divergir do que a regra diz)
"""
import json
import os
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PASTA = os.path.join(RAIZ, "tools", "verificar-setup")
VELAS = os.path.join(PASTA, "barras", "velas-SOL-1h.jsonl")
constantes = {k: v["omissao"] for k, v in json.load(open(os.path.join(RAIZ, "setups/sigma/setup.json")))["template"].items()
              if k in ("ma_len", "ma_tipo", "src_ma", "src_sinal", "usar_banda", "banda_atr", "usar_zz", "zz_atr", "atr_len")}
PASSO_MS = 3_600_000


def serie(n_barras, destino):
    linhas = [l for l in open(VELAS, encoding="utf-8") if l.strip()][:n_barras]
    open(destino, "w", encoding="utf-8").write("".join(linhas))
    return [json.loads(l) for l in linhas]


def pontos(velas_path):
    """O que o motor calcula para uma série — pela boca do `imprimir.ts`, que é o mesmo código do plugin."""
    with tempfile.TemporaryDirectory() as tmp:
        k = os.path.join(tmp, "k.json")
        json.dump(constantes, open(k, "w"))
        saida = os.path.join(tmp, "m.json")
        subprocess.run(["bun", "run", os.path.join(PASTA, "imprimir.ts"), velas_path, k, saida],
                       check=True, capture_output=True, cwd=RAIZ)
        return json.load(open(saida, encoding="utf-8"))


def com_barras(n, tmp):
    """Escreve a série truncada em `n` barras e devolve (velas, pontos) com o corte feito ANTES do motor."""
    v = os.path.join(tmp, f"v{n}.jsonl")
    velas = serie(n, v)
    p = pontos(v)
    return velas, p


def correr(velas_path, mercado, tmp, estado=None):
    """Corre o plugin contra uma série e uma leitura; devolve (stdout, stderr)."""
    pasta = os.path.join(tmp, "mercado")
    os.makedirs(pasta, exist_ok=True)
    subprocess.run(["cp", velas_path, os.path.join(pasta, "velas-SOL-1h.jsonl")], check=True)
    pasta_estado = os.path.join(tmp, "estado")
    os.makedirs(pasta_estado, exist_ok=True)
    if estado is not None:
        json.dump(estado, open(os.path.join(pasta_estado, "sigma-SOL.json"), "w"))
    env = {**os.environ, "CONSTANTES": json.dumps(constantes), "INSTRUMENTO": "SOL", "RELOGIO": "1h",
           "PASTA_DE_MERCADO": pasta, "PASTA_DE_ESTADO": pasta_estado}
    r = subprocess.run(["bun", "run", os.path.join(RAIZ, "setups/sigma/plugin.ts")],
                       input=mercado, capture_output=True, text=True, env=env, cwd=RAIZ)
    return r.stdout.strip(), r.stderr.strip()


def leitura(t_fechada, posicao=None):
    carga = {"instrumento": "SOL", "estado": "aberto", "equity": "1000", "bid": "100", "ask": "100.1",
             "tempo_do_venue_ms": t_fechada + PASSO_MS}
    if posicao is not None:
        carga["posicao"] = {"lado": posicao}
    return json.dumps({"contrato": "9.9.9", "tipo": "mercado", "id": "m1", "carga": carga}) + "\n"


def lado_da_proposta(stdout):
    if stdout == "":
        return None
    linha = json.loads(stdout.split("\n")[-1])
    return linha["carga"]["lado"]


def main():
    falhas = 0
    with tempfile.TemporaryDirectory() as tmp:
        velas_todas = [json.loads(l) for l in open(VELAS, encoding="utf-8") if l.strip()]
        n = len(velas_todas)
        velas, p = com_barras(n, tmp)
        # A última barra do ficheiro completo vira? (esperado: não) e onde está a última viragem?
        assert p[-1]["virada"] == 0, "a ultima barra do ficheiro completo nao serve de caso-base"
        indices_flip = [i for i, x in enumerate(p) if x["virada"] != 0]
        assert indices_flip, "o ficheiro de barras nao tem nenhuma viragem"
        i_flip = indices_flip[-1]
        v_flip, p_flip = com_barras(i_flip + 1, tmp)   # a última barra É a barra do flip
        lado_do_flip = "buy" if p_flip[-1]["virada"] == 1 else "sell"
        lado_do_indicador = "buy" if p[-1]["sig"] == 1 else "sell"
        contra = "sell" if lado_do_indicador == "buy" else "buy"
        print(f"barras: {n} · ultima viragem na barra #{i_flip} ({lado_do_flip}) · "
              f"indicador na ultima barra: {lado_do_indicador} · ATR/virada da ultima: {p[-1]['virada']}")

        casos = [
            ("A plano, sem flip na ultima barra", VELAS, leitura(velas[-1]["t"]), None, None),
            ("B plano, a ultima barra E o flip", os.path.join(tmp, f"v{i_flip+1}.jsonl"), leitura(v_flip[-1]["t"]), None, lado_do_flip),
            ("C plano, flip ja atendida nesta barra", os.path.join(tmp, f"v{i_flip+1}.jsonl"), leitura(v_flip[-1]["t"]),
             {"ultima_barra": v_flip[-1]["t"]}, None),
            ("D plano, sem flip, com o flip antigo no estado", VELAS, leitura(velas[-1]["t"]),
             {"ultima_barra": v_flip[-1]["t"]}, None),
            ("E posicao do lado do indicador", VELAS, leitura(velas[-1]["t"], lado_do_indicador), None, "hold"),
            ("F posicao contra, sem flip na barra", VELAS, leitura(velas[-1]["t"], contra), None, lado_do_indicador),
            ("G posicao contra, e a barra E o flip", os.path.join(tmp, f"v{i_flip+1}.jsonl"),
             leitura(v_flip[-1]["t"], "sell" if lado_do_flip == "buy" else "buy"), None, lado_do_flip),
            ("H sem leitura no stdin", VELAS, "", None, None),
        ]

        for etiqueta, velas_path, mercado, estado, esperado in casos:
            stdout, stderr = correr(velas_path, mercado, tmp, estado)
            obtido = lado_da_proposta(stdout)
            hold = stdout != "" and json.loads(stdout.split("\n")[-1])["carga"]["lado"] == "hold"
            if esperado is None:
                ok = obtido is None and not hold
                visto = "silencio" if ok else f"lado={obtido}"
            else:
                ok = obtido == esperado
                visto = f"lado={obtido}"
            esperado_txt = "silencio" if esperado is None else f"lado={esperado}"
            print(f"{'ok   ' if ok else 'DIVERGE'} {etiqueta:48s} esperado={esperado_txt:14s} visto={visto}")
            if not ok:
                falhas += 1
                print(f"        stderr: {stderr[:300]}")
        # O caso E tem de ser `hold` (a posição já está do lado): confirma-se pelo texto dito.
        stdout, _ = correr(VELAS, leitura(velas[-1]["t"], lado_do_indicador), tmp)
        if "hold" not in stdout:
            print("DIVERGE caso E: a posicao ja' do lado tinha de responder `hold`")
            falhas += 1
        # E o caso A tem de dizer PORQUE nao propoe (o dono le isto no registo).
        _, err = correr(VELAS, leitura(velas[-1]["t"]), tmp)
        if "meio da perna" not in err:
            print("DIVERGE caso A: o silencio tinha de vir com o motivo nomeado")
            falhas += 1

    print(f"\nsigma.casos: {len(casos)} casos · {len(casos) - falhas} ok · {falhas} divergentes")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
