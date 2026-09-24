/**
 * Persistence: session state in Script Properties, records in sheets.
 */

// ---- State ----

function loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  return raw ? JSON.parse(raw) : { session: null, since: null };
}

function saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
}

// ---- Sheets ----

function getSheet_(def) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    if (def.header) {
      sheet.getRange(1, 1, 1, def.header.length).setValues([def.header]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function appendSessions_(sessions) {
  if (sessions.length === 0) return;
  var sheet = getSheet_(SHEETS.sessions);
  var rows = sessions.map(function (s) {
    return [
      new Date(s.start),
      new Date(s.end),
      gameDay(s.start, CONFIG),
      s.appId,
      s.name,
      Math.round((s.end - s.start) / 60000),
    ];
  });
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length);
  range.setValues(rows);
  range.offset(0, 0, rows.length, 2).setNumberFormat('yyyy/MM/dd HH:mm');
}

function readSessions_() {
  return readBody_(getSheet_(SHEETS.sessions), 2).map(function (row) {
    return { start: new Date(row[0]).getTime(), end: new Date(row[1]).getTime() };
  });
}

function appendError_(time, message) {
  getSheet_(SHEETS.errors).appendRow([new Date(time), message]);
}

function readErrorTimes_() {
  return readBody_(getSheet_(SHEETS.errors), 1).map(function (row) {
    return new Date(row[0]).getTime();
  });
}

function writeDaily_(daily) {
  var sheet = getSheet_(SHEETS.daily);
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, SHEETS.daily.header.length).clearContent();
  }
  if (daily.length === 0) return;
  var rows = daily.map(function (d) {
    return [d.day, WEEKDAY_LABELS[d.weekday], d.minutes, formatMinutes(d.minutes), d.count, d.failures];
  });
  sheet.getRange(2, 1, rows.length, SHEETS.daily.header.length).setValues(rows);
}

function writeHeatmap_(heatmap) {
  var sheet = getSheet_(SHEETS.heatmap);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  var header = ['曜日＼時'];
  for (var slot = 0; slot < 24; slot++) {
    header.push(((CONFIG.cutoffHour + slot) % 24) + '時');
  }
  var order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
  var rows = order.map(function (w) {
    return [WEEKDAY_LABELS[w]].concat(
      heatmap[w].map(function (m) {
        return Math.round(m * 10) / 10;
      })
    );
  });

  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.getRange(rows.length + 3, 1).setValue('値は1日あたりの平均プレイ時間（分）');

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.NUMBER, '0')
      .setGradientMaxpointWithValue('#1a73e8', SpreadsheetApp.InterpolationType.NUMBER, '60')
      .setRanges([sheet.getRange(2, 2, rows.length, 24)])
      .build(),
  ]);
  sheet.setColumnWidths(2, 24, 44);
}

function readBody_(sheet, cols) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, cols)
    .getValues()
    .filter(function (row) {
      return row[0] !== '';
    });
}
