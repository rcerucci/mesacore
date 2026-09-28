"""Prova negativa do conferidor do inventario: ele tem de REPROVAR quando falta uma origem.

Um conferidor que passa sempre nao mede nada. Este script tira uma grandeza do mapa, corre o
conferidor, e exige que ele reprove — depois repoe o ficheiro exatamente como estava.
"""

import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path("/home/cerucci/Projects/MesaCore")
MAPA = RAIZ / "contracts" / "origem-das-grandezas.json"
CONFERIDOR = RAIZ / "tools" / "verificar-contrato" / "py" / "inventario.py"

original = MAPA.read_text(encoding="utf-8")
dados = json.loads(original)

falhas = 0

def correr() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(CONFERIDOR)], capture_output=True, text=True,
                       cwd=str(RAIZ), env={"PATH": "/usr/bin:/bin", "HOME": "/home/cerucci"})
    return r.returncode, (r.stdout + r.stderr).strip()

# 1. sem alteracoes: verde
codigo, saida = correr()
if codigo == 0:
    print(f"ok      sem alteracoes o conferidor passa  ({saida.splitlines()[-1][:60]})")
else:
    print(f"FALHOU  sem alteracoes o conferidor reprovou:\n{saida}")
    falhas += 1

# 2. uma grandeza sem origem: tem de reprovar
del dados["grandezas"]["boleta.saldo_pct"]
MAPA.write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
codigo, saida = correr()
if codigo != 0 and "sem origem declarada: boleta.saldo_pct" in saida:
    print("ok      grandeza sem origem -> reprova (boleta.saldo_pct)")
else:
    print(f"FALHOU  grandeza sem origem NAO reprovou (exit {codigo}):\n{saida}")
    falhas += 1

# 3. uma declaracao a mais: tem de reprovar
dados = json.loads(original)
dados["grandezas"]["boleta.grandeza_que_nao_existe"] = {"origem": "venue"}
MAPA.write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
codigo, saida = correr()
if codigo != 0 and "declaracao sem grandeza: boleta.grandeza_que_nao_existe" in saida:
    print("ok      declaracao sem grandeza -> reprova")
else:
    print(f"FALHOU  declaracao a mais NAO reprovou (exit {codigo}):\n{saida}")
    falhas += 1

# 4. chave que nao esta no inventario: tem de reprovar
dados = json.loads(original)
dados["grandezas"]["boleta.saldo_pct"]["chave"] = "fichas/<i>.risco.chave_que_ninguem_nomeou"
MAPA.write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
codigo, saida = correr()
if codigo != 0 and "chave_que_ninguem_nomeou" in saida:
    print("ok      chave fora do inventario -> reprova")
else:
    print(f"FALHOU  chave fora do inventario NAO reprovou (exit {codigo}):\n{saida}")
    falhas += 1

MAPA.write_text(original, encoding="utf-8")
restaurado = MAPA.read_text(encoding="utf-8") == original
print(f"{'ok  ' if restaurado else 'FALHOU'}  mapa reposto exatamente como estava")
if not restaurado:
    falhas += 1

print(f"prova negativa: {falhas} falhas")
sys.exit(0 if falhas == 0 else 1)
