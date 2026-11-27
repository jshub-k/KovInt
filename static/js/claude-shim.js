/**
 * claude-shim.js  –  KovInt Flask MVP
 *
 * Implements window.claude.use("db"|"assets"|"mcp"|"sample"|"user"|"downloads"|"comments")
 * so kovint.html runs outside claude.ai with no code changes.
 *
 * Persistence layer: Supabase (Postgres + Realtime + Storage + Auth).
 * Config is loaded at boot from /auth/config (served by Flask, public).
 */
(function () {
  "use strict";

  /* ── boot config ─────────────────────────────────────────────────────── */
  let _cfg = null; // {supabase_url, supabase_anon_key, mapbox_token, mapbox_style, allowed_domain}
  let _sb = null;  // supabase-js client
  let _session = null; // supabase auth session

  async function loadConfig() {
    if (_cfg) return _cfg;
    const r = await fetch("/auth/config");
    _cfg = await r.json();
    return _cfg;
  }

  async function getSb() {
    if (_sb) return _sb;
    const cfg = await loadConfig();
    if (!cfg.supabase_url || !cfg.supabase_anon_key) throw new Error("Supabase not configured");
    // supabase-js is loaded via CDN in index.html before this script
    _sb = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    _sb.auth.onAuthStateChange((_event, session) => { _session = session; });
    const { data } = await _sb.auth.getSession();
    _session = data.session;
    return _sb;
  }

  function authHeader() {
    return _session ? { Authorization: "Bearer " + _session.access_token } : {};
  }

  /* ── tiles hook ──────────────────────────────────────────────────────── */
  loadConfig().then(cfg => {
    if (cfg.mapbox_token) {
      window.KOVINT_TILES = {
        url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${cfg.mapbox_token}`,
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        attribution: "© <a href='https://www.mapbox.com/about/maps/'>Mapbox</a>",
      };
    }
  }).catch(() => {});

  /* ── db capability ───────────────────────────────────────────────────── */
  /**
   * Thin generic store: collection(name) → {doc(id), get, set, update, delete,
   *   onSnapshot, where, orderBy, limit}
   *
   * Backed by a single Postgres table:
   *   docs(collection text, id text, data jsonb, updated_at timestamptz, updated_by uuid)
   * with RLS (see supabase/migrations/0001_init.sql).
   */
  function makeDb(sb) {
    function colRef(col) {
      let _filters = [];
      let _orderBy = null;
      let _limit = null;

      function buildQuery() {
        let q = sb.from("docs").select("*").eq("collection", col);
        for (const [field, op, val] of _filters) {
          if (op === "==") q = q.eq(`data->>'${field}'`, val);
          else if (op === ">=") q = q.gte(`data->>'${field}'`, val);
          else if (op === "<=") q = q.lte(`data->>'${field}'`, val);
          else if (op === "!=") q = q.neq(`data->>'${field}'`, val);
        }
        if (_orderBy) q = q.order(`data->>'${_orderBy[0]}'`, { ascending: _orderBy[1] !== "desc" });
        if (_limit) q = q.limit(_limit);
        return q;
      }

      const ref = {
        where(field, op, val) { _filters.push([field, op, val]); return ref; },
        orderBy(field, dir) { _orderBy = [field, dir || "asc"]; return ref; },
        limit(n) { _limit = n; return ref; },
        doc(id) { return docRef(col, id); },

        async get() {
          const { data, error } = await buildQuery();
          if (error) throw error;
          return { docs: (data || []).map(r => ({ id: r.id, exists: true, data: () => r.data || {} })) };
        },

        onSnapshot(cb) {
          // Initial fetch
          buildQuery().then(({ data }) => {
            cb({ docs: (data || []).map(r => ({ id: r.id, exists: true, data: () => r.data || {}, type: "added" })), docChanges: () => [] });
          });
          // Realtime
          const channel = sb.channel(`col-${col}`).on(
            "postgres_changes",
            { event: "*", schema: "public", table: "docs", filter: `collection=eq.${col}` },
            () => {
              buildQuery().then(({ data }) => {
                cb({ docs: (data || []).map(r => ({ id: r.id, exists: true, data: () => r.data || {} })), docChanges: () => [] });
              });
            }
          ).subscribe();
          return () => sb.removeChannel(channel);
        },
      };
      return ref;
    }

    function docRef(col, id) {
      return {
        async get() {
          const { data, error } = await sb.from("docs").select("*").eq("collection", col).eq("id", id).maybeSingle();
          if (error) throw error;
          if (!data) return { exists: false, id, data: () => ({}) };
          return { exists: true, id: data.id, data: () => data.data || {} };
        },
        async set(payload) {
          const { error } = await sb.from("docs").upsert({
            collection: col, id,
            data: payload,
            updated_at: new Date().toISOString(),
            updated_by: _session?.user?.id ?? null,
          }, { onConflict: "collection,id" });
          if (error) throw error;
        },
        async update(payload) {
          // Merge into existing data
          const { data: existing } = await sb.from("docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
          const merged = Object.assign({}, (existing?.data) || {}, payload);
          const { error } = await sb.from("docs").upsert({
            collection: col, id, data: merged,
            updated_at: new Date().toISOString(),
            updated_by: _session?.user?.id ?? null,
          }, { onConflict: "collection,id" });
          if (error) throw error;
        },
        async delete() {
          const { error } = await sb.from("docs").delete().eq("collection", col).eq("id", id);
          if (error) throw error;
        },
        onSnapshot(cb) {
          sb.from("docs").select("*").eq("collection", col).eq("id", id).maybeSingle()
            .then(({ data }) => {
              if (data) cb({ exists: true, id: data.id, data: () => data.data || {} });
              else cb({ exists: false, id, data: () => ({}) });
            });
          const channel = sb.channel(`doc-${col}-${id}`).on(
            "postgres_changes",
            { event: "*", schema: "public", table: "docs", filter: `collection=eq.${col}&id=eq.${id}` },
            () => {
              sb.from("docs").select("*").eq("collection", col).eq("id", id).maybeSingle()
                .then(({ data }) => {
                  if (data) cb({ exists: true, id: data.id, data: () => data.data || {} });
                  else cb({ exists: false, id, data: () => ({}) });
                });
            }
          ).subscribe();
          return () => sb.removeChannel(channel);
        },
      };
    }

    return {
      collection(name) { return colRef(name); },
    };
  }

  /* ── assets capability ───────────────────────────────────────────────── */
  function makeAssets() {
    return {
      async upload(path, blob, opts) {
        const form = new FormData();
        form.append("file", blob, path.split("/").pop());
        form.append("path", path);
        const r = await fetch("/api/assets", { method: "POST", headers: authHeader(), body: form });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      async list(prefix) {
        // Delegate to Supabase storage list via service endpoint (not proxied — use signed URLs instead)
        const sb = await getSb();
        const { data, error } = await sb.storage.from("documentos").list(prefix || "");
        if (error) throw error;
        return data || [];
      },
      async delete(path) {
        const sb = await getSb();
        const { error } = await sb.storage.from("documentos").remove([path]);
        if (error) throw error;
      },
      url(path) {
        return `/api/assets/${path}`;
      },
    };
  }

  /* ── mcp capability ──────────────────────────────────────────────────── */
  function makeMcp() {
    return {
      async callTool(server, tool, input, _opts) {
        const r = await fetch("/api/mcp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ server, tool, input }),
        });
        const json = await r.json();
        if (!r.ok) throw Object.assign(new Error(json.error || "mcp error"), { code: "tool_error", message: json.error });
        return json;
      },
    };
  }

  /* ── sample capability (Anthropic) ──────────────────────────────────── */
  function makeSample() {
    return {
      async createMessage(params) {
        const r = await fetch("/api/sample", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(params),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(txt);
        }
        return r.json();
      },
    };
  }

  /* ── user capability ─────────────────────────────────────────────────── */
  function makeUser(sb) {
    return {
      async me() {
        const { data } = await sb.auth.getUser();
        const u = data?.user;
        if (!u) return null;
        return { id: u.id, email: u.email, name: u.user_metadata?.full_name || u.email };
      },
      async name() {
        const me = await this.me();
        return me?.name || null;
      },
      async profiles() {
        const { data } = await sb.from("profiles").select("*");
        return data || [];
      },
      canEdit() { return !!_session; },
    };
  }

  /* ── downloads capability ────────────────────────────────────────────── */
  function makeDownloads() {
    return {
      async save({ filename, data }) {
        const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "download";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      },
    };
  }

  /* ── comments stub ───────────────────────────────────────────────────── */
  function makeComments() {
    return {
      async post(_text) {},
      async list() { return []; },
    };
  }

  /* ── window.claude.use() ─────────────────────────────────────────────── */
  const _cache = {};

  window.claude = window.claude || {};
  window.claude.use = async function (capability) {
    if (_cache[capability]) return _cache[capability];

    const sb = await getSb();

    let cap;
    switch (capability) {
      case "db":        cap = makeDb(sb); break;
      case "assets":    cap = makeAssets(); break;
      case "mcp":       cap = makeMcp(); break;
      case "sample":    cap = makeSample(); break;
      case "user":      cap = makeUser(sb); break;
      case "downloads": cap = makeDownloads(); break;
      case "comments":  cap = makeComments(); break;
      default:
        throw Object.assign(new Error(`capability '${capability}' not available`), { code: "capability_disabled" });
    }

    _cache[capability] = cap;
    return cap;
  };

  /* ── Supabase Auth UI helpers ─────────────────────────────────────────
   * kovint.html calls window.claude.use("user") and checks me() for the
   * logged-in user. We also need to handle the OAuth redirect here.
   */
  async function initAuth() {
    const sb = await getSb();
    const cfg = await loadConfig();

    // If this is an OAuth callback, Supabase handles it automatically.
    // After session loads, patch the auth gate that kovint.html shows.
    sb.auth.onAuthStateChange((event, session) => {
      _session = session;
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        // kovint.html will call window.claude.use("user").me() on its own
        document.dispatchEvent(new CustomEvent("kovint:auth", { detail: { session } }));
      }
    });

    // Expose a login helper so the kovint gate button can trigger Google OAuth
    window.kovintLogin = async function () {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { hd: cfg.allowed_domain || "kovi.com.br" },
        },
      });
      if (error) alert("Login falhou: " + error.message);
    };

    window.kovintLogout = async function () {
      await sb.auth.signOut();
      window.location.reload();
    };
  }

  initAuth().catch(console.error);
})();
