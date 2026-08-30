from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.db import get, query, execute, insert
from app.utils import now_local, today, add_interval, add_months
from app.helpers import coerce_float, normalize_method, default_account

bp = Blueprint("contas", __name__, url_prefix="/contas")


def _form_context(kind, item=None, categories=None):
    return {
        "kind": kind,
        "item": item,
        "categories": categories or [],
        "today": today(),
        "now_time": now_local()[11:16],
    }


def _ensure_recurrences(kind, max_date):
    """Gera contas pendentes a partir de recorrências ativas."""
    recs = query(
        f"""SELECT * FROM {kind}_recurrences
        WHERE active=1 AND next_due_date<=?
        ORDER BY next_due_date ASC""",
        (max_date,),
    )
    for r in recs:
        next_due = r["next_due_date"]
        max_count = r["installments_count"] if r["recurrence_type"] == "installments" else 0
        created_count = 0
        if max_count > 0:
            row = get(
                f"SELECT COUNT(1) as c FROM {kind} WHERE recurrence_id=?",
                (r["id"],),
            )
            created_count = row["c"] if row else 0
        loop_limit = (
            r["end_date"]
            if r["recurrence_type"] == "installments" and r["end_date"] and r["end_date"] > max_date
            else max_date
        )
        while next_due and next_due <= loop_limit:
            if max_count > 0 and created_count >= max_count:
                execute(f"UPDATE {kind}_recurrences SET active=0 WHERE id=?", (r["id"],))
                break
            if r["end_date"] and next_due > r["end_date"]:
                execute(f"UPDATE {kind}_recurrences SET active=0 WHERE id=?", (r["id"],))
                break
            exists = get(
                f"SELECT id FROM {kind} WHERE recurrence_id=? AND due_date=? LIMIT 1",
                (r["id"], next_due),
            )
            if not exists:
                insert(
                    f"""INSERT INTO {kind}
                    (description, category, amount, due_date, status, note, created_at, recurrence_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        r["description"],
                        r["category"] or "geral",
                        r["amount"] or 0,
                        next_due,
                        "pendente",
                        r["note"] or None,
                        now_local(),
                        r["id"],
                    ),
                )
                if max_count > 0:
                    created_count += 1
            next_due = add_interval(next_due, r["interval_value"], r["interval_unit"])
            execute(
                f"UPDATE {kind}_recurrences SET next_due_date=? WHERE id=?",
                (next_due, r["id"]),
            )


def _list_kind(kind, status, date_from, date_to):
    limit = add_months(today(), 2) if (not date_to or date_to > today()) else date_to
    _ensure_recurrences(kind, limit)

    sql = f"SELECT * FROM {kind} WHERE 1=1"
    params = []
    if status:
        sql += " AND status=?"
        params.append(status)
    if date_from:
        sql += " AND due_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND due_date<=?"
        params.append(date_to)
    sql += " ORDER BY due_date ASC, id DESC"
    return query(sql, tuple(params))


def _categories(kind):
    return [r["name"] for r in query(f"SELECT name FROM {kind}_categories ORDER BY name ASC")]


def _create_category(kind, name):
    if not name:
        return False
    try:
        insert(
            f"INSERT OR IGNORE INTO {kind}_categories (name, created_at) VALUES (?, ?)",
            (name.strip().lower().replace(" ", "_"), now_local()),
        )
        return True
    except Exception:
        return False


def _save_payment(kind, item, status, amount, description, category, form):
    field = "paid_at" if kind == "accounts_payable" else "received_at"
    m = normalize_method(form.get("method"))
    acc = default_account(m, form.get("account_label"))
    if m != "dinheiro" and not str(acc).strip():
        raise ValueError("Selecione uma conta/banco quando o método não for dinheiro.")
    timestamp = form.get(field) or (today() + " " + now_local()[11:16])
    prefix = "Conta" if kind == "accounts_payable" else "Recebimento"
    cash_id = insert(
        """INSERT INTO cash_ledger
        (occurred_at, amount, method, account_label, category, description, source_type, source_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            timestamp,
            -(amount or 0) if kind == "accounts_payable" else (amount or 0),
            m,
            acc,
            category or "contas",
            f"{prefix}: {description}",
            "ap" if kind == "accounts_payable" else "ar",
            item["id"],
            now_local(),
        ),
    )
    execute(
        f"UPDATE {kind} SET source_type=?, source_id=? WHERE id=?",
        ("ap" if kind == "accounts_payable" else "ar", cash_id, item["id"]),
    )
    return cash_id


