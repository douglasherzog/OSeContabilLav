import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')

print("Todas as OS:")
for r in db.execute("SELECT so.id, so.number, so.created_at, c.first_name FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.id DESC LIMIT 10").fetchall():
    print(r)

# Corrige qualquer OS com horário UTC (offset de 3h) criada hoje
# Se created_at tem hora >= 03:00 e foi criada hoje, subtrai 3h
db.execute("""
    UPDATE service_orders
    SET created_at = strftime('%Y-%m-%d %H:%M:%S', datetime(created_at, '-3 hours'))
    WHERE date(created_at) = '2026-05-01'
    AND time(created_at) >= '03:00:00'
    AND id NOT IN (3, 4)
""")
db.commit()

print("\nApós correção:")
for r in db.execute("SELECT so.id, so.number, so.created_at, c.first_name FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.id DESC LIMIT 10").fetchall():
    print(r)
