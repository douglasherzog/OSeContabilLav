import sqlite3
from app.config import DATABASE_PATH


def get_db():
    """Retorna uma conexão SQLite configurada com row_factory=dict."""
    conn = sqlite3.connect(DATABASE_PATH)
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
