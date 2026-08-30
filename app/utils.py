import re
from datetime import datetime, date, timedelta


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


def add_days(date_str, days):
    d = datetime.strptime(date_str[:10], "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def add_months(date_str, months):
    d = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
    year, month, day = d.year, d.month, d.day
    month += months
    while month > 12:
        month -= 12
        year += 1
    while month < 1:
        month += 12
        year -= 1
    last = (date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)) - timedelta(days=1)
    day = min(day, last.day)
    return date(year, month, day).strftime("%Y-%m-%d")


def add_interval(date_str, interval_value, interval_unit):
    val = max(1, int(interval_value or 1))
    unit = (interval_unit or "month").lower()
    if unit == "week":
        return add_days(date_str, val * 7)
    if unit == "day":
        return add_days(date_str, val)
    return add_months(date_str, val)


def money(value):
    try:
        return f"R$ {float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return "R$ 0,00"
