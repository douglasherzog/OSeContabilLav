import io
import os


def _text(response):
    return response.data.decode("utf-8")


def test_utilitarios_page_loads(client):
    response = client.get("/utilitarios/")
    assert response.status_code == 200
    assert "Utilitários" in _text(response)
    assert "Backup" in _text(response)


def test_repair(client, app):
    with app.app_context():
        from app.db import execute, insert
        insert(
            "INSERT INTO service_orders (number, client_id, status, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (999, None, None, 0, "2026-01-01", "2026-01-01"),
        )
        insert(
            "INSERT INTO cash_ledger (occurred_at, amount, method, account_label, category, description, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("2026-01-01 00:00", 0, None, "", "manual", "x", "manual"),
        )

    response = client.post(
        "/utilitarios/reparar",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Reparo concluído" in _text(response)

    with app.app_context():
        from app.db import get
        o = get("SELECT * FROM service_orders WHERE number=999")
        assert o["status"] == "aberta"
        assert o["payment_status"] == "em_aberto"
        c = get("SELECT * FROM cash_ledger WHERE method='dinheiro'")


def test_normalize_units(client, app):
    with app.app_context():
        from app.db import insert
        insert(
            "INSERT INTO services (name, unit, active, created_at) VALUES (?, ?, ?, ?)",
            ("Lavagem de terno", "un", 1, "2026-01-01"),
        )

    response = client.post(
        "/utilitarios/normalizar-servicos",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "1 serviços normalizados" in _text(response)

    with app.app_context():
        from app.db import get
        s = get("SELECT name FROM services WHERE name LIKE '%terno%'")
        assert s["name"] == "De terno"


def test_import_csv_clientes(client, app):
    csv_content = "name;phone;email\nJoão Silva;51999999999;joao@test.com\nMaria Souza;51888888888;maria@test.com"
    data = {
        "table": "clientes",
        "csv": (io.BytesIO(csv_content.encode("utf-8")), "clientes.csv"),
    }
    response = client.post(
        "/utilitarios/importar-csv",
        data=data,
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "2 registros importados" in _text(response)

    with app.app_context():
        from app.db import get
        row = get("SELECT * FROM clients WHERE phone=?", ("51999999999",))
        assert row
        assert row["first_name"] == "João"
        assert row["last_name"] == "Silva"
