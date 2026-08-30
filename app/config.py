import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

DATABASE_PATH = os.getenv(
    "DATABASE_PATH",
    str(BASE_DIR / "data" / "osecontabil.db"),
)

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
