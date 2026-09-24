/**
 * Steam Web API access.
 */

/** Returns the player summary, throwing on misconfiguration or API failure. */
function fetchPlayer_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('STEAM_API_KEY');
  var steamId = props.getProperty('STEAM_ID');
  if (!apiKey || !steamId) {
    throw new Error('Script Properties に STEAM_API_KEY と STEAM_ID を設定してください。');
  }
  var url =
    'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/' +
    '?key=' + encodeURIComponent(apiKey) +
    '&steamids=' + encodeURIComponent(steamId);
  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    // Network errors quote the request URL, which contains the API key.
    throw new Error(e.message.split(apiKey).join('***'));
  }
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Steam API error: HTTP ' + code);
  }
  var players = JSON.parse(res.getContentText()).response.players;
  if (!players || players.length === 0) {
    throw new Error('プレイヤーが見つかりません。STEAM_ID を確認してください。');
  }
  var player = players[0];
  if (player.communityvisibilitystate !== 3) {
    throw new Error('プロフィールが非公開のため、プレイ中のゲームを取得できません。');
  }
  return player;
}
