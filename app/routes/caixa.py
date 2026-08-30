import re
from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.db import get, query, execute, insert
from app.utils import now_local, today

bp = Blueprint("caixa", __name__, url_prefix="/caixa")

RESERVED_CATS = ["os_pagamento", "ap_pagamento", "ar_recebimento", "manual"]


def _normalize_method(m):
    return (m or "").strip().lower() or "dinheiro"


def _default_account(method, provided):
    if provided and str(provided).strip():
        return provided
    return "Caixa" if method == "dinheiro" else ""


def _coerce_float(value, default=0):
    try:
        return float(value) if value is not None and str(value).strip() != "" else default
    except (ValueError, TypeError):
        return default


def _form_context(categories, entry=None):
    return {
        "entry": entry,
        "categories": categories,
        "today": today(),
        "now_time": now_local()[11:16],
    }


@bp.route("/")
def list():
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    category = request.args.get("category")

    sql = "SELECT * FROM cash_ledger WHERE 1=1"
    params = []
    if date_from:
        sql += " AND occurred_at>=?"
        params.append(date_from)
    if date_to:
        sql += " AND occurred_at<=?"
        params.append(date_to + " 23:59:59")
    if category:
        sql += " AND category=?"
        params.append(category)
    sql += " ORDER BY occurred_at DESC, id DESC"

    entries = query(sql, tuple(params))
    categories = [r["name"] for r in query("SELECT name FROM cash_categories ORDER BY name ASC")]
    return render_template(
        "caixa/list.html",
        entries=entries,
        categories=categories,
        date_from=date_from,
        date_to=date_to,
        selected_category=category,
    )


@bp.route("/categorias/nova", methods=["POST"])
def create_category():
    name = request.form.get("name", "").strip()
    if not name or name.lower() in RESERVED_CATS:
        flash("Nome reservado ou inválido.", "error")
        return redirect(url_for("caixa.list"))
    normalized = re.sub(r"\s+", "_", name.lower())
    try:
        insert(
            "INSERT OR IGNORE INTO cash_categories (name, created_at) VALUES (?, ?)",
            (normalized, now_local()),
        )
        flash("Categoria adicionada.", "success")
    except Exception:
        flash("Erro ao adicionar categoria.", "error")
    return redirect(url_for("caixa.list"))


@bp.route("/categorias/<name>/excluir", methods=["POST"])
def delete_category(name):
    execute("DELETE FROM cash_categories WHERE name=?", (name,))
    flash("Categoria removida.", "success")
    return redirect(url_for("caixa.list"))


@bp.route("/novo", methods=["GET", "POST"])
def create():
    categories = [r["name"] for r in query("SELECT name FROM cash_categories ORDER BY name ASC")]
    if request.method == "POST":
        m = _normalize_method(request.form.get("method"))
        acc = _default_account(m, request.form.get("account_label"))
        if m != "dinheiro" and not str(acc).strip():
            flash("Selecione uma conta/banco quando o método de pagamento não for dinheiro.", "error")
            return render_template("caixa/form.html", **_form_context(categories))

        amount = _coerce_float(request.form.get("amount"))
        occurred_at = request.form.get("occurred_at") or (today() + " " + now_local()[11:16])
        category = request.form.get("category") or "manual"
        description = request.form.get("description") or None

        insert(
            """INSERT INTO cash_ledger
            (occurred_at, amount, method, account_label, category, description, source_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (occurred_at, amount, m, acc, category, description, "manual", now_local()),
        )
        flash("Lançamento adicionado.", "success")
        return redirect(url_for("caixa.list"))

    return render_template("caixa/form.html", **_form_context(categories))


@bp.route("/<int:id>/editar", methods=["GET", "POST"])
def update(id):
    entry = get("SELECT * FROM cash_ledger WHERE id=?", (id,))
    if not entry:
        flash("Lançamento não encontrado.", "error")
        return redirect(url_for("caixa.list"))

    categories = [r["name"] for r in query("SELECT name FROM cash_categories ORDER BY name ASC")]
    if request.method == "POST":
        m = _normalize_method(request.form.get("method"))
        acc = _default_account(m, request.form.get("account_label"))
        if m != "dinheiro" and not str(acc).strip():
            flash("Selecione uma conta/banco quando o método de pagamento não for dinheiro.", "error")
            return render_template("caixa/form.html", **_form_context(categories, entry))

        amount = _coerce_float(request.form.get("amount"))
        occurred_at = request.form.get("occurred_at") or entry["occurred_at"]
        category = request.form.get("category") or entry["category"]
        description = request.form.get("description") or None

        execute(
            """UPDATE cash_ledger SET
            occurred_at=?, amount=?, method=?, account_label=?, category=?, description=?
            WHERE id=?""",
            (occurred_at, amount, m, acc, category, description, id),
        )
        flash("Lançamento atualizado.", "success")
        return redirect(url_for("caixa.list"))

    return render_template("caixa/form.html", **_form_context(categories, entry))


@bp.route("/<int:id>/excluir", methods=["POST"])
def delete(id):
    execute("DELETE FROM cash_ledger WHERE id=?", (id,))
    flash("Lançamento excluído.", "success")
    return redirect(url_for("caixa.list"))
