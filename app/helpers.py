def coerce_float(value, default=0):
    try:
        return float(value) if value is not None and str(value).strip() != "" else default
    except (ValueError, TypeError):
        return default


def normalize_method(m):
    return (m or "").strip().lower() or "dinheiro"


def default_account(method, provided):
    if provided and str(provided).strip():
        return provided
    return "Caixa" if method == "dinheiro" else ""
