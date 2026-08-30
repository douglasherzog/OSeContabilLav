from app.db import get


def test_dashboard_page(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Painel" in response.data
    text = response.data.decode("utf-8")
    assert "OS Abertas" in text
    assert "Clientes" in text
    assert "Receita Mês" in text
    assert "Saldo Mês" in text
    assert b"OS Abertas" in response.data
