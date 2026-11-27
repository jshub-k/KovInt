/**
 * Gmail — usa GmailApp (nativo do GAS, sem service account).
 * Nome do arquivo Gmail_.gs para evitar conflito com namespace Gmail do GAS.
 */

function gasGmailSearch(query, pageSize) {
  const threads = GmailApp.search(query, 0, pageSize || 20);
  return threads.map(t => {
    const msgs = t.getMessages();
    return {
      id: t.getId(),
      messageCount: msgs.length,
      messages: msgs.map(m => ({
        id:           m.getId(),
        threadId:     t.getId(),
        sender:       m.getFrom(),
        subject:      m.getSubject(),
        toRecipients: [m.getTo()],
        ccRecipients: m.getCc() ? [m.getCc()] : [],
      })),
    };
  });
}

function gasGmailGetThread(threadId) {
  const t = GmailApp.getThreadById(threadId);
  if (!t) throw new Error("Thread não encontrada: " + threadId);
  const msgs = t.getMessages();
  return {
    id:      t.getId(),
    viewUrl: "https://mail.google.com/mail/u/0/#inbox/" + t.getId(),
    messages: msgs.map(m => {
      const atts = m.getAttachments().map(a => ({
        id:       a.getName(), // GAS não expõe attachment id diretamente
        filename: a.getName(),
        mimeType: a.getContentType(),
      }));
      return {
        id:                 m.getId(),
        sender:             m.getFrom(),
        addressDisplayNames: m.getFrom(),
        date:               m.getDate().toISOString(),
        internalDate:       String(m.getDate().getTime()),
        labelIds:           [],
        snippet:            m.getPlainBody().slice(0, 200),
        subject:            m.getSubject(),
        plaintextBody:      m.getPlainBody(),
        attachments:        atts,
      };
    }),
  };
}

function gasGmailReply(messageId, body) {
  const msg = GmailApp.getMessageById(messageId);
  if (!msg) throw new Error("Mensagem não encontrada: " + messageId);
  const thread = msg.getThread();
  thread.reply(body);
  return { ok: true, threadId: thread.getId() };
}

/** Dispatcher chamado pelo shim via google.script.run */
function gasCallGmail(tool, input) {
  switch (tool) {
    case "search_threads":
      return gasGmailSearch(input.query, input.pageSize);
    case "get_thread":
      return gasGmailGetThread(input.threadId);
    case "reply":
      return gasGmailReply(input.messageId, input.body);
    default:
      throw new Error("Gmail tool '" + tool + "' não implementado");
  }
}
