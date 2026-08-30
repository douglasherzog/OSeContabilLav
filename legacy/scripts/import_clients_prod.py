import sqlite3
import subprocess
import json
import re

# ── Configurações ──────────────────────────────────────────────────────────────
SSH_HOST   = "root@46.62.225.96"
COMPOSE    = "/opt/lavanderia-site/compose.yaml"
DST_PATH   = r"C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db"
# ──────────────────────────────────────────────────────────────────────────────

def normalize_phone(raw):
    if not raw:
        return None
    digits = re.sub(r'\D', '', raw)
    if not digits:
        return None
    d = digits
    if d.startswith('55') and len(d) >= 12:
        d = d[2:]
    if len(d) == 11:
        return f"+55{d}"   # celular
    if len(d) == 10:
        return f"+55{d}"   # fixo
    return f"+{digits}"

def split_name(full_name):
    parts = (full_name or '').strip().split()
    if not parts:
        return ('', '.')
    first = parts[0].capitalize()
    last  = ' '.join(p.capitalize() for p in parts[1:]) if len(parts) > 1 else '.'
    return first, last

def fetch_clients():
    sql = (
        "SELECT id, name, phone, "
        "COALESCE(street,'') as street, "
        "COALESCE(street_number,'') as street_number, "
        "COALESCE(neighborhood,'') as neighborhood "
        "FROM client ORDER BY id;"
    )
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        SSH_HOST,
        f'docker compose -f {COMPOSE} exec -T db '
        f'psql -U lavanderia -d lavanderia -t -A -F"|" -c "{sql}"'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        raise RuntimeError(f"SSH error: {result.stderr}")
    rows = []
    for line in result.stdout.strip().splitlines():
        if not line.strip():
            continue
        parts = line.split('|')
        if len(parts) < 6:
            continue
        rows.append({
            'id':           parts[0].strip(),
            'name':         parts[1].strip(),
            'phone':        parts[2].strip() or None,
            'street':       parts[3].strip(),
            'street_number':parts[4].strip(),
            'neighborhood': parts[5].strip(),
        })
    return rows

def build_address(row):
    parts = []
    if row['street']:
        addr = row['street']
        if row['street_number']:
            addr += ', ' + row['street_number']
        parts.append(addr)
    if row['neighborhood']:
        parts.append(row['neighborhood'])
    return ', '.join(parts) or None

def main():
    print("Buscando clientes do servidor de produção via SSH...")
    clients = fetch_clients()
    print(f"  {len(clients)} clientes encontrados.")

    dst = sqlite3.connect(DST_PATH)

    imported = 0
    skipped  = 0
    phone_conflict = 0

    for c in clients:
        first_name, last_name = split_name(c['name'])
        phone   = normalize_phone(c['phone'])
        address = build_address(c)

        # Verifica duplicata por nome
        existing = dst.execute(
            "SELECT id FROM clients WHERE first_name=? AND last_name=?",
            (first_name, last_name)
        ).fetchone()
        if existing:
            skipped += 1
            continue

        # Verifica conflito de telefone
        if phone:
            phone_exists = dst.execute(
                "SELECT id FROM clients WHERE phone=?", (phone,)
            ).fetchone()
            if phone_exists:
                phone = None  # importa sem telefone para não bloquear
                phone_conflict += 1

        full = f"{first_name} {last_name}".strip()
        dst.execute(
            "INSERT INTO clients (name, first_name, last_name, phone, address, created_at) "
            "VALUES (?,?,?,?,?,datetime('now'))",
            (full, first_name, last_name, phone, address)
        )
        imported += 1

    dst.commit()
    dst.close()

    print(f"\nResultado:")
    print(f"  Importados:              {imported}")
    print(f"  Ignorados (duplicados):  {skipped}")
    print(f"  Telefone removido (conflito): {phone_conflict}")

if __name__ == '__main__':
    main()
