/**
 * KovInt · Google Apps Script
 * doGet() serve o app como Web App.
 * Funções server-side são chamadas via google.script.run no cliente.
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("KovInt")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
}

/** Config pública: retorna tokens que o cliente precisa antes de autenticar. */
function gasGetConfig() {
  const p = PropertiesService.getScriptProperties();
  return {
    supabase_url:      p.getProperty("SUPABASE_URL")      || "",
    supabase_anon_key: p.getProperty("SUPABASE_ANON_KEY") || "",
    mapbox_token:      p.getProperty("MAPBOX_TOKEN")       || "",
    allowed_domain:    p.getProperty("ALLOWED_DOMAIN")     || "kovi.com.br",
  };
}

/** Usuário autenticado (GAS já garante auth pelo domínio). */
function gasGetUser() {
  const user = Session.getActiveUser();
  const email = user.getEmail();
  return {
    id:    email,          // sem Supabase auth, usamos o e-mail como id
    email: email,
    name:  Session.getEffectiveUser().getEmail(), // nome via admin SDK não disponível no V8 padrão
  };
}
