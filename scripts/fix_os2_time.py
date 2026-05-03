import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')
db.execute("UPDATE service_orders SET created_at = '2026-05-01 11:50:00' WHERE id = 4 AND created_at = '2026-05-01 00:00:00'")
db.commit()
print("OK:", db.execute("SELECT id, number, created_at FROM service_orders WHERE id=4").fetchone())
