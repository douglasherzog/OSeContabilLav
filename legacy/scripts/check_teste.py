import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')
rows = db.execute("SELECT id, name, unit_price, unit, created_at FROM services WHERE lower(name) LIKE '%teste%' ORDER BY id DESC").fetchall()
print("Serviços 'teste':", rows)
print("\nÚltimos 5 serviços cadastrados:")
rows2 = db.execute("SELECT id, name, unit_price, unit, created_at FROM services ORDER BY id DESC LIMIT 5").fetchall()
for r in rows2:
    print(r)
