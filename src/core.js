/**
 * Pure logic with no Apps Script dependencies, so it can be unit-tested in Node.
 * All times are epoch milliseconds.
 */

var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;
var WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * Advances the session state machine by one observation.
 *
 * @param {{session: ?{appId:string, name:string, start:number, lastSeen:number}}} state
 * @param {{time:number, ok:boolean, appId:?string, name:?string}} obs
 *   ok=false means the fetch failed; appId=null means "not playing".
 * @param {{gapMs:number, intervalMs:number}} opts
 * @return {{state: Object, closed: Array<{appId:string, name:string, start:number, end:number}>}}
 */
function step(state, obs, opts) {
  var session = state.session ? Object.assign({}, state.session) : null;
  var closed = [];
  var next = Object.assign({}, state);

  // A failed fetch tells us nothing; the gap check on the next success decides.
  if (!obs.ok) {
    return { state: next, closed: closed };
  }

  var playing = obs.appId != null;
  if (session) {
    var withinGap = obs.time - session.lastSeen <= opts.gapMs;
    if (playing && withinGap && session.appId === obs.appId) {
      session.lastSeen = obs.time;
      next.session = session;
      return { state: next, closed: closed };
    }
    // Stopped, switched games, or the gap was too long to bridge.
    var end = withinGap ? obs.time : session.lastSeen + opts.intervalMs;
    closed.push(toClosed_(session, end));
    session = null;
  }
  if (playing) {
    session = { appId: obs.appId, name: obs.name || '', start: obs.time, lastSeen: obs.time };
  }
  next.session = session;
  return { state: next, closed: closed };
}

/** Closes the open session (if any), e.g. when logging is stopped. */
function flush(state, opts) {
  var next = Object.assign({}, state, { session: null });
  if (!state.session) return { state: next, closed: [] };
  return { state: next, closed: [toClosed_(state.session, state.session.lastSeen + opts.intervalMs)] };
}

function toClosed_(session, end) {
  return { appId: session.appId, name: session.name, start: session.start, end: end };
}

/**
 * Returns the "game day" (YYYY-MM-DD) a moment belongs to: days start at
 * cutoffHour local time instead of midnight.
 */
