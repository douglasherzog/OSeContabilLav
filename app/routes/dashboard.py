from flask import Blueprint, render_template
from app.db import get, query
from app.utils import today, month_start

bp = Blueprint("dashboard", __name__)


@bp.route("/")
def index():
    today_str = today()
    month_str = month_start()

    os_aberta = get(
        "SELECT COUNT(*) AS c FROM service_orders WHERE status NOT IN ('entregue')"
    )["c"]
    os_hoje = get(
        "SELECT COUNT(*) AS c FROM service_orders WHERE DATE(created_at)=?",
        (today_str,),
    )["c"]
    receita_mes = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM cash_ledger WHERE amount>0 AND occurred_at>=?",
        (month_str,),
    )["s"]
    saida_mes = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM cash_ledger WHERE amount<0 AND occurred_at>=?",
        (month_str,),
    )["s"]
    saldo_mes = receita_mes + saida_mes
    ap_vencidas = get(
        "SELECT COUNT(*) AS c FROM accounts_payable WHERE status='pendente' AND due_date<?",
        (today_str,),
    )["c"]
    ap_pendente = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM accounts_payable WHERE status='pendente'"
    )["s"]
    ar_pendente = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM accounts_receivable WHERE status='pendente'"
    )["s"]
    total_clientes = get("SELECT COUNT(*) AS c FROM clients")["c"]
    os_por_status = query(
        "SELECT status, COUNT(*) AS c FROM service_orders GROUP BY status"
    )
    receita_semana = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM cash_ledger WHERE amount>0 AND occurred_at>=date(?,'weekday 0','-6 days')",
        (today_str,),
    )["s"]
    ultimas_os = query(
        """SELECT so.*, c.first_name || ' ' || c.last_name AS client_name
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        ORDER BY so.created_at DESC
        LIMIT 5"""
    )
    os_prontas = query(
        """SELECT so.id, so.number, so.created_at, so.total,
        COALESCE(p.paid, 0) AS paid,
        c.first_name || ' ' || c.last_name AS client_name, c.phone AS client_phone
        FROM service_orders so
        LEFT JOIN clients c ON c.id = so.client_id
        LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM os_payments GROUP BY order_id) p ON p.order_id=so.id
        WHERE so.status='pronta' ORDER BY so.created_at ASC"""
    )
    ap_vencendo_7 = get(
        "SELECT COUNT(*) AS c FROM accounts_payable WHERE status='pendente' AND due_date>=? AND due_date<=date(?,'+7 days')",
        (today_str, today_str),
    )["c"]

    return render_template(
        "dashboard.html",
        os_aberta=os_aberta,
        os_hoje=os_hoje,
        receita_mes=receita_mes,
        saida_mes=abs(saida_mes),
        saldo_mes=saldo_mes,
        ap_vencidas=ap_vencidas,
        ap_pendente=ap_pendente,
        ar_pendente=ar_pendente,
        total_clientes=total_clientes,
        os_por_status=os_por_status,
        receita_semana=receita_semana,
        ultimas_os=ultimas_os,
        os_prontas=os_prontas,
        ap_vencendo_7=ap_vencendo_7,
    )
