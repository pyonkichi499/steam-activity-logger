/**
 * Settings. Secrets live in Script Properties (Project Settings > Script Properties):
 *   STEAM_API_KEY  Steam Web API key (https://steamcommunity.com/dev/apikey)
 *   STEAM_ID       64-bit SteamID (17 digits)
 */

var CONFIG = {
  tzOffsetMin: 9 * 60, // JST
  cutoffHour: 4, // a "game day" runs from 4:00 to 3:59 the next day
  intervalMs: 60 * 1000, // must match the trigger interval
  gapMs: 3 * 60 * 1000, // gaps up to this long are bridged into one session
};

var SHEETS = {
  sessions: { name: 'Sessions', header: ['開始', '終了', 'ゲーム日', 'AppID', 'ゲーム名', '分'] },
  daily: { name: 'Daily', header: ['ゲーム日', '曜日', '合計(分)', '合計(h:mm)', '回数', '取得失敗'] },
  heatmap: { name: 'Heatmap', header: null },
  errors: { name: 'Errors', header: ['日時', '内容'] },
};

var STATE_KEY = 'STATE';
var TICK_HANDLER = 'tick';
var SUMMARY_HANDLER = 'updateSummary';
