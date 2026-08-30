import shutil
from pathlib import Path
import pytest
from app import create_app
from app.config import DATABASE_PATH


@pytest.fixture
def app(tmp_path):
    # Banco temporário por teste, copiado do banco de dev
    test_db = tmp_path / "osecontabil.db"
    if Path(DATABASE_PATH).exists():
        shutil.copy(DATABASE_PATH, test_db)
    app = create_app({
        "TESTING": True,
        "DATABASE_PATH": str(test_db),
    })
    return app


@pytest.fixture
def client(app):
    return app.test_client()
