from flask import Blueprint, render_template
from app.db import get, query

bp = Blueprint("dashboard", __name__)


@bp.route("/")
def index():
    os_aberta = get(
        "SELECT COUNT(*) AS c FROM service_orders WHERE status != 'entregue'"
    )
    total_clientes = get("SELECT COUNT(*) AS c FROM clients")
    receita_mes = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM cash_ledger WHERE amount > 0"
    )
    ap_vencidas = get(
        "SELECT COUNT(*) AS c FROM accounts_payable WHERE status='pendente' AND due_date < date('now')"
    )
    ultimas_os = query(
        """
        SELECT so.*, c.first_name || ' ' || c.last_name AS client_name
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        ORDER BY so.created_at DESC
        LIMIT 5
        """
    )
    return render_template(
        "dashboard.html",
        os_aberta=os_aberta["c"],
        total_clientes=total_clientes["c"],
        receita_mes=receita_mes["s"],
        ap_vencidas=ap_vencidas["c"],
        ultimas_os=ultimas_os,
    )
