import os
from flask import Flask
from flask_cors import CORS


def create_app():
    app = Flask(__name__, static_folder="../static", static_url_path="")
    app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    CORS(app, resources={r"/api/*": {"origins": os.environ.get("ALLOWED_ORIGINS", "*")}})

    from .routes.auth import bp as auth_bp
    from .routes.api import bp as api_bp

    app.register_blueprint(auth_bp, url_prefix="/auth")
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve(path):
        # Let Flask serve static files; fall back to index.html for SPA routing
        from flask import send_from_directory
        import os as _os

        static = app.static_folder
        target = _os.path.join(static, path)
        if path and _os.path.exists(target):
            return send_from_directory(static, path)
        return send_from_directory(static, "index.html")

    return app