# ── Contas a Pagar ───────────────────────────────────────────────────────────


@bp.route("/pagar/")
def ap_list():
    status = request.args.get("status")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    items = _list_kind("accounts_payable", status, date_from, date_to)
    return render_template(
        "contas/list.html",
        kind="pagar",
        title="Contas a Pagar",
        items=items,
        statuses=["pendente", "paga"],
        selected_status=status,
        date_from=date_from,
        date_to=date_to,
        categories=_categories("ap"),
        today=today(),
    )


@bp.route("/pagar/categorias/nova", methods=["POST"])
def ap_create_category():
    if _create_category("ap", request.form.get("name")):
        flash("Categoria adicionada.", "success")
    else:
        flash("Erro ao adicionar categoria.", "error")
    return redirect(url_for("contas.ap_list"))


@bp.route("/pagar/categorias/<name>/excluir", methods=["POST"])
def ap_delete_category(name):
    execute("DELETE FROM ap_categories WHERE name=?", (name,))
    flash("Categoria removida.", "success")
    return redirect(url_for("contas.ap_list"))


@bp.route("/pagar/nova", methods=["GET", "POST"])
def ap_create():
    categories = _categories("ap")
    if request.method == "POST":
        description = request.form.get("description", "").strip()
        if not description:
            flash("Informe a descrição.", "error")
            return render_template("contas/form.html", **_form_context("pagar", None, categories))

        category = request.form.get("category") or "geral"
        amount = coerce_float(request.form.get("amount"))
        due_date = request.form.get("due_date") or None
        note = request.form.get("note") or None

        # Parcelas customizadas
        installments = []
        idx = 0
        while f"installment_due_date_{idx}" in request.form:
            d = request.form.get(f"installment_due_date_{idx}")
            a = coerce_float(request.form.get(f"installment_amount_{idx}"))
            if d:
                installments.append((d, a))
            idx += 1

        if installments:
            for inst in installments:
                insert(
                    "INSERT INTO accounts_payable (description, category, amount, due_date, note) VALUES (?, ?, ?, ?, ?)",
                    (description, category, inst[1], inst[0], note),
                )
            flash(f"{len(installments)} parcelas adicionadas.", "success")
            return redirect(url_for("contas.ap_list"))

        # Recorrência
        if request.form.get("has_recurrence") and request.form.get("start_date"):
            start = request.form.get("start_date")
            rec_type = request.form.get("recurrence_type") or "variable"
            inst_count = request.form.get("installments_count") or None
            rec_id = insert(
                """INSERT INTO accounts_payable_recurrences
                (description, category, amount, note, start_date, interval_value, interval_unit, end_date,
                 next_due_date, recurrence_type, installments_count, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    description,
                    category,
                    amount,
                    note,
                    start,
                    request.form.get("interval_value") or 1,
                    request.form.get("interval_unit") or "month",
                    request.form.get("end_date") or None,
                    start,
                    rec_type,
                    inst_count,
                    1,
                    now_local(),
                ),
            )
            _ensure_recurrences("accounts_payable", start)
            flash("Recorrência criada.", "success")
            return redirect(url_for("contas.ap_list"))

        # Simples
        insert(
            "INSERT INTO accounts_payable (description, category, amount, due_date, note) VALUES (?, ?, ?, ?, ?)",
            (description, category, amount, due_date, note),
        )
        flash("Conta a pagar adicionada.", "success")
        return redirect(url_for("contas.ap_list"))

    return render_template("contas/form.html", **_form_context("pagar", None, categories))


@bp.route("/pagar/<int:id>/editar", methods=["GET", "POST"])
def ap_update(id):
    item = get("SELECT * FROM accounts_payable WHERE id=?", (id,))
    if not item:
        flash("Conta não encontrada.", "error")
        return redirect(url_for("contas.ap_list"))

    categories = _categories("ap")
    if request.method == "POST":
        description = request.form.get("description", "").strip()
        if not description:
            flash("Informe a descrição.", "error")
            return render_template("contas/form.html", **_form_context("pagar", item, categories))

        status = request.form.get("status", "pendente")
        category = request.form.get("category") or "geral"
        amount = coerce_float(request.form.get("amount"))
        due_date = request.form.get("due_date") or None
        note = request.form.get("note") or None

        # Marcar paga -> gera caixa
        if status == "paga" and item["status"] != "paga":
            try:
                _save_payment("accounts_payable", item, status, amount, description, category, request.form)
            except ValueError as e:
                flash(str(e), "error")
                return render_template("contas/form.html", **_form_context("pagar", item, categories))
        elif status == "pendente" and item["status"] == "paga" and item.get("source_id"):
            execute("DELETE FROM cash_ledger WHERE id=?", (item["source_id"],))
            execute("UPDATE accounts_payable SET source_type='ap', source_id=NULL WHERE id=?", (id,))

        m = normalize_method(request.form.get("method")) or item.get("method")
        acc = default_account(m, request.form.get("account_label") or item.get("account_label"))
        execute(
            """UPDATE accounts_payable SET
            description=?, category=?, amount=?, due_date=?, note=?, status=?, paid_at=?,
            method=?, account_label=?
            WHERE id=?""",
            (description, category, amount, due_date, note, status, request.form.get("paid_at") or item.get("paid_at"), m, acc, id),
        )
        flash("Conta atualizada.", "success")
        return redirect(url_for("contas.ap_list"))

    return render_template("contas/form.html", **_form_context("pagar", item, categories))


@bp.route("/pagar/<int:id>/excluir", methods=["POST"])
def ap_delete(id):
    item = get("SELECT * FROM accounts_payable WHERE id=?", (id,))
    if item and item.get("source_id"):
        execute("DELETE FROM cash_ledger WHERE id=?", (item["source_id"],))
    execute("DELETE FROM accounts_payable WHERE id=?", (id,))
    flash("Conta excluída.", "success")
    return redirect(url_for("contas.ap_list"))


# ── Contas a Receber ─────────────────────────────────────────────────────────


@bp.route("/receber/")
def ar_list():
    status = request.args.get("status")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    items = _list_kind("accounts_receivable", status, date_from, date_to)
    return render_template(
        "contas/list.html",
        kind="receber",
        title="Contas a Receber",
        items=items,
        statuses=["pendente", "recebida"],
        selected_status=status,
        date_from=date_from,
        date_to=date_to,
        categories=_categories("ar"),
        today=today(),
    )


@bp.route("/receber/categorias/nova", methods=["POST"])
def ar_create_category():
    if _create_category("ar", request.form.get("name")):
        flash("Categoria adicionada.", "success")
    else:
        flash("Erro ao adicionar categoria.", "error")
    return redirect(url_for("contas.ar_list"))


@bp.route("/receber/categorias/<name>/excluir", methods=["POST"])
def ar_delete_category(name):
    execute("DELETE FROM ar_categories WHERE name=?", (name,))
    flash("Categoria removida.", "success")
    return redirect(url_for("contas.ar_list"))


@bp.route("/receber/nova", methods=["GET", "POST"])
def ar_create():
    categories = _categories("ar")
    if request.method == "POST":
        description = request.form.get("description", "").strip()
        if not description:
            flash("Informe a descrição.", "error")
            return render_template("contas/form.html", **_form_context("receber", None, categories))

        category = request.form.get("category") or "geral"
        amount = coerce_float(request.form.get("amount"))
        due_date = request.form.get("due_date") or None
        note = request.form.get("note") or None

        installments = []
        idx = 0
        while f"installment_due_date_{idx}" in request.form:
            d = request.form.get(f"installment_due_date_{idx}")
            a = coerce_float(request.form.get(f"installment_amount_{idx}"))
            if d:
                installments.append((d, a))
            idx += 1

        if installments:
            for inst in installments:
                insert(
                    "INSERT INTO accounts_receivable (description, category, amount, due_date, note) VALUES (?, ?, ?, ?, ?)",
                    (description, category, inst[1], inst[0], note),
                )
            flash(f"{len(installments)} parcelas adicionadas.", "success")
            return redirect(url_for("contas.ar_list"))

        if request.form.get("has_recurrence") and request.form.get("start_date"):
            start = request.form.get("start_date")
            rec_type = request.form.get("recurrence_type") or "variable"
            inst_count = request.form.get("installments_count") or None
            insert(
                """INSERT INTO accounts_receivable_recurrences
                (description, category, amount, note, start_date, interval_value, interval_unit, end_date,
                 next_due_date, recurrence_type, installments_count, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    description,
                    category,
                    amount,
                    note,
                    start,
                    request.form.get("interval_value") or 1,
                    request.form.get("interval_unit") or "month",
                    request.form.get("end_date") or None,
                    start,
                    rec_type,
                    inst_count,
                    1,
                    now_local(),
                ),
            )
            _ensure_recurrences("accounts_receivable", start)
            flash("Recorrência criada.", "success")
            return redirect(url_for("contas.ar_list"))

        insert(
            "INSERT INTO accounts_receivable (description, category, amount, due_date, note) VALUES (?, ?, ?, ?, ?)",
            (description, category, amount, due_date, note),
        )
        flash("Conta a receber adicionada.", "success")
        return redirect(url_for("contas.ar_list"))

    return render_template("contas/form.html", **_form_context("receber", None, categories))


