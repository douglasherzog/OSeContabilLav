"""
Reseta o banco de dados mantendo apenas clientes e serviços.

- Faz backup automático em data/backups/
- Remove dados de OS, caixa, contas, recorrências e configurações
- Mantém as tabelas clients e services
- Reseta sequência de números de OS

Uso:
    .\\venv\\Scripts\\python scripts\\reset_database.py
"""

import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


def get_db_path():
    from dotenv import load_dotenv
    load_dotenv()
    base = Path(__file__).resolve().parent.parent
    return Path(os.getenv("DATABASE_PATH", str(base / "data" / "osecontabil.db")))


def main():
    db_path = get_db_path()
    if not db_path.exists():
        print(f"Banco não encontrado: {db_path}")
        return

    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_path = backup_dir / f"osecontabil_backup_{timestamp}.db"
    shutil.copy2(db_path, backup_path)
    print(f"Backup criado em {backup_path}")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    tables_to_clear = [
        "service_orders",
        "os_items",
        "os_payments",
        "cash_ledger",
        "accounts_payable",
        "accounts_receivable",
        "accounts_payable_recurrences",
        "accounts_receivable_recurrences",
        "company_settings",
        "cash_categories",
        "ap_categories",
        "ar_categories",
        "payment_methods",
        "bank_accounts",
    ]

    for table in tables_to_clear:
        try:
            cur.execute(f"DELETE FROM {table}")
            print(f"Limpo: {table} ({cur.rowcount} linhas)")
        except sqlite3.OperationalError as e:
            print(f"Aviso: {table} não encontrada ou erro: {e}")

    conn.commit()
    conn.close()
    print("Banco zerado. Clientes e serviços preservados.")


if __name__ == "__main__":
    main()
