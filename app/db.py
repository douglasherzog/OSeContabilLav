import sqlite3
from flask import current_app
from app.config import DATABASE_PATH


def get_db_path():
    """Retorna o caminho do banco, priorizando a config do app."""
    if current_app:
        return current_app.config.get("DATABASE_PATH", DATABASE_PATH)
    return DATABASE_PATH


def get_db():
    """Retorna uma conexão SQLite configurada com row_factory=dict."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def query(sql, params=()):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall()


def get(sql, params=()):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None


def execute(sql, params=()):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.rowcount


def insert(sql, params=()):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid


def count(sql, params=()):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchone()[0]


def paginated_query(base_sql, base_params, page=1, per_page=20):
    page = max(1, page)
    offset = (page - 1) * per_page
    sql = f"{base_sql} LIMIT ? OFFSET ?"
    params = list(base_params) + [per_page, offset]
    total = count(f"SELECT COUNT(*) FROM ({base_sql}) q", base_params)
    return query(sql, tuple(params)), total, page, per_page
