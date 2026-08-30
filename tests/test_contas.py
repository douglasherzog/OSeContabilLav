def _text(response):
    return response.data.decode("utf-8")


def _last_id(app, table):
    with app.app_context():
        from app.db import get
        row = get(f"SELECT id FROM {table} ORDER BY id DESC LIMIT 1")
        return row["id"]


def test_ap_list_loads(client):
    response = client.get("/contas/pagar/")
    assert response.status_code == 200
    assert "Contas a Pagar" in _text(response)


def test_ar_list_loads(client):
    response = client.get("/contas/receber/")
    assert response.status_code == 200
    assert "Contas a Receber" in _text(response)


def test_ap_create_and_mark_paid(client, app):
    response = client.post(
        "/contas/pagar/nova",
        data={
            "description": "Aluguel",
            "amount": "1200",
            "due_date": "2026-08-30",
            "category": "geral",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Conta a pagar adicionada" in text
    assert "Aluguel" in text
    assert "R$ 1.200,00" in text

    ap_id = _last_id(app, "accounts_payable")
    response = client.post(
        f"/contas/pagar/{ap_id}/editar",
        data={
            "description": "Aluguel",
            "amount": "1200",
            "due_date": "2026-08-30",
            "status": "paga",
            "method": "dinheiro",
            "category": "geral",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "Conta atualizada" in text
    assert "paga" in text

    # Confere caixa
    response = client.get("/caixa/")
    assert "Conta: Aluguel" in _text(response)


def test_ap_payment_requires_account(client, app):
    client.post(
        "/contas/pagar/nova",
        data={"description": "Fornecedor", "amount": "300", "due_date": "2026-08-30"},
        follow_redirects=True,
    )
    ap_id = _last_id(app, "accounts_payable")
    response = client.post(
        f"/contas/pagar/{ap_id}/editar",
        data={
            "description": "Fornecedor",
            "amount": "300",
            "due_date": "2026-08-30",
            "status": "paga",
            "method": "credito",
            "account_label": "",
            "category": "geral",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Selecione uma conta/banco" in _text(response)


def test_ar_create_and_installments(client, app):
    response = client.post(
        "/contas/receber/nova",
        data={
            "description": "Mensalidade",
            "amount": "500",
            "installment_due_date_0": "2026-09-01",
            "installment_amount_0": "200",
            "installment_due_date_1": "2026-10-01",
            "installment_amount_1": "300",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    text = _text(response)
    assert "2 parcelas adicionadas" in text
    assert "Mensalidade" in text
