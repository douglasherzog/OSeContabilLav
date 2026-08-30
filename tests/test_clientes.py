import re


def _text(response):
    return response.data.decode("utf-8")


def test_clientes_list_loads(client):
    response = client.get("/clientes/")
    assert response.status_code == 200
    assert "Clientes" in _text(response)


def test_cliente_create_and_list(client):
    response = client.post(
        "/clientes/novo",
        data={
            "first_name": "Maria",
            "last_name": "Silva",
            "phone": "11999999999",
            "email": "maria@teste.com",
            "address": "Rua A",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Maria Silva" in text
    assert "Cliente cadastrado" in text


def test_cliente_phone_normalized(client):
    client.post(
        "/clientes/novo",
        data={
            "first_name": "Joao",
            "last_name": "Teste",
            "phone": "(11) 91234-5678",
        },
        follow_redirects=True,
    )
    response = client.get("/clientes/")
    text = _text(response)
    assert "+5511912345678" in text


def test_cliente_update(client):
    client.post(
        "/clientes/novo",
        data={"first_name": "Ana", "last_name": "Paula"},
        follow_redirects=True,
    )
    response = client.get("/clientes/")
    text = _text(response)
    match = re.search(r'href="/clientes/(\d+)/editar"', text)
    assert match, "Link de edicao nao encontrado"
    cliente_id = match.group(1)

    response = client.post(
        f"/clientes/{cliente_id}/editar",
        data={
            "first_name": "Ana",
            "last_name": "Paula Souza",
            "phone": "",
            "email": "",
            "address": "",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Ana Paula Souza" in _text(response)


def test_cliente_delete(client):
    client.post(
        "/clientes/novo",
        data={"first_name": "Deletar", "last_name": "Teste"},
        follow_redirects=True,
    )
    response = client.get("/clientes/")
    text = _text(response)
    assert "Deletar Teste" in text

    # Localiza o ID do cliente recém-criado consultando o banco
    with client.application.app_context():
        from app.db import get
        row = get(
            "SELECT id FROM clients WHERE first_name=? AND last_name=?",
            ("Deletar", "Teste"),
        )
    assert row, "Cliente nao encontrado no banco"
    cliente_id = row["id"]

    response = client.post(
        f"/clientes/{cliente_id}/excluir",
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Cliente excluído" in text
    assert "Deletar Teste" not in text
