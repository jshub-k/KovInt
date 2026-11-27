/**
 * Google Sheets — acesso nativo via SpreadsheetApp.
 */
function gasCallSheets(tool, input) {
  const sid = input.spreadsheetId;
  const ss  = SpreadsheetApp.openById(sid);

  switch (tool) {
    case "get_values": {
      const range = ss.getRange(input.range);
      return { values: range.getValues() };
    }
    case "update_values": {
      const range = ss.getRange(input.range);
      range.setValues(input.values);
      SpreadsheetApp.flush();
      return { ok: true };
    }
    case "append_values": {
      const sheet = ss.getSheets()[0]; // assume primeira aba; KovInt usa range explícito
      sheet.getRange(input.range).getSheet()
        .getRange(ss.getRange(input.range).getLastRow() + 1, 1, input.values.length, input.values[0].length)
        .setValues(input.values);
      SpreadsheetApp.flush();
      return { ok: true };
    }
    case "batch_clear_values": {
      (input.ranges || []).forEach(r => ss.getRange(r).clearContent());
      SpreadsheetApp.flush();
      return { ok: true };
    }
    default:
      throw new Error("Sheets tool '" + tool + "' não implementado");
  }
}
