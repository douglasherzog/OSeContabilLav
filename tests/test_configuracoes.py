def _text(response):
    return response.data.decode("utf-8")


def test_configuracoes_page_loads(client):
    response = client.get("/configuracoes/")
    assert response.status_code == 200
    assert "Configurações" in _text(response)
    assert "Dados da Empresa" in _text(response)


def test_update_company(client):
    response = client.post(
        "/configuracoes/empresa",
        data={
            "business_name": "Lavanderia Teste",
            "trading_name": "Lava Bem",
            "cnpj": "12.345.678/0001-00",
            "phone": "(51) 99999-9999",
            "address": "Rua A, 123",
            "city": "Porto Alegre",
            "state": "RS",
            "zip": "90000-000",
            "email": "contato@lavabem.com",
            "receipt_header": "Bem-vindo",
            "receipt_footer": "Obrigado",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Configurações da empresa salvas" in _text(response)
    assert "Lavanderia Teste" in _text(response)


def test_create_payment_method(client):
    response = client.post(
        "/configuracoes/metodos",
        data={"name": "boleto", "active": "1"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Método adicionado" in _text(response)
    assert "boleto" in _text(response)


def test_create_and_inactivate_bank_account(client, app):
    response = client.post(
        "/configuracoes/contas",
        data={
            "label": "Nubank",
            "bank_name": "Nu",
            "agency": "0001",
            "account_number": "12345-6",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Conta bancária adicionada" in _text(response)
    assert "Nubank" in _text(response)

    with app.app_context():
        from app.db import get
        row = get("SELECT id FROM bank_accounts WHERE label=?", ("Nubank",))
    account_id = row["id"]

    response = client.post(
        f"/configuracoes/contas/{account_id}/excluir",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Conta inativada" in _text(response)
