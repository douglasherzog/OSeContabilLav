import os
import shutil
from datetime import datetime
from flask import Blueprint, render_template, send_file, flash, redirect, url_for
from app.db import get, execute, query, get_db_path

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
