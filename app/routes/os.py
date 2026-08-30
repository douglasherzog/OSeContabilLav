from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.db import get, query, execute, insert
from app.utils import now_local, today, money, normalize_phone

bp = Blueprint("os", __name__, url_prefix="/os")

STATUSES = ["aberta", "pronta", "entregue", "entregue_pendente"]
METHODS = ["dinheiro", "pix", "debito", "credito"]
WHEN_TYPES = ["entrada", "apos_entrada", "retirada", "apos_retirada"]


def _coerce_float(value, default=0):
    try:
        return float(value) if value is not None and str(value).strip() != "" else default
    except (ValueError, TypeError):
        return default


def _recalc_order(order_id):
    """Recalcula total, pago e status de pagamento da OS."""
    total = get(
        "SELECT COALESCE(SUM(total), 0) as s FROM os_items WHERE order_id=?",
        (order_id,),
    )["s"]
    paid = get(
        "SELECT COALESCE(SUM(amount), 0) as s FROM os_payments WHERE order_id=?",
        (order_id,),
    )["s"]
    rem = max(0, total - paid)
    status = "quitado" if rem <= 0.01 else "em_aberto"
    execute(
        "UPDATE service_orders SET total=?, paid=?, payment_status=? WHERE id=?",
        (total, paid, status, order_id),
    )


@bp.route("/")
def list():
    status = request.args.get("status")
    q = request.args.get("q", "").strip()
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    client = request.args.get("client", "").strip()
    remaining_only = request.args.get("restante")

    sql = """SELECT so.*,
        c.first_name || ' ' || c.last_name as client_name,
        COALESCE(p.paid, 0) as paid,
        so.total - COALESCE(p.paid, 0) as remaining
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        LEFT JOIN (SELECT order_id, SUM(amount) as paid FROM os_payments GROUP BY order_id) p ON p.order_id = so.id
        WHERE 1=1"""
    params = []

    if status and status in STATUSES:
        sql += " AND so.status=?"
        params.append(status)
    if date_from:
        sql += " AND (so.created_at IS NULL OR so.created_at>=?)"
        params.append(date_from)
    if date_to:
        sql += " AND (so.created_at IS NULL OR so.created_at<=?)"
        params.append(date_to + " 23:59:59")
    if q:
        like = f"%{q}%"
        sql += """ AND ((c.first_name || ' ' || c.last_name) LIKE ? OR CAST(so.number AS TEXT) LIKE ? OR so.note LIKE ?)"""
        params.extend([like, like, like])
    if client:
        like = f"%{client}%"
        sql += " AND (c.first_name || ' ' || c.last_name) LIKE ?"
        params.append(like)
    if remaining_only:
        sql += " AND (so.total - COALESCE(p.paid, 0)) > 0.01"
    sql += " ORDER BY so.created_at DESC, so.id DESC"

    orders = query(sql, tuple(params))
    clients = query(
        "SELECT id, first_name || ' ' || last_name as name FROM clients ORDER BY first_name, last_name"
    )
    return render_template(
        "os/list.html",
        orders=orders,
        statuses=STATUSES,
        selected_status=status,
        q=q,
        date_from=date_from,
        date_to=date_to,
        client=client,
        remaining_only=remaining_only,
        all_clients=clients,
    )


@bp.route("/novo", methods=["GET", "POST"])
def create():
    clients = query(
        "SELECT id, first_name || ' ' || last_name as name FROM clients ORDER BY first_name, last_name"
    )
    if request.method == "POST":
        client_id = request.form.get("client_id")
        if not client_id:
            flash("Selecione o cliente.", "error")
            return render_template("os/form.html", clients=clients, os=None)

        mx = get("SELECT MAX(number) as m FROM service_orders")
        num = (mx["m"] or 0) + 1
        status = request.form.get("status", "aberta")
        note = request.form.get("note") or None
        assigned_to = request.form.get("assigned_to") or None
        n = now_local()

        os_id = insert(
            "INSERT INTO service_orders (number, client_id, status, total, note, assigned_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (num, client_id, status, 0, note, assigned_to, n, n),
        )
        flash("Ordem de serviço criada.", "success")
        return redirect(url_for("os.detail", id=os_id))

    return render_template("os/form.html", clients=clients, os=None)


@bp.route("/<int:id>")
def detail(id):
    o = get(
        """SELECT so.*,
        c.first_name || ' ' || c.last_name as client_name,
        c.phone as client_phone
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        WHERE so.id=?""",
        (id,),
    )
    if not o:
        flash("OS não encontrada.", "error")
        return redirect(url_for("os.list"))

    o["order_items"] = query("SELECT * FROM os_items WHERE order_id=?", (id,))
    o["order_payments"] = query(
        "SELECT * FROM os_payments WHERE order_id=? ORDER BY created_at ASC", (id,)
    )

    services = query(
        "SELECT * FROM services WHERE active=1 ORDER BY category, name"
    )
    return render_template(
        "os/detail.html",
        os=o,
        statuses=STATUSES,
        methods=METHODS,
        when_types=WHEN_TYPES,
        services=services,
        today=today(),
    )


