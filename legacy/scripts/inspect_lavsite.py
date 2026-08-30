import sqlite3, json

src = r'c:\Users\Usuario\CascadeProjects\lavanderia-site\instance\site.db'
db = sqlite3.connect(src)
db.row_factory = sqlite3.Row

tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("TABLES:", json.dumps(tables))

# Procura tabela de serviços
for t in tables:
    if 'serv' in t.lower():
        cols = [r[1] for r in db.execute(f"PRAGMA table_info({t})")]
        print(f"\nTABLE {t} COLS:", cols)
        rows = db.execute(f"SELECT * FROM {t} LIMIT 5").fetchall()
        for r in rows:
            print(dict(r))