function gameDay(time, cfg) {
  var shifted = new Date(time + cfg.tzOffsetMin * MINUTE_MS - cfg.cutoffHour * HOUR_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Weekday index (0=Sun) of a YYYY-MM-DD string. */
function weekdayOf(day) {
  return new Date(day + 'T00:00:00Z').getUTCDay();
}

/** Local clock hour (0-23) of a moment. */
function localHour(time, cfg) {
  return new Date(time + cfg.tzOffsetMin * MINUTE_MS).getUTCHours();
}

/** Splits [start, end) at local hour boundaries. */
function splitByHour(start, end, cfg) {
  var pieces = [];
  var offset = cfg.tzOffsetMin * MINUTE_MS;
  var t = start;
  while (t < end) {
    var nextHour = Math.floor((t + offset) / HOUR_MS) * HOUR_MS + HOUR_MS - offset;
    var pieceEnd = Math.min(nextHour, end);
    pieces.push({ start: t, minutes: (pieceEnd - t) / MINUTE_MS });
    t = pieceEnd;
  }
  return pieces;
}

/** Lists YYYY-MM-DD strings from `from` to `to` inclusive. */
function dayRange(from, to) {
  var days = [];
  for (var t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Aggregates sessions into per-day totals and a weekday x hour heatmap.
 *
 * @param {Array<{start:number, end:number}>} sessions
 * @param {Array<number>} failureTimes timestamps of failed fetches
 * @param {number} since when logging started
 * @param {number} now
 * @param {{tzOffsetMin:number, cutoffHour:number}} cfg
 * @return {{daily: Array<{day:string, weekday:number, minutes:number, count:number, failures:number}>,
 *           heatmap: Array<Array<number>>}}
 *   heatmap[weekday][slot] is the average minutes played per day, where slot 0
 *   is the cutoff hour (e.g. 4:00) and slot 23 the hour before it.
 */
function aggregate(sessions, failureTimes, since, now, cfg) {
  var days = dayRange(gameDay(since, cfg), gameDay(now, cfg));
  var byDay = {};
  days.forEach(function (day) {
    byDay[day] = { day: day, weekday: weekdayOf(day), minutes: 0, count: 0, failures: 0 };
  });
  var totals = [];
  for (var w = 0; w < 7; w++) totals.push(new Array(24).fill(0));

  sessions.forEach(function (s) {
    var startDay = byDay[gameDay(s.start, cfg)];
    if (startDay) startDay.count++;
    splitByHour(s.start, s.end, cfg).forEach(function (piece) {
      var d = byDay[gameDay(piece.start, cfg)];
      if (!d) return;
      d.minutes += piece.minutes;
      var slot = (localHour(piece.start, cfg) - cfg.cutoffHour + 24) % 24;
      totals[d.weekday][slot] += piece.minutes;
    });
  });
  failureTimes.forEach(function (t) {
    var d = byDay[gameDay(t, cfg)];
    if (d) d.failures++;
  });

  var dayCounts = new Array(7).fill(0);
  days.forEach(function (day) {
    dayCounts[weekdayOf(day)]++;
  });
  var heatmap = totals.map(function (row, weekday) {
    return row.map(function (minutes) {
      return dayCounts[weekday] ? minutes / dayCounts[weekday] : 0;
    });
  });

  var daily = days.map(function (day) {
    var d = byDay[day];
    d.minutes = Math.round(d.minutes);
    return d;
  });
  return { daily: daily, heatmap: heatmap };
}

/**
 * Aggregates sessions per game, longest total first. The name is taken from
 * the game's most recent session, since Steam may rename a game.
 *
 * @param {Array<{appId:string, name:string, start:number, end:number}>} sessions
 * @param {{tzOffsetMin:number, cutoffHour:number}} cfg
 * @return {Array<{appId:string, name:string, minutes:number, count:number,
 *                 firstDay:string, lastDay:string, avgMinutes:number}>}
 */
function aggregateByGame(sessions, cfg) {
  var byGame = {};
  sessions.forEach(function (s) {
    var g = byGame[s.appId];
    if (!g) {
      g = byGame[s.appId] = { appId: s.appId, name: s.name, minutes: 0, count: 0, firstStart: s.start, lastStart: s.start };
    }
    g.minutes += (s.end - s.start) / MINUTE_MS;
    g.count++;
    if (s.start < g.firstStart) g.firstStart = s.start;
    if (s.start >= g.lastStart) {
      g.lastStart = s.start;
      g.name = s.name;
    }
  });
  return Object.keys(byGame)
    .map(function (appId) {
      var g = byGame[appId];
      return {
        appId: g.appId,
        name: g.name,
        minutes: Math.round(g.minutes),
        count: g.count,
        firstDay: gameDay(g.firstStart, cfg),
        lastDay: gameDay(g.lastStart, cfg),
        avgMinutes: Math.round(g.minutes / g.count),
      };
    })
    .sort(function (a, b) {
      return b.minutes - a.minutes;
    });
}

/**
 * Returns the period a game day belongs to: "YYYY-MM" for unit "month", or
 * the Monday that starts its week ("YYYY-MM-DD") for unit "week".
 */
function periodOf(day, unit) {
  if (unit === 'month') return day.slice(0, 7);
  var daysSinceMonday = (weekdayOf(day) + 6) % 7;
  return new Date(Date.parse(day + 'T00:00:00Z') - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Aggregates minutes per game and period, as a games x periods matrix. Like
 * the daily totals, play is split at hour boundaries so a session crossing
 * the cutoff counts toward each game day it covers.
 *
 * @param {Array<{appId:string, name:string, start:number, end:number}>} sessions
 * @param {number} since when logging started
 * @param {number} now
 * @param {string} unit "week" or "month"
 * @param {{tzOffsetMin:number, cutoffHour:number}} cfg
 * @return {{periods: Array<string>,
 *           games: Array<{appId:string, name:string, total:number, minutes:Array<number>}>}}
 *   periods are oldest first; games[i].minutes[j] is the play time in periods[j].
 */
function aggregateByGamePeriod(sessions, since, now, unit, cfg) {
  var periods = [];
  dayRange(gameDay(since, cfg), gameDay(now, cfg)).forEach(function (day) {
    var p = periodOf(day, unit);
    if (periods[periods.length - 1] !== p) periods.push(p);
  });
  var indexOf = {};
  periods.forEach(function (p, i) {
    indexOf[p] = i;
  });

  var byGame = {};
  sessions.forEach(function (s) {
    var g = byGame[s.appId];
    if (!g) {
      g = byGame[s.appId] = { appId: s.appId, name: s.name, lastStart: s.start, minutes: new Array(periods.length).fill(0) };
    }
    if (s.start >= g.lastStart) {
      g.lastStart = s.start;
      g.name = s.name;
    }
    splitByHour(s.start, s.end, cfg).forEach(function (piece) {
      var i = indexOf[periodOf(gameDay(piece.start, cfg), unit)];
      if (i !== undefined) g.minutes[i] += piece.minutes;
    });
  });

  return {
    periods: periods,
    games: Object.keys(byGame)
      .map(function (appId) {
        var g = byGame[appId];
        var minutes = g.minutes.map(Math.round);
        var total = minutes.reduce(function (sum, m) {
          return sum + m;
        }, 0);
        return { appId: g.appId, name: g.name, total: total, minutes: minutes };
      })
      .filter(function (g) {
        return g.total > 0;
      })
      .sort(function (a, b) {
        return b.total - a.total;
      }),
  };
}

/** Formats minutes as "H:MM". */
function formatMinutes(minutes) {
  var total = Math.round(minutes);
  var h = Math.floor(total / 60);
  var m = total % 60;
  return h + ':' + (m < 10 ? '0' : '') + m;
}

if (typeof module !== 'undefined') {
  module.exports = {
    step: step,
    flush: flush,
    gameDay: gameDay,
    splitByHour: splitByHour,
    dayRange: dayRange,
    aggregate: aggregate,
    aggregateByGame: aggregateByGame,
    periodOf: periodOf,
    aggregateByGamePeriod: aggregateByGamePeriod,
    formatMinutes: formatMinutes,
    WEEKDAY_LABELS: WEEKDAY_LABELS,
  };
}
