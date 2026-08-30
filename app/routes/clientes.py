from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.db import get, query, execute, insert, paginated_query
from app.utils import normalize_phone, now_local

bp = Blueprint("clientes", __name__, url_prefix="/clientes")


@bp.route("/")
def list():
    q = request.args.get("q", "").strip().lower()
    page = request.args.get("page", 1, type=int)
    if q:
        base_sql = """
            SELECT *, (first_name || ' ' || last_name) AS name
            FROM clients
            WHERE (first_name || ' ' || last_name) LIKE ?
               OR phone LIKE ?
            ORDER BY id DESC
        """
        params = (f"%{q}%", f"%{q}%")
    else:
        base_sql = "SELECT *, (first_name || ' ' || last_name) AS name FROM clients ORDER BY id DESC"
        params = ()
    clientes, total, page, per_page = paginated_query(base_sql, params, page)
    pages = (total + per_page - 1) // per_page
    return render_template("clientes/list.html", clientes=clientes, q=q, page=page, pages=pages)


@bp.route("/novo", methods=["GET", "POST"])
def create():
    if request.method == "POST":
        first_name = request.form.get("first_name", "").strip()
        if not first_name:
            flash("Informe o nome.", "error")
            return render_template("clientes/form.html", cliente=None)

        last_name = request.form.get("last_name", "").strip()
        phone = normalize_phone(request.form.get("phone"))
        email = request.form.get("email") or None
        address = request.form.get("address") or None

        cliente_id = insert(
            "INSERT INTO clients (first_name, last_name, phone, email, address, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (first_name, last_name, phone, email, address, now_local()),
        )
        flash("Cliente cadastrado.", "success")
        return redirect(url_for("clientes.list"))

    return render_template("clientes/form.html", cliente=None)


@bp.route("/<int:id>/editar", methods=["GET", "POST"])
def update(id):
    cliente = get(
        "SELECT *, (first_name || ' ' || last_name) AS name FROM clients WHERE id=?",
        (id,),
    )
    if not cliente:
        flash("Cliente não encontrado.", "error")
        return redirect(url_for("clientes.list"))

    if request.method == "POST":
        first_name = request.form.get("first_name", "").strip()
        if not first_name:
            flash("Informe o nome.", "error")
            return render_template("clientes/form.html", cliente=cliente)

        last_name = request.form.get("last_name", "").strip()
        phone = normalize_phone(request.form.get("phone"))
        email = request.form.get("email") or None
        address = request.form.get("address") or None

        execute(
            "UPDATE clients SET first_name=?, last_name=?, phone=?, email=?, address=? WHERE id=?",
            (first_name, last_name, phone, email, address, id),
        )
        flash("Cliente atualizado.", "success")
        return redirect(url_for("clientes.list"))

    return render_template("clientes/form.html", cliente=cliente)


@bp.route("/<int:id>/excluir", methods=["POST"])
def delete(id):
    # Não excluímos as OS vinculadas, apenas o cliente
    execute("DELETE FROM clients WHERE id=?", (id,))
    flash("Cliente excluído.", "success")
    return redirect(url_for("clientes.list"))