@bp.route("/receber/<int:id>/editar", methods=["GET", "POST"])
def ar_update(id):
    item = get("SELECT * FROM accounts_receivable WHERE id=?", (id,))
    if not item:
        flash("Conta não encontrada.", "error")
        return redirect(url_for("contas.ar_list"))

    categories = _categories("ar")
    if request.method == "POST":
        description = request.form.get("description", "").strip()
        if not description:
            flash("Informe a descrição.", "error")
            return render_template("contas/form.html", **_form_context("receber", item, categories))

        status = request.form.get("status", "pendente")
        category = request.form.get("category") or "geral"
        amount = coerce_float(request.form.get("amount"))
        due_date = request.form.get("due_date") or None
        note = request.form.get("note") or None

        if status == "recebida" and item["status"] != "recebida":
            try:
                _save_payment("accounts_receivable", item, status, amount, description, category, request.form)
            except ValueError as e:
                flash(str(e), "error")
                return render_template("contas/form.html", **_form_context("receber", item, categories))
        elif status == "pendente" and item["status"] == "recebida" and item.get("source_id"):
            execute("DELETE FROM cash_ledger WHERE id=?", (item["source_id"],))
            execute("UPDATE accounts_receivable SET source_type='ar', source_id=NULL WHERE id=?", (id,))

        m = normalize_method(request.form.get("method")) or item.get("method")
        acc = default_account(m, request.form.get("account_label") or item.get("account_label"))
        execute(
            """UPDATE accounts_receivable SET
            description=?, category=?, amount=?, due_date=?, note=?, status=?, received_at=?,
            method=?, account_label=?
            WHERE id=?""",
            (description, category, amount, due_date, note, status, request.form.get("received_at") or item.get("received_at"), m, acc, id),
        )
        flash("Conta atualizada.", "success")
        return redirect(url_for("contas.ar_list"))

    return render_template("contas/form.html", **_form_context("receber", item, categories))


@bp.route("/receber/<int:id>/excluir", methods=["POST"])
def ar_delete(id):
    item = get("SELECT * FROM accounts_receivable WHERE id=?", (id,))
    if item and item.get("source_id"):
        execute("DELETE FROM cash_ledger WHERE id=?", (item["source_id"],))
    execute("DELETE FROM accounts_receivable WHERE id=?", (id,))
    flash("Conta excluída.", "success")
    return redirect(url_for("contas.ar_list"))
