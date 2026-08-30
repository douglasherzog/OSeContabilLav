from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.db import get, query, execute, insert
from app.utils import now_local

bp = Blueprint("configuracoes", __name__, url_prefix="/configuracoes")

DEFAULT_KEYS = [
    "business_name",
    "trading_name",
    "cnpj",
    "phone",
    "address",
    "city",
    "state",
    "zip",
    "email",
    "receipt_header",
    "receipt_footer",
]


def _company_settings():
    rows = query("SELECT key, value FROM company_settings")
    settings = {r["key"]: r["value"] for r in rows}
    for k in DEFAULT_KEYS:
        if k not in settings:
            settings[k] = ""
    return settings


@bp.route("/")
def index():
    settings = _company_settings()
    methods = query("SELECT name, active FROM payment_methods ORDER BY name ASC")
    accounts = query("SELECT * FROM bank_accounts WHERE active=1 ORDER BY label ASC")
    return render_template(
        "configuracoes/index.html",
        settings=settings,
        methods=methods,
        accounts=accounts,
    )


@bp.route("/empresa", methods=["POST"])
def update_company():
    for key in DEFAULT_KEYS:
        value = request.form.get(key) or ""
        execute(
            """INSERT INTO company_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
            (key, value),
        )
    flash("Configurações da empresa salvas.", "success")
    return redirect(url_for("configuracoes.index"))


@bp.route("/metodos", methods=["POST"])
def create_method():
    name = request.form.get("name", "").strip().lower()
    if not name:
        flash("Nome inválido.", "error")
        return redirect(url_for("configuracoes.index"))
    try:
        insert(
            "INSERT OR IGNORE INTO payment_methods (name, active, created_at) VALUES (?, ?, ?)",
            (name, 1 if request.form.get("active") else 0, now_local()),
        )
        flash("Método adicionado.", "success")
    except Exception:
        flash("Erro ao adicionar método.", "error")
    return redirect(url_for("configuracoes.index"))


@bp.route("/metodos/<name>/atualizar", methods=["POST"])
def update_method(name):
    active = 1 if request.form.get("active") else 0
    execute(
        "UPDATE payment_methods SET active=? WHERE name=?",
        (active, name),
    )
    flash("Método atualizado.", "success")
    return redirect(url_for("configuracoes.index"))


@bp.route("/metodos/<name>/excluir", methods=["POST"])
def delete_method(name):
    execute("UPDATE payment_methods SET active=0 WHERE name=?", (name,))
    flash("Método inativado.", "success")
    return redirect(url_for("configuracoes.index"))


@bp.route("/contas", methods=["POST"])
def create_account():
    label = request.form.get("label", "").strip()
    if not label:
        flash("Label inválido.", "error")
        return redirect(url_for("configuracoes.index"))
    insert(
        """INSERT INTO bank_accounts
        (label, bank_name, agency, account_number, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (
            label,
            request.form.get("bank_name") or None,
            request.form.get("agency") or None,
            request.form.get("account_number") or None,
            1,
            now_local(),
        ),
    )
    flash("Conta bancária adicionada.", "success")
    return redirect(url_for("configuracoes.index"))


@bp.route("/contas/<int:id>/atualizar", methods=["POST"])
def update_account(id):
    execute(
        """UPDATE bank_accounts SET
        label=?, bank_name=?, agency=?, account_number=?, active=?
        WHERE id=?""",
        (
            request.form.get("label"),
            request.form.get("bank_name") or None,
            request.form.get("agency") or None,
            request.form.get("account_number") or None,
            1 if request.form.get("active") else 0,
            id,
        ),
    )
    flash("Conta atualizada.", "success")
    return redirect(url_for("configuracoes.index"))


@bp.route("/contas/<int:id>/excluir", methods=["POST"])
def delete_account(id):
    execute("UPDATE bank_accounts SET active=0 WHERE id=?", (id,))
    flash("Conta inativada.", "success")
    return redirect(url_for("configuracoes.index"))
