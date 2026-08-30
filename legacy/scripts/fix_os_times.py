import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')

# OS #4 (Aderli) foi criada às ~12:30 mas gravou 15:30 (UTC). Corrige para horário local.
db.execute("UPDATE service_orders SET created_at = REPLACE(created_at, '15:30', '12:30') WHERE id = 5 AND created_at LIKE '%15:30%'")
db.commit()

print("OS após correção:")
for r in db.execute("SELECT id, number, created_at FROM service_orders ORDER BY id DESC LIMIT 5").fetchall():
    print(r)
