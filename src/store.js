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
      gameDay(s.start, CONFIG),
      s.name,
      new Date(s.start),
      new Date(s.end),
      Math.round((s.end - s.start) / 60000),
      s.appId,
    ];
  });
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length);
  range.setValues(rows);
  // The date is in the game day column, so only the clock time is shown.
  range.offset(0, 2, rows.length, 2).setNumberFormat('HH:mm');
}

function readSessions_() {
  return readBody_(getSheet_(SHEETS.sessions), SHEETS.sessions.header.length).map(function (row) {
    return { start: new Date(row[2]).getTime(), end: new Date(row[3]).getTime(), appId: String(row[5]), name: row[1] };
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

function writeGames_(games) {
  var sheet = getSheet_(SHEETS.games);
  var cols = SHEETS.games.header.length;
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, cols).clearContent();
  }
  if (games.length === 0) return;
  var rows = games.map(function (g) {
    return [g.name, g.appId, g.minutes, formatMinutes(g.minutes), g.count, g.firstDay, g.lastDay, g.avgMinutes];
  });
  sheet.getRange(2, 1, rows.length, cols).setValues(rows);
}

/** Writes a games x periods matrix of minutes, rebuilding the sheet since its columns change over time. */
function writeGamePeriods_(def, result) {
  var sheet = getSheet_(def);
  sheet.clear();
  var header = ['ゲーム名', '合計(分)'].concat(result.periods);
  // Weekly periods outgrow the default 26 columns within half a year.
  var missing = header.length - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
  // Plain text, so that period labels like "2026-09" are not parsed as dates.
  sheet.getRange(1, 1, 1, header.length).setNumberFormat('@').setValues([header]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  if (result.games.length === 0) return;
  var rows = result.games.map(function (g) {
    return [g.name, g.total].concat(g.minutes);
  });
  sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
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
