import sqlite3
db = sqlite3.connect(r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db')
total = db.execute('SELECT COUNT(*) FROM clients').fetchone()[0]
print(f'Total clientes: {total}')
rows = db.execute('SELECT first_name, last_name, phone, address FROM clients ORDER BY id DESC LIMIT 5').fetchall()
for r in rows:
    print(r)
