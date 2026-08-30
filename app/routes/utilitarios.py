import io
import os
import shutil
from datetime import datetime
from flask import Blueprint, render_template, send_file, flash, redirect, url_for, request
from app.db import get, execute, query, insert, get_db_path
from app.utils import now_local

bp = Blueprint("utilitarios", __name__, url_prefix="/utilitarios")


@bp.route("/")
def index():
    return render_template("utilitarios/index.html")


@bp.route("/backup")
def backup():
    db_path = get_db_path()
    if not os.path.exists(db_path):
        flash("Banco de dados não encontrado.", "error")
        return redirect(url_for("utilitarios.index"))

    backup_dir = os.path.join(os.path.dirname(db_path), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    filename = f"osecontabil_backup_{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.db"
    backup_path = os.path.join(backup_dir, filename)
    shutil.copy2(db_path, backup_path)
    flash(f"Backup criado em {backup_path}.", "success")
    return send_file(backup_path, as_attachment=True, download_name=filename)


@bp.route("/limpar-duplicados", methods=["POST"])
def cleanup_duplicates():
    execute(
        """DELETE FROM accounts_payable WHERE id NOT IN (
            SELECT MIN(id) FROM accounts_payable GROUP BY description, amount, due_date, status
        )"""
    )
    ap_deleted = get("SELECT changes() as c")["c"]
    execute(
        """DELETE FROM accounts_receivable WHERE id NOT IN (
            SELECT MIN(id) FROM accounts_receivable GROUP BY description, amount, due_date, status
        )"""
    )
    ar_deleted = get("SELECT changes() as c")["c"]
    flash(f"Duplicados removidos: {ap_deleted} AP, {ar_deleted} AR.", "success")
    return redirect(url_for("utilitarios.index"))


@bp.route("/reparar", methods=["POST"])
def repair():
    try:
        execute("UPDATE service_orders SET payment_status='em_aberto' WHERE payment_status IS NULL")
        execute("UPDATE service_orders SET status='aberta' WHERE status IS NULL")
        execute("UPDATE cash_ledger SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''")
        execute("UPDATE accounts_payable SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''")
        execute("UPDATE accounts_receivable SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''")
        flash("Reparo concluído.", "success")
    except Exception as e:
        flash(f"Erro no reparo: {e}", "error")
    return redirect(url_for("utilitarios.index"))


@bp.route("/normalizar-servicos", methods=["POST"])
def normalize_units():
    try:
        svcs = query("SELECT id, name FROM services WHERE name LIKE 'Lavagem %' OR name LIKE 'lavagem %'")
        for s in svcs:
            stripped = s["name"][8:] if s["name"].lower().startswith("lavagem ") else s["name"][7:]
            if stripped:
                normalized = stripped[0].upper() + stripped[1:]
                execute("UPDATE services SET name=? WHERE id=?", (normalized, s["id"]))
        flash(f"{len(svcs)} serviços normalizados.", "success")
    except Exception as e:
        flash(f"Erro na normalização: {e}", "error")
    return redirect(url_for("utilitarios.index"))


@bp.route("/importar-csv", methods=["GET", "POST"])
def import_csv():
    if request.method == "POST":
        table = request.form.get("table")
        file = request.files.get("csv")
        if not file or file.filename == "":
            flash("Selecione um arquivo CSV.", "error")
            return redirect(url_for("utilitarios.import_csv"))

        try:
            content = file.read().decode("utf-8")
            lines = [l for l in content.split("\n") if l.strip()]
            if not lines:
                flash("Arquivo vazio.", "error")
                return redirect(url_for("utilitarios.import_csv"))

            headers = [h.strip().strip('"') for h in lines[0].split(";")]
            count = 0
            for i in range(1, len(lines)):
                cols = [c.strip().strip('"') or None for c in lines[i].split(";")]
                row = {h: cols[idx] if idx < len(cols) else None for idx, h in enumerate(headers)}
                try:
                    _import_row(table, row)
                    count += 1
                except Exception:
                    pass
            flash(f"{count} registros importados.", "success")
            return redirect(url_for("utilitarios.import_csv"))
        except Exception as e:
            flash(f"Erro na importação: {e}", "error")
            return redirect(url_for("utilitarios.import_csv"))

    return render_template("utilitarios/importar.html")


def _import_row(table, row):
    if table == "os":
        insert(
            "INSERT OR IGNORE INTO service_orders (number, title, status, total, payment_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                row.get("number"),
                row.get("title"),
                row.get("status") or "aberta",
                row.get("total") or 0,
                row.get("payment_status") or "em_aberto",
                row.get("note"),
                row.get("created_at") or now_local(),
            ),
        )
    elif table == "caixa":
        insert(
            "INSERT INTO cash_ledger (occurred_at, amount, method, account_label, category, description, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                row.get("occurred_at"),
                row.get("amount") or 0,
                row.get("method"),
                row.get("account_label"),
                row.get("category") or "manual",
                row.get("description"),
                row.get("source_type") or "manual",
            ),
        )
    elif table == "ap":
        insert(
            "INSERT OR IGNORE INTO accounts_payable (description, category, amount, due_date, status, note) VALUES (?, ?, ?, ?, ?, ?)",
            (
                row.get("description"),
                row.get("category") or "geral",
                row.get("amount") or 0,
                row.get("due_date"),
                row.get("status") or "pendente",
                row.get("note"),
            ),
        )
    elif table == "ar":
        insert(
            "INSERT OR IGNORE INTO accounts_receivable (description, category, amount, due_date, status, note) VALUES (?, ?, ?, ?, ?, ?)",
            (
                row.get("description"),
                row.get("category") or "geral",
                row.get("amount") or 0,
                row.get("due_date"),
                row.get("status") or "pendente",
                row.get("note"),
            ),
        )
    elif table == "clientes":
        full = (row.get("name") or "").strip()
        parts = full.split()
        first_name = row.get("first_name") or (parts[0] if parts else full or "")
        last_name = row.get("last_name") or (" ".join(parts[1:]) if len(parts) > 1 else ".")
        insert(
            "INSERT OR IGNORE INTO clients (first_name, last_name, phone, email, address, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (first_name, last_name, row.get("phone") or "", row.get("email") or "", row.get("address") or "", row.get("created_at") or now_local()),
        )
    elif table == "servicos":
        active = row.get("active")
        if active is None:
            active_int = 1
        else:
            active_int = 1 if active.lower() in ("true", "1", "sim") else 0
        insert(
            "INSERT OR IGNORE INTO services (name, description, category, unit_price, unit, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                row.get("name"),
                row.get("description") or "",
                row.get("category") or "geral",
                float(row.get("unit_price") or row.get("price") or 0),
                row.get("unit") or "un",
                active_int,
                row.get("created_at") or now_local(),
            ),
        )
    else:
        raise ValueError("Tabela inválida")
