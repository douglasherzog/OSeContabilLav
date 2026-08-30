import re


def _text(response):
    return response.data.decode("utf-8")


def _create_client(client, app):
    with app.app_context():
        from app.db import insert
        return insert(
            "INSERT INTO clients (first_name, last_name, phone, created_at) VALUES (?, ?, ?, ?)",
            ("Cliente", "OS", None, "2026-01-01 10:00:00"),
        )


def _last_os_id(app):
    with app.app_context():
        from app.db import get
        row = get("SELECT id FROM service_orders ORDER BY id DESC LIMIT 1")
        return row["id"]


def test_os_list_loads(client):
    response = client.get("/os/")
    assert response.status_code == 200
    assert "Ordens de Serviço" in _text(response)


def test_os_create(client, app):
    client_id = _create_client(client, app)
    response = client.post(
        "/os/novo",
        data={"client_id": client_id, "status": "aberta", "note": "Teste"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Ordem de serviço criada" in text
    assert "Cliente OS" in text


def test_os_add_item_and_payment(client, app):
    client_id = _create_client(client, app)
    client.post(
        "/os/novo",
        data={"client_id": client_id, "status": "aberta"},
        follow_redirects=True,
    )
    os_id = _last_os_id(app)

    # Adiciona item
    response = client.post(
        f"/os/{os_id}/itens/adicionar",
        data={"description": "Lavagem", "quantity": "2", "unit_price": "15"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Lavagem" in text
    assert "R$ 30,00" in text

    # Adiciona pagamento
    response = client.post(
        f"/os/{os_id}/pagamentos/adicionar",
        data={
            "amount": "20",
            "method": "dinheiro",
            "payment_date": "2026-08-30",
            "when_type": "retirada",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Pagamento registrado" in text
    assert "R$ 20,00" in text
    assert "R$ 10,00" in text


def test_os_payment_requires_account(client, app):
    client_id = _create_client(client, app)
    client.post(
        "/os/novo",
        data={"client_id": client_id},
        follow_redirects=True,
    )
    os_id = _last_os_id(app)

    response = client.post(
        f"/os/{os_id}/pagamentos/adicionar",
        data={
            "amount": "10",
            "method": "credito",
            "payment_date": "2026-08-30",
            "when_type": "retirada",
            "account_label": "",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Selecione uma conta/banco" in _text(response)
