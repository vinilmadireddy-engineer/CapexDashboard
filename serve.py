"""Production entry point. Run with: python serve.py
Uses waitress instead of the Flask/Werkzeug dev server.
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from waitress import serve
from werkzeug.middleware.proxy_fix import ProxyFix

from capex_app import app, ensure_workbook

LOG_DIR = Path(__file__).resolve().parent / "logs"


def configure_logging():
    LOG_DIR.mkdir(exist_ok=True)
    handler = RotatingFileHandler(LOG_DIR / "capex.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    root.addHandler(logging.StreamHandler(sys.stdout))


if __name__ == "__main__":
    if not os.environ.get("FLASK_SECRET_KEY"):
        raise SystemExit("FLASK_SECRET_KEY is not set. Sessions would reset on every restart.")

    configure_logging()
    ensure_workbook()

    # Only trust forwarded headers when a reverse proxy (IIS/ARR, nginx) sits in front.
    if os.environ.get("BEHIND_PROXY", "0") == "1":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    threads = int(os.environ.get("THREADS", "8"))
    logging.getLogger("capex").info("Starting Capex dashboard on %s:%s", host, port)
    serve(app, host=host, port=port, threads=threads, ident="Capex")
