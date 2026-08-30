# OS e Contabil — Lavanderia

Sistema local de ordens de serviço, caixa e contas, agora em Flask + SQLite.

## Requisitos

- Python 3.13+
- Windows (atualmente)

## Instalação

```powershell
python -m venv .venv
.\venv\Scripts\python -m pip install -r requirements.txt
```

## Executar

```powershell
.\venv\Scripts\python -m flask --app run.py run
```

Acesse `http://127.0.0.1:5000`.

## Testar

```powershell
.\venv\Scripts\python -m pytest -v
```

## Estrutura

- `app/` — aplicação Flask
- `tests/` — testes com pytest
- `data/` — banco SQLite de desenvolvimento
- `legacy/` — projeto antigo (Electron/React) para referência
