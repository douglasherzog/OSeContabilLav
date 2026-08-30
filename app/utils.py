import re
from datetime import datetime


def now_local():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today():
    return datetime.now().strftime("%Y-%m-%d")


def normalize_phone(raw):
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    d = digits
    if d.startswith("55") and len(d) >= 12:
        d = d[2:]
    if len(d) == 11 or len(d) == 10:
        return f"+55{d}"
    return f"+{digits}"


def money(value):
    try:
        return f"R$ {float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return "R$ 0,00"
