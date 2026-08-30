def _text(response):
    return response.data.decode("utf-8")


def test_servicos_list_loads(client):
    response = client.get("/servicos/")
    assert response.status_code == 200
    assert "Serviços" in _text(response)


def test_servico_create_and_list(client):
    response = client.post(
        "/servicos/novo",
        data={
            "name": "Lavagem Teste",
            "description": "Servico de teste",
            "category": "lavagem",
            "unit_price": "25.50",
            "unit": "kg",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Lavagem Teste" in text
    assert "R$ 25,50" in text
    assert "Serviço cadastrado" in text


def test_servico_requires_entry_default(client):
    client.post(
        "/servicos/novo",
        data={
            "name": "Passadoria",
            "unit_price": "10",
            "requires_entry": "1",
            "entry_pct": "30",
        },
        follow_redirects=True,
    )
    response = client.get("/servicos/")
    text = _text(response)
    assert "Passadoria" in text
    assert "Sim (30%)" in text


def test_servico_inativar(client):
    client.post(
        "/servicos/novo",
        data={"name": "Inativar Teste", "unit_price": "5"},
        follow_redirects=True,
    )

    with client.application.app_context():
        from app.db import get
        row = get(
            "SELECT id FROM services WHERE name=?",
            ("Inativar Teste",),
        )
    assert row
    servico_id = row["id"]

    response = client.post(
        f"/servicos/{servico_id}/excluir",
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Serviço inativado" in text
    assert "Inativar Teste" not in text

    # Ao mostrar inativos, deve aparecer
    response = client.get(f"/servicos/?inativos=1")
    assert "Inativar Teste" in _text(response)
