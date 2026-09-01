# Plano de Migração — Electron/React/SQLite → Flask/Jinja2/SQLite

## Decisões arquiteturais

- **Backend:** Flask 3.0.3
- **Frontend:** Jinja2/HTML server-side
- **Banco:** SQLite (reaproveitado)
- **Deploy:** aplicação local
- **Legado:** movido para `legacy/`

## Cortes e simplificações

| Módulo | Decisão |
|--------|---------|
| Clientes, Serviços, OS | Migrar integralmente |
| Caixa, Contas a Pagar, Contas a Receber | Migrar com dados históricos, mantendo recorrências e parcelamentos |
| Métodos de pagamento, Contas bancárias, Categorias | Migrar CRUD |
| Configurações da empresa | Migrar |
| Importação CSV | Migrar |
| Utilitários de banco (backup, reparo, limpeza) | Migrar |
| Dashboard | Simplificar (resumo básico) |
| Funcionários/RH | Não migrar agora |
| Auto-update | Remover |
| Scripts de sync Hetzner/Postgres/SSH | Descartar |

## Estrutura criada

```
OSeContabilLav/
├── legacy/                # projeto antigo
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── db.py              # conexão SQLite
│   ├── routes/            # blueprints
│   ├── templates/         # Jinja2
│   └── static/            # CSS/JS
├── tests/
├── data/
│   └── osecontabil.db     # cópia de dev
├── .venv/
├── requirements.txt
├── run.py
├── .env
├── .flaskenv
├── AGENTS.md
└── MIGRACAO.md
```

## Configuração de ambiente

1. Clonar/entrar no projeto
2. Criar venv: `python -m venv .venv`
3. Instalar: `.\venv\Scripts\python -m pip install -r requirements.txt`
4. Copiar o banco: `data\osecontabil.db` (cópia do banco original de produção)
5. Rodar: `.\venv\Scripts\python -m flask --app run.py run`

## Progresso

### Concluído

- Estrutura base Flask + SQLite
- Dashboard simplificado
- Módulo **Clientes** (listar, buscar, criar, editar, excluir)
- Módulo **Serviços** (listar, criar, editar, inativar, controle de entrada)
- Módulo **Ordens de Serviço** (listar, criar, editar, itens, pagamentos e caixa)
- Módulo **Caixa** (listar, criar, editar, excluir, categorias, saldo)
- Módulo **Contas a Pagar** e **Contas a Receber** (listar, criar, editar, parcelas, recorrências, caixa)
- Módulo **Configurações** (empresa, métodos de pagamento, contas bancárias)
- Módulo **Utilitários de banco** (backup, reparo, limpar duplicados, normalizar serviços)
- **Importação CSV** (clientes, serviços, OS, caixa, AP, AR)
- **Dashboard completo** com resumo real (OS, caixa, contas, clientes)
- **Paginação** em listagens de clientes e serviços
- **Refatoração** de helpers comuns em `app/helpers.py`
- Filtro `money` para formatação de moeda
- **Script de reset da base** (`scripts/reset_database.py`) mantendo clientes e serviços
- Testes isolados por função com banco temporário

## Testes

- `tests/test_db.py`: conexão e tabelas
- `tests/test_app.py`: renderização do dashboard
- `tests/test_clientes.py`: CRUD de clientes
- `tests/test_servicos.py`: CRUD de serviços
- `tests/test_os.py`: CRUD de OS, itens e pagamentos
- `tests/test_caixa.py`: CRUD de caixa e categorias
- `tests/test_contas.py`: CRUD de contas a pagar e a receber
- `tests/test_configuracoes.py`: configurações, métodos e contas bancárias
- `tests/test_utilitarios.py`: utilitários de banco
- Comando: `.\venv\Scripts\python -m pytest -v`

## Utilitários

- `scripts/reset_database.py`: zera o banco mantendo apenas `clients` e `services`, faz backup automático em `data/backups/`
