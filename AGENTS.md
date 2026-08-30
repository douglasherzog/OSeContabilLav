# Regras do Projeto — OS e Contabil Lavanderia

> Aplicação web local em Flask + SQLite.

## Princípios obrigatórios

1. **Testes em toda alteração**
   - Novas rotas, modelos ou helpers devem acompanhar testes.
   - Sempre rodar `pytest` antes de considerar uma tarefa concluída.
   - Preferir testes de integração com `client` do Flask para rotas.

2. **Documentação em toda alteração**
   - `README.md` atualizado para mudanças de setup/dependências.
   - `MIGRACAO.md` atualizado para decisões arquiteturais ou cortes de funcionalidade.
   - Comentários no código apenas quando a lógica não for óbvia.

3. **Padrão de código**
   - Python 3.13+, PEP 8 básico, sem dependências desnecessárias.
   - SQL explícito e próximo dos handlers legados para facilitar a migração.
   - Rotas organizadas em blueprints dentro de `app/routes/`.
   - Templates Jinja2 em `app/templates/`, estáticos em `app/static/`.

4. **Banco de dados**
   - SQLite, acessado via `sqlite3` padrão.
   - Caminho configurável por `DATABASE_PATH` (`.env`).
   - Cópia de desenvolvimento em `data/osecontabil.db`; nunca tocar no `.db` de produção original.

5. **Transição do legado**
   - Código legado vive em `legacy/` e serve apenas como referência.
   - Não editar `legacy/`, exceto para copiar informações de schema/dados.

## Comandos comuns

```powershell
.\venv\Scripts\python -m pytest -v
.\venv\Scripts\python -m flask --app run.py run
```
