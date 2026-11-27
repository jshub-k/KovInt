/**
 * Anthropic Claude — chamado server-side via UrlFetchApp.
 * Sem streaming (GAS não suporta SSE); retorna a resposta completa.
 */
function gasCallSample(params) {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty("ANTHROPIC_API_KEY") || "";
  if (!key) throw new Error("ANTHROPIC_API_KEY não configurado nas Script Properties.");

  // Força modelo padrão e remove stream (não suportado no GAS)
  params.model    = params.model    || "claude-sonnet-4-6";
  params.max_tokens = params.max_tokens || 4096;
  delete params.stream;

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    payload: JSON.stringify(params),
    muteHttpExceptions: true,
  };

  const resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", options);
  const code = resp.getResponseCode();
  const body = JSON.parse(resp.getContentText());

  if (code !== 200) {
    throw new Error("Anthropic erro " + code + ": " + JSON.stringify(body.error || body));
  }

  return body;
}

/** MCP dispatcher — ponto único chamado pelo shim */
function gasCallMcp(server, tool, input) {
  switch (server) {
    case "Metabase":
      if (tool === "execute_sql") {
        const sql = (input.native && input.native.query) || input.query || "";
        return gasMetabaseSQL(sql, input.database);
      }
      throw new Error("Metabase tool '" + tool + "' não suportado");

    case "Gmail":
      return gasCallGmail(tool, input);

    case "Google Sheets":
      return gasCallSheets(tool, input);

    default:
      throw new Error("Servidor MCP '" + server + "' não suportado");
  }
}
