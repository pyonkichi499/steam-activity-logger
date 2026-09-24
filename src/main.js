/**
 * Steam Activity Logger — entry points for triggers and the spreadsheet menu.
 *
 * Every minute, asks the Steam Web API which game is being played.
 * Consecutive observations are merged into play sessions; only finished
 * sessions are written to the sheet, so it grows by one row per session.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Steam Logger')
    .addItem('設定を確認', 'checkSetup')
    .addItem('記録を開始', 'startLogging')
    .addItem('記録を停止', 'stopLogging')
    .addSeparator()
    .addItem('集計を更新', 'updateSummary')
    .addToUi();
}

/** Runs every minute via trigger. Kept minimal to stay within the daily trigger runtime quota. */
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var now = Date.now();
    var obs;
    try {
      var player = fetchPlayer_();
      obs = { time: now, ok: true, appId: player.gameid || null, name: player.gameextrainfo || '' };
    } catch (e) {
      obs = { time: now, ok: false };
      appendError_(now, e.message);
    }
    var result = step(loadState_(), obs, CONFIG);
    appendSessions_(result.closed);
    saveState_(result.state);
  } finally {
    lock.releaseLock();
  }
}

/** Validates Script Properties and profile visibility. */
function checkSetup() {
  var player = fetchPlayer_();
  var status = player.gameextrainfo ? 'ゲーム中: ' + player.gameextrainfo : 'ゲームはしていません';
  SpreadsheetApp.getUi().alert('OK: ' + player.personaname + '（' + status + '）');
}

function startLogging() {
  fetchPlayer_(); // fail fast on bad configuration
  deleteTriggers_();
  ScriptApp.newTrigger(TICK_HANDLER).timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger(SUMMARY_HANDLER).timeBased().everyDays(1).atHour(CONFIG.cutoffHour).nearMinute(15).create();
  var state = loadState_();
  if (!state.since) {
    state.since = Date.now();
    saveState_(state);
  }
  getSheet_(SHEETS.sessions);
  getSheet_(SHEETS.errors);
  SpreadsheetApp.getActive().toast('記録を開始しました。');
}

function stopLogging() {
  deleteTriggers_();
  var result = flush(loadState_(), CONFIG);
  appendSessions_(result.closed);
  saveState_(result.state);
  SpreadsheetApp.getActive().toast('記録を停止しました。');
}

/** Rebuilds the Daily and Heatmap sheets from Sessions and Errors. Runs daily after the cutoff. */
function updateSummary() {
  var sessions = readSessions_();
  var failures = readErrorTimes_();
  var state = loadState_();
  var since = state.since || (sessions.length ? sessions[0].start : Date.now());
  // Count the session still in progress up to its last observation, so a game
  // running across the scheduled rebuild is not missing from the summary.
  sessions = sessions.concat(flush(state, CONFIG).closed);
  var result = aggregate(sessions, failures, since, Date.now(), CONFIG);
  writeDaily_(result.daily);
  writeHeatmap_(result.heatmap);
}

function deleteTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === TICK_HANDLER || fn === SUMMARY_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
