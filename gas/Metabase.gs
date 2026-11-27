/**
 * Metabase — executa SQL via UrlFetchApp (server-side, sem CORS).
 */
function gasMetabaseSQL(sql, dbId) {
  const p = PropertiesService.getScriptProperties();
  const baseUrl = p.getProperty("METABASE_URL") || "https://metabase.kovi.com.br";
  const token   = p.getProperty("METABASE_SESSION_TOKEN") || "";
  const database = dbId || Number(p.getProperty("METABASE_DB_ID") || "340");

  if (!token) throw new Error("METABASE_SESSION_TOKEN não configurado nas Script Properties.");

  const payload = JSON.stringify({
    type: "native",
    native: { query: sql },
    database: database,
  });

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Metabase-Session": token },
    payload: payload,
    muteHttpExceptions: true,
  };

  const resp = UrlFetchApp.fetch(baseUrl + "/api/dataset", options);
  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText());

  if (code !== 202 && code !== 200) {
    throw new Error("Metabase erro " + code + ": " + JSON.stringify(body.error || body));
  }

  const cols = (body.data && body.data.cols || []).map(c => c.name);
  const rows = (body.data && body.data.rows || []).map(r =>
    Object.fromEntries(cols.map((k, i) => [k, r[i]]))
  );
  return rows;
}
