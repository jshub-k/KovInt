"""
API routes:
  POST /api/mcp/call           → dispatch MCP tool calls (Metabase, Gmail, Sheets)
  POST /api/sample             → Anthropic Claude completions
  GET/POST /api/assets/<id>    → Supabase Storage proxy
"""
import json
import os
import requests
from flask import Blueprint, jsonify, request, Response, stream_with_context
from ..config import Config
from ..supabase_client import get_admin_client

bp = Blueprint("api", __name__)


# ─── helpers ────────────────────────────────────────────────────────────────

def _bearer():
    return request.headers.get("Authorization", "")


def _require_auth():
    token = _bearer().removeprefix("Bearer ").strip()
    if not token:
        return None, (jsonify({"error": "unauthenticated"}), 401)
    sb = get_admin_client()
    try:
        resp = sb.auth.get_user(token)
        return resp.user, None
    except Exception as e:
        return None, (jsonify({"error": str(e)}), 401)


# ─── MCP dispatcher ─────────────────────────────────────────────────────────

@bp.route("/mcp/call", methods=["POST"])
def mcp_call():
    user, err = _require_auth()
    if err:
        return err

    body = request.get_json(force=True)
    server = body.get("server", "")
    tool = body.get("tool", "")
    input_ = body.get("input", {})

    if server == "Metabase" and tool == "execute_sql":
        return _metabase_sql(input_)
    elif server == "Gmail":
        return _gmail_call(tool, input_, user)
    elif server == "Google Sheets":
        return _sheets_call(tool, input_, user)
    else:
        return jsonify({"error": f"server '{server}' not supported"}), 400


def _metabase_sql(input_):
    sql = input_.get("native", {}).get("query") or input_.get("query", "")
    db_id = input_.get("database", Config.METABASE_DB_ID)

    if not Config.METABASE_SESSION_TOKEN:
        return jsonify({"error": "METABASE_SESSION_TOKEN not configured"}), 503

    headers = {
        "X-Metabase-Session": Config.METABASE_SESSION_TOKEN,
        "Content-Type": "application/json",
    }
    payload = {"database": db_id, "native": {"query": sql}, "type": "native"}
    r = requests.post(
        f"{Config.METABASE_URL}/api/dataset",
        headers=headers,
        json=payload,
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    # Normalise to list-of-dicts
    cols = [c["name"] for c in data.get("data", {}).get("cols", [])]
    rows = [dict(zip(cols, row)) for row in data.get("data", {}).get("rows", [])]
    return jsonify({"payload": rows})


def _get_google_credentials(scopes, subject=None):
    """Build a google-auth credentials object from the service account JSON."""
    from google.oauth2 import service_account

    sa_path = Config.GOOGLE_SA_JSON
    if not sa_path or not os.path.exists(sa_path):
        raise RuntimeError("GOOGLE_SA_JSON not configured or file missing")

    creds = service_account.Credentials.from_service_account_file(sa_path, scopes=scopes)
    if subject or Config.GOOGLE_SA_SUBJECT:
        creds = creds.with_subject(subject or Config.GOOGLE_SA_SUBJECT)
    return creds


def _gmail_call(tool, input_, user):
    try:
        from googleapiclient.discovery import build

        scopes = ["https://mail.google.com/"]
        creds = _get_google_credentials(scopes, subject=user.email)
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)

        if tool == "search_threads":
            q = input_.get("query", "")
            page_size = input_.get("pageSize", 20)
            resp = service.users().threads().list(userId="me", q=q, maxResults=page_size).execute()
            threads = []
            for t in resp.get("threads", []):
                full = service.users().threads().get(userId="me", id=t["id"], format="metadata").execute()
                messages = []
                for m in full.get("messages", []):
                    headers = {h["name"]: h["value"] for h in m.get("payload", {}).get("headers", [])}
                    messages.append({
                        "id": m["id"],
                        "threadId": m["threadId"],
                        "sender": headers.get("From", ""),
                        "subject": headers.get("Subject", ""),
                        "toRecipients": [headers.get("To", "")],
                        "ccRecipients": [headers.get("Cc", "")] if headers.get("Cc") else [],
                    })
                threads.append({"id": t["id"], "messageCount": len(messages), "messages": messages})
            return jsonify({"payload": {"threads": threads}})

        elif tool == "get_thread":
            tid = input_.get("threadId", "")
            full = service.users().threads().get(userId="me", id=tid, format="full").execute()
            messages = []
            for m in full.get("messages", []):
                headers = {h["name"]: h["value"] for h in m.get("payload", {}).get("headers", [])}
                body = _gmail_body(m.get("payload", {}))
                atts = _gmail_attachments(m.get("payload", {}))
                messages.append({
                    "id": m["id"],
                    "sender": headers.get("From", ""),
                    "addressDisplayNames": headers.get("From", ""),
                    "date": headers.get("Date", ""),
                    "internalDate": m.get("internalDate", ""),
                    "labelIds": m.get("labelIds", []),
                    "snippet": m.get("snippet", ""),
                    "subject": headers.get("Subject", ""),
                    "plaintextBody": body,
                    "attachments": atts,
                })
            return jsonify({"payload": {
                "id": full["id"],
                "viewUrl": f"https://mail.google.com/mail/u/0/#inbox/{full['id']}",
                "messages": messages,
            }})

        elif tool == "reply":
            msg_id = input_.get("messageId", "")
            body_text = input_.get("body", "")
            # Get original message to build reply headers
            orig = service.users().messages().get(userId="me", id=msg_id, format="metadata").execute()
            headers = {h["name"]: h["value"] for h in orig.get("payload", {}).get("headers", [])}
            subject = headers.get("Subject", "")
            if not subject.lower().startswith("re:"):
                subject = "Re: " + subject
            to = headers.get("Reply-To") or headers.get("From", "")
            thread_id = orig.get("threadId", "")
            refs = headers.get("References", "") + " " + headers.get("Message-Id", "")

            import base64
            from email.mime.text import MIMEText

            mime = MIMEText(body_text)
            mime["to"] = to
            mime["subject"] = subject
            mime["In-Reply-To"] = headers.get("Message-Id", "")
            mime["References"] = refs.strip()
            raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
            sent = service.users().messages().send(
                userId="me", body={"raw": raw, "threadId": thread_id}
            ).execute()
            return jsonify({"payload": {"id": sent["id"], "threadId": sent.get("threadId", "")}})

        else:
            return jsonify({"error": f"Gmail tool '{tool}' not implemented"}), 400

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _gmail_body(payload):
    import base64

    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace") if data else ""
    for part in payload.get("parts", []):
        txt = _gmail_body(part)
        if txt:
            return txt
    return ""


