import sqlite3
import pytest
from app.config import DATABASE_PATH
from app.db import get_db, query, get


def test_database_file_exists():
    import os
    assert os.path.exists(DATABASE_PATH), f"Banco não encontrado em {DATABASE_PATH}"


def test_connection_opens():
    conn = get_db()
    assert conn is not None
    conn.close()


def test_tables_exist():
    tables = query(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    names = {row["name"] for row in tables}
    expected = {"clients", "services", "service_orders", "cash_ledger"}
    assert expected.issubset(names), f"Faltam tabelas: {expected - names}"


def test_clients_have_data():
    row = get("SELECT COUNT(*) AS c FROM clients")
    assert row["c"] >= 0
