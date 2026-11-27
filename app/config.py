import os


class Config:
    # Supabase
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

    # Anthropic
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

    # Metabase
    METABASE_URL = os.environ.get("METABASE_URL", "https://metabase.kovi.com.br")
    METABASE_SESSION_TOKEN = os.environ.get("METABASE_SESSION_TOKEN", "")
    METABASE_DB_ID = int(os.environ.get("METABASE_DB_ID", "340"))

    # Mapbox
    MAPBOX_TOKEN = os.environ.get("MAPBOX_TOKEN", "")
    MAPBOX_STYLE = os.environ.get(
        "MAPBOX_STYLE",
        "mapbox://styles/mapbox/dark-v11",
    )

    # Google (service account JSON path, used for Gmail/Sheets with DWD)
    GOOGLE_SA_JSON = os.environ.get("GOOGLE_SA_JSON", "")  # path to file
    GOOGLE_SA_SUBJECT = os.environ.get("GOOGLE_SA_SUBJECT", "")  # impersonate email

    # Allowed domain for Supabase sign-in restriction
    ALLOWED_DOMAIN = os.environ.get("ALLOWED_DOMAIN", "kovi.com.br")
