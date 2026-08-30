with open("electron/main.js", "r", encoding="utf-8") as f:
    content = f.read()

old = 'SQL = await require("sql.js")();'
new = 'const initSqlJs = require("sql.js"); const wasmPath = require("path").join(require("path").dirname(require.resolve("sql.js")), "sql-wasm.wasm"); SQL = await initSqlJs({ locateFile: () => wasmPath });'

if old in content:
    content = content.replace(old, new)
    with open("electron/main.js", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK - corrigido")
else:
    import re
    m = re.search(r'SQL = await.{0,80}', content)
    print("Padrao nao encontrado. Linha atual:", m.group() if m else "nenhuma")
