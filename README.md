# KovInt — MVP Flask

**KovInt** fora do claude.ai: banco de dados real (Supabase), mapas (Mapbox), autenticação Google restrita a `@kovi.com.br` e APIs reais (Gmail, Sheets, Metabase).

## Arquitetura

```
KovInt/
├── app/
│   ├── __init__.py          # Flask factory
│   ├── config.py            # variáveis de ambiente
│   ├── supabase_client.py   # clientes anon + service-role
│   └── routes/
│       ├── auth.py          # /auth/me  /auth/config
│       └── api.py           # /api/mcp/call  /api/sample  /api/assets
├── static/
│   ├── index.html           # kovint.html + shim injetado
│   └── js/
│       └── claude-shim.js   # implementa window.claude.use()
├── supabase/
│   └── migrations/
│       └── 0001_init.sql    # schema + RLS
├── wsgi.py
├── requirements.txt
├── Dockerfile
├── render.yaml
└── .env.example
```

### Camada de compatibilidade (`claude-shim.js`)

O shim implementa `window.claude.use(capability)` para que o front-end original não precise de alterações:

| Capability  | Implementação                              |
|-------------|--------------------------------------------|
| `db`        | Supabase `docs` table (Postgres + Realtime)|
| `assets`    | Supabase Storage bucket `documentos`       |
| `mcp`       | `/api/mcp/call` → Metabase / Gmail / Sheets|
| `sample`    | `/api/sample` → Anthropic API              |
| `user`      | Supabase Auth (Google OAuth)               |
| `downloads` | `URL.createObjectURL` + `<a download>`     |
| `comments`  | stub                                       |

### Banco de dados (Supabase)

Uma única tabela genérica `docs(collection, id, data jsonb)` substituiu todas as collections do artefato (casos, bo_req, oficios, dossies, modelo, etc.). O RLS garante que só usuários autenticados acessem dados; admins/owners podem deletar.

### Mapas

O shim injeta `window.KOVINT_TILES` com tiles Mapbox assim que o config é carregado. O hook já existe no código original (`tilesOn`), então os mapas do KovInt funcionam automaticamente.

---

## Setup

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. No SQL Editor, rode `supabase/migrations/0001_init.sql`
3. Em **Authentication → Providers → Google**: ative e configure o OAuth Client ID/Secret do Google Cloud
4. Em **Authentication → URL Configuration**: adicione `https://seu-dominio.render.com` em Redirect URLs
5. Em **Database → Replication**: adicione as tabelas `docs` e `profiles` ao `supabase_realtime`

### 2. Google APIs (Gmail e Sheets)

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto e ative Gmail API e Sheets API
2. Crie uma **Service Account** e ative **Domain-Wide Delegation**
3. No Google Workspace Admin, delegue os escopos:
   - `https://mail.google.com/`
   - `https://www.googleapis.com/auth/spreadsheets`
4. Baixe o JSON da SA e anote o caminho

### 3. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
# edite .env
```

### 4. Executar localmente

```bash
pip install -r requirements.txt
python wsgi.py
```

Acesse `http://localhost:8000`.

### 5. Deploy no Render

1. Faça push do repositório para o GitHub
2. Em [render.com](https://render.com) → **New Web Service** → conecte o repositório
3. Render detecta o `render.yaml`; preencha as env vars marcadas `sync: false` no dashboard
4. Para o `GOOGLE_SA_JSON`: use o campo **Secret Files** do Render, aponte para `/app/secrets/sa.json`

### 6. Deploy no Railway

```bash
railway login
railway init
railway up
```

Configure as mesmas env vars no dashboard do Railway.

---

## Token do Metabase

O Metabase usa autenticação por session token (não OAuth). Para obter o token:

```bash
curl -X POST https://metabase.kovi.com.br/api/session \
  -H "Content-Type: application/json" \
  -d '{"username":"seu@kovi.com.br","password":"sua-senha"}'
```

Cole o `id` retornado em `METABASE_SESSION_TOKEN`. O token expira; renove conforme necessário (ou implemente refresh automático).

---

## Próximos passos

- [ ] Refresh automático do token Metabase (endpoint `/api/session` cron)
- [ ] Download de anexos Gmail (implementar `download_gmail_attachment` em `api.py`)
- [ ] OCR via Google Vision API (rota `/api/ocr`)
- [ ] Painel de administração para gerenciar roles (`profiles.role`)
- [ ] Migração dos dados do artefato para o Supabase (script one-shot)
