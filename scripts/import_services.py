import sqlite3

src_path = r'c:\Users\Usuario\CascadeProjects\lavanderia-site\instance\site.db'
dst_path = r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db'

src = sqlite3.connect(src_path)
src.row_factory = sqlite3.Row
services = src.execute("SELECT * FROM service ORDER BY id").fetchall()

print(f"Serviços encontrados: {len(services)}")
for s in services:
    print(f"  [{s['id']}] {s['name']} | R$ {s['price']} / {s['unit']}")

dst = sqlite3.connect(dst_path)

imported = 0
skipped = 0
for s in services:
    name = s['name'].strip()
    existing = dst.execute("SELECT id FROM services WHERE name=?", (name,)).fetchone()
    if existing:
        print(f"  SKIP (já existe): {name}")
        skipped += 1
        continue
    dst.execute(
        "INSERT INTO services (name, description, category, unit_price, unit, active, created_at) VALUES (?,?,?,?,?,1,datetime('now'))",
        (name, None, 'geral', s['price'], s['unit'])
    )
    imported += 1

dst.commit()
dst.close()
src.close()

print(f"\nImportados: {imported} | Ignorados (duplicados): {skipped}")
