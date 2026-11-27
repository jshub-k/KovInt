"""Singleton Supabase clients (anon + service-role)."""
from supabase import create_client, Client
from .config import Config

_anon: Client | None = None
_admin: Client | None = None


def get_anon_client() -> Client:
    global _anon
    if _anon is None:
        _anon = create_client(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY)
    return _anon


def get_admin_client() -> Client:
    global _admin
    if _admin is None:
        key = Config.SUPABASE_SERVICE_KEY or Config.SUPABASE_ANON_KEY
        _admin = create_client(Config.SUPABASE_URL, key)
    return _admin