@bp.route("/<int:id>/editar", methods=["GET", "POST"])
def update(id):
    o = get("SELECT * FROM service_orders WHERE id=?", (id,))
    if not o:
        flash("OS não encontrada.", "error")
        return redirect(url_for("os.list"))

    clients = query(
        "SELECT id, first_name || ' ' || c.last_name as name FROM clients ORDER BY first_name, last_name"
    )

    if request.method == "POST":
        status = request.form.get("status", "aberta")
        note = request.form.get("note") or None
        assigned_to = request.form.get("assigned_to") or None
        execute(
            "UPDATE service_orders SET status=?, note=?, assigned_to=?, updated_at=? WHERE id=?",
            (status, note, assigned_to, now_local(), id),
        )
        flash("OS atualizada.", "success")
        return redirect(url_for("os.detail", id=id))

    return render_template("os/form.html", clients=clients, os=o)


@bp.route("/<int:id>/excluir", methods=["POST"])
def delete(id):
    payments = query("SELECT id FROM os_payments WHERE order_id=?", (id,))
    for p in payments:
        execute(
            "DELETE FROM cash_ledger WHERE source_type='os' AND source_id=?",
            (p["id"],),
        )
    execute("DELETE FROM os_payments WHERE order_id=?", (id,))
    execute("DELETE FROM os_items WHERE order_id=?", (id,))
    execute("DELETE FROM service_orders WHERE id=?", (id,))
    flash("OS excluída.", "success")
    return redirect(url_for("os.list"))


@bp.route("/<int:order_id>/itens/adicionar", methods=["POST"])
def add_item(order_id):
    description = request.form.get("description", "").strip()
    if not description:
        flash("Informe a descrição do item.", "error")
        return redirect(url_for("os.detail", id=order_id))

    quantity = _coerce_float(request.form.get("quantity"), 1)
    unit_price = _coerce_float(request.form.get("unit_price"))
    total = quantity * unit_price

    svc = get(
        "SELECT requires_entry, entry_pct FROM services WHERE name=? AND active=1 LIMIT 1",
        (description,),
    )
    requires_entry = 1 if request.form.get("requires_entry") else (svc["requires_entry"] if svc else 0)
    entry_pct = _coerce_float(request.form.get("entry_pct"), (svc["entry_pct"] if svc else 50))

    insert(
        "INSERT INTO os_items (order_id, description, quantity, unit_price, total, requires_entry, entry_pct) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (order_id, description, quantity, unit_price, total, 1 if requires_entry else 0, entry_pct),
    )
    _recalc_order(order_id)
    flash("Item adicionado.", "success")
    return redirect(url_for("os.detail", id=order_id))


@bp.route("/<int:order_id>/itens/<int:item_id>/excluir", methods=["POST"])
def delete_item(order_id, item_id):
    execute("DELETE FROM os_items WHERE id=?", (item_id,))
    _recalc_order(order_id)
    flash("Item removido.", "success")
    return redirect(url_for("os.detail", id=order_id))


@bp.route("/<int:order_id>/pagamentos/adicionar", methods=["POST"])
def add_payment(order_id):
    amount = _coerce_float(request.form.get("amount"))
    if amount <= 0:
        flash("Informe um valor maior que zero.", "error")
        return redirect(url_for("os.detail", id=order_id))

    method = request.form.get("method", "dinheiro").strip().lower()
    account_label = request.form.get("account_label") or ""
    if method != "dinheiro" and not account_label.strip():
        flash("Selecione uma conta/banco quando o método de pagamento não for dinheiro.", "error")
        return redirect(url_for("os.detail", id=order_id))

    account_label = account_label if account_label.strip() else ("Caixa" if method == "dinheiro" else "")
    payment_date = request.form.get("payment_date") or today()
    when_type = request.form.get("when_type", "retirada")
    note = request.form.get("note") or None

    payment_id = insert(
        "INSERT INTO os_payments (order_id, amount, method, account_label, when_type, payment_date, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (order_id, amount, method, account_label, when_type, payment_date, note),
    )
    _recalc_order(order_id)

    o = get(
        """SELECT so.number, c.first_name || ' ' || c.last_name as client_name
        FROM service_orders so
        LEFT JOIN clients c ON c.id=so.client_id
        WHERE so.id=?""",
        (order_id,),
    )
    desc = f"OS #{o['number']} — {o['client_name'] or 'cliente'}"
    occurred_at = payment_date + " " + now_local()[11:16]
    insert(
        "INSERT INTO cash_ledger (occurred_at, amount, method, account_label, category, description, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (occurred_at, amount, method, account_label, "os_pagamento", desc, "os", payment_id, now_local()),
    )

    flash("Pagamento registrado.", "success")
    return redirect(url_for("os.detail", id=order_id))


@bp.route("/<int:order_id>/pagamentos/<int:payment_id>/excluir", methods=["POST"])
def delete_payment(order_id, payment_id):
    execute("DELETE FROM os_payments WHERE id=?", (payment_id,))
    execute("DELETE FROM cash_ledger WHERE source_type='os' AND source_id=?", (payment_id,))
    _recalc_order(order_id)
    flash("Pagamento removido.", "success")
    return redirect(url_for("os.detail", id=order_id))
