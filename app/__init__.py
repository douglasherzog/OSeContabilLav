from flask import Flask

from app.config import SECRET_KEY
from app.routes import dashboard, clientes


def create_app(test_config=None):
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.secret_key = SECRET_KEY

    if test_config:
        app.config.update(test_config)

    app.register_blueprint(dashboard.bp)
    app.register_blueprint(clientes.bp)

    return app
