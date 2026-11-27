/**
 * Gemini API — chamado server-side via UrlFetchApp.
 * Converte entrada/saída no formato Anthropic para o front-end não precisar de alterações.
 */
function gasCallSample(params) {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty("GEMINI_API_KEY") || "";
  if (!key) throw new Error("GEMINI_API_KEY não configurado nas Script Properties.");

  // Modelo: aceita nomes Anthropic (claude-*) e mapeia para Gemini, ou usa Gemini diretamente
  const modelRaw = params.model || "gemini-2.0-flash";
  const model = modelRaw.startsWith("claude") ? "gemini-2.0-flash" : modelRaw;

  // Converte messages (formato Anthropic) → contents (formato Gemini)
  const contents = (params.messages || []).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: Array.isArray(m.content)
      ? m.content.map(c => c.type === "text" ? { text: c.text } : { text: JSON.stringify(c) })
      : [{ text: String(m.content || "") }],
  }));

  const body = {
    contents: contents,
    generationConfig: {
      maxOutputTokens: params.max_tokens || 4096,
      temperature: params.temperature || 0.7,
    },
  };

  // system prompt → systemInstruction
  if (params.system) {
    body.systemInstruction = { parts: [{ text: params.system }] };
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
    + model + ":generateContent?key=" + key;

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };

  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  const data = JSON.parse(resp.getContentText());

  if (code !== 200) {
    throw new Error("Gemini erro " + code + ": " + JSON.stringify((data.error || data)));
  }

  // Converte resposta Gemini → formato Anthropic (o front-end espera content[0].text)
  const text = (data.candidates || [{}])[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  return {
    id: "gemini-" + Date.now(),
    type: "message",
    role: "assistant",
    model: model,
    content: [{ type: "text", text: text }],
    stop_reason: "end_turn",
    usage: {
      input_tokens:  data.usageMetadata?.promptTokenCount     || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
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
