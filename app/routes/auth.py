"""
Auth routes — thin wrappers around Supabase Auth.
The heavy lifting (OAuth, session) is done client-side via supabase-js.
These endpoints handle server-side token validation and profile reads.
"""
from flask import Blueprint, jsonify, request
from ..supabase_client import get_admin_client

bp = Blueprint("auth", __name__)


def _user_from_request():
    """Extract and verify the Supabase JWT from the Authorization header."""
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return None, "missing token"
    sb = get_admin_client()
    try:
        resp = sb.auth.get_user(token)
        return resp.user, None
    except Exception as e:
        return None, str(e)


@bp.route("/me")
def me():
    user, err = _user_from_request()
    if err:
        return jsonify({"error": err}), 401
    return jsonify({"id": user.id, "email": user.email, "meta": user.user_metadata})


@bp.route("/config")
def config():
    """Public config the front-end needs before auth (Supabase URL, anon key, Mapbox token)."""
    from ..config import Config

    return jsonify(
        {
            "supabase_url": Config.SUPABASE_URL,
            "supabase_anon_key": Config.SUPABASE_ANON_KEY,
            "mapbox_token": Config.MAPBOX_TOKEN,
            "mapbox_style": Config.MAPBOX_STYLE,
            "allowed_domain": Config.ALLOWED_DOMAIN,
        }
    )
