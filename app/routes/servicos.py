from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.db import get, query, execute, insert
from app.utils import now_local

bp = Blueprint("servicos", __name__, url_prefix="/servicos")


def _coerce_float(value, default=0):
    try:
        return float(value) if value is not None and str(value).strip() != "" else default
    except (ValueError, TypeError):
        return default


@bp.route("/")
def list():
    include_inactive = request.args.get("inativos", "0") == "1"
    if include_inactive:
        servicos = query("SELECT * FROM services ORDER BY category ASC, name ASC")
    else:
        servicos = query(
            "SELECT * FROM services WHERE active=1 ORDER BY category ASC, name ASC"
        )
    return render_template(
        "servicos/list.html",
        servicos=servicos,
        include_inactive=include_inactive,
    )


@bp.route("/novo", methods=["GET", "POST"])
def create():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("Informe o nome do serviço.", "error")
            return render_template("servicos/form.html", servico=None)

        unit_price = _coerce_float(request.form.get("unit_price"))
        requires_entry = 1 if request.form.get("requires_entry") else 0
        entry_pct = _coerce_float(request.form.get("entry_pct"), 50)

        servico_id = insert(
            """INSERT INTO services
            (name, description, category, unit_price, unit, active, requires_entry, entry_pct, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                name,
                request.form.get("description") or None,
                request.form.get("category") or "geral",
                unit_price,
                request.form.get("unit") or "un",
                1,
                requires_entry,
                entry_pct,
                now_local(),
            ),
        )
        flash("Serviço cadastrado.", "success")
        return redirect(url_for("servicos.list"))

    return render_template("servicos/form.html", servico=None)


@bp.route("/<int:id>/editar", methods=["GET", "POST"])
def update(id):
    servico = get("SELECT * FROM services WHERE id=?", (id,))
    if not servico:
        flash("Serviço não encontrado.", "error")
        return redirect(url_for("servicos.list"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("Informe o nome do serviço.", "error")
            return render_template("servicos/form.html", servico=servico)

        unit_price = _coerce_float(request.form.get("unit_price"))
        active = 1 if request.form.get("active") else 0
        requires_entry = 1 if request.form.get("requires_entry") else 0
        entry_pct = _coerce_float(request.form.get("entry_pct"), 50)

        execute(
            """UPDATE services SET
            name=?, description=?, category=?, unit_price=?, unit=?, active=?, requires_entry=?, entry_pct=?
            WHERE id=?""",
            (
                name,
                request.form.get("description") or None,
                request.form.get("category") or "geral",
                unit_price,
                request.form.get("unit") or "un",
                active,
                requires_entry,
                entry_pct,
                id,
            ),
        )
        flash("Serviço atualizado.", "success")
        return redirect(url_for("servicos.list"))

    return render_template("servicos/form.html", servico=servico)


@bp.route("/<int:id>/excluir", methods=["POST"])
def delete(id):
    # Serviços não são excluídos fisicamente; apenas desativados
    execute("UPDATE services SET active=0 WHERE id=?", (id,))
    flash("Serviço inativado.", "success")
    return redirect(url_for("servicos.list"))
