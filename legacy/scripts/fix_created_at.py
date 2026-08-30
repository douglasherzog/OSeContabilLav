import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')
db.execute("UPDATE service_orders SET created_at = REPLACE(created_at, 'T', ' ') WHERE created_at LIKE '%T%'")
db.commit()
print("Registros corrigidos:", db.execute("SELECT COUNT(*) FROM service_orders WHERE created_at LIKE '% %'").fetchone()[0])
print("Últimas OS:", db.execute("SELECT id, number, created_at FROM service_orders ORDER BY id DESC LIMIT 5").fetchall())
