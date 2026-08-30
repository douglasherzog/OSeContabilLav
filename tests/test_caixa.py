import re


def _text(response):
    return response.data.decode("utf-8")


def test_caixa_list_loads(client):
    response = client.get("/caixa/")
    assert response.status_code == 200
    assert "Caixa" in _text(response)


def test_caixa_create_and_list(client):
    response = client.post(
        "/caixa/novo",
        data={
            "occurred_at": "2026-08-30 10:00",
            "amount": "150",
            "method": "dinheiro",
            "category": "manual",
            "description": "Entrada teste",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Lançamento adicionado" in text
    assert "R$ 150,00" in text


def test_caixa_negative_amount(client):
    response = client.post(
        "/caixa/novo",
        data={
            "occurred_at": "2026-08-30 11:00",
            "amount": "-50",
            "method": "dinheiro",
            "category": "manual",
            "description": "Saída teste",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "R$ -50,00" in _text(response)


def test_caixa_non_cash_requires_account(client):
    response = client.post(
        "/caixa/novo",
        data={
            "occurred_at": "2026-08-30 12:00",
            "amount": "100",
            "method": "credito",
            "account_label": "",
            "category": "manual",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Selecione uma conta/banco" in _text(response)


def test_caixa_create_category(client):
    response = client.post(
        "/caixa/categorias/nova",
        data={"name": "Manutenção"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Categoria adicionada" in _text(response)
    assert "manutenção" in _text(response)

    # Categoria reservada não deve ser criada
    response = client.post(
        "/caixa/categorias/nova",
        data={"name": "manual"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Nome reservado" in _text(response)