def _gmail_attachments(payload):
    atts = []
    for part in payload.get("parts", []):
        if part.get("filename"):
            atts.append({
                "id": part.get("body", {}).get("attachmentId", ""),
                "filename": part["filename"],
                "mimeType": part.get("mimeType", ""),
            })
        atts.extend(_gmail_attachments(part))
    return atts


def _sheets_call(tool, input_, user):
    try:
        from googleapiclient.discovery import build

        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        creds = _get_google_credentials(scopes, subject=user.email)
        service = build("sheets", "v4", credentials=creds, cache_discovery=False)
        sheets = service.spreadsheets()

        sid = input_.get("spreadsheetId", "")

        if tool == "get_values":
            r = sheets.values().get(spreadsheetId=sid, range=input_["range"]).execute()
            return jsonify({"payload": {"values": r.get("values", [])}})

        elif tool == "update_values":
            r = sheets.values().update(
                spreadsheetId=sid, range=input_["range"],
                valueInputOption="USER_ENTERED",
                body={"values": input_["values"]},
            ).execute()
            return jsonify({"payload": r})

        elif tool == "append_values":
            r = sheets.values().append(
                spreadsheetId=sid, range=input_["range"],
                valueInputOption="USER_ENTERED",
                body={"values": input_["values"]},
            ).execute()
            return jsonify({"payload": r})

        elif tool == "batch_clear_values":
            r = sheets.values().batchClear(
                spreadsheetId=sid,
                body={"ranges": input_["ranges"]},
            ).execute()
            return jsonify({"payload": r})

        else:
            return jsonify({"error": f"Sheets tool '{tool}' not implemented"}), 400

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Anthropic sample ───────────────────────────────────────────────────────

@bp.route("/sample", methods=["POST"])
def sample():
    user, err = _require_auth()
    if err:
        return err

    if not Config.ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured"}), 503

    body = request.get_json(force=True)
    # Forward the request to Anthropic, streaming the response back
    headers = {
        "x-api-key": Config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    # Default to claude-sonnet-5-5 unless caller specifies
    body.setdefault("model", "claude-sonnet-5-5")
    body.setdefault("max_tokens", 4096)
    stream = body.get("stream", False)

    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers=headers,
        json=body,
        stream=stream,
        timeout=120,
    )

    if stream:
        def generate():
            for chunk in r.iter_content(chunk_size=None):
                yield chunk

        return Response(
            stream_with_context(generate()),
            status=r.status_code,
            content_type=r.headers.get("content-type", "text/event-stream"),
        )

    return Response(r.content, status=r.status_code, content_type="application/json")


# ─── Assets (Supabase Storage proxy) ────────────────────────────────────────

@bp.route("/assets/<path:blob_path>", methods=["GET"])
def asset_get(blob_path):
    user, err = _require_auth()
    if err:
        return err

    sb = get_admin_client()
    try:
        # Generate a signed URL valid for 60 s and redirect
        result = sb.storage.from_("documentos").create_signed_url(blob_path, 60)
        url = result.get("signedURL") or result.get("signed_url", "")
        if not url:
            return jsonify({"error": "could not sign URL"}), 500
        from flask import redirect
        return redirect(url)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/assets", methods=["POST"])
def asset_upload():
    user, err = _require_auth()
    if err:
        return err

    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400

    f = request.files["file"]
    path = request.form.get("path", f"{user.id}/{f.filename}")
    sb = get_admin_client()
    try:
        data = f.read()
        sb.storage.from_("documentos").upload(path, data, {"content-type": f.mimetype})
        return jsonify({"path": path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
