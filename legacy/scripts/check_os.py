import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')
db.row_factory = sqlite3.Row

print("=== Últimas 5 OS ===")
rows = db.execute("SELECT id, number, client_id, status, total, created_at FROM service_orders ORDER BY id DESC LIMIT 5").fetchall()
for r in rows:
    print(dict(r))

print("\n=== Clientes com 'tamara' no nome ===")
rows = db.execute("SELECT id, first_name, last_name, name FROM clients WHERE lower(first_name) LIKE '%tamara%' OR lower(last_name) LIKE '%tamara%' OR lower(name) LIKE '%tamara%'").fetchall()
for r in rows:
    print(dict(r))
