from app.db import get


def test_dashboard_page(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Painel" in response.data
    assert b"OS Abertas" in response.data
