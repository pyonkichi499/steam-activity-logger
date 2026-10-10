const test = require('node:test');
const assert = require('node:assert');
const { step, flush, gameDay, splitByHour, aggregate, aggregateByGame, periodOf, aggregateByGamePeriod, formatMinutes } = require('../src/core.js');

const MIN = 60 * 1000;
const OPTS = { gapMs: 3 * MIN, intervalMs: MIN };
const CFG = { tzOffsetMin: 540, cutoffHour: 4 };
// 2026-09-24 20:00 JST
const T0 = Date.parse('2026-09-24T20:00:00+09:00');

const play = (m, appId = '10', name = 'A') => ({ time: T0 + m * MIN, ok: true, appId, name });
const idle = (m) => ({ time: T0 + m * MIN, ok: true, appId: null });
const fail = (m) => ({ time: T0 + m * MIN, ok: false });

function run(observations, state = { session: null }) {
  const closed = [];
  for (const obs of observations) {
    const r = step(state, obs, OPTS);
    state = r.state;
    closed.push(...r.closed);
  }
  return { state, closed };
}

test('continuous play becomes one session ending at the first idle observation', () => {
  const { state, closed } = run([play(0), play(1), play(2), idle(3)]);
  assert.strictEqual(state.session, null);
  assert.deepStrictEqual(closed, [{ appId: '10', name: 'A', start: T0, end: T0 + 3 * MIN }]);
});

test('failures within the gap are bridged', () => {
  const { closed } = run([play(0), fail(1), fail(2), play(3), idle(4)]);
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(closed[0].end - closed[0].start, 4 * MIN);
});

test('a gap longer than 3 minutes splits the session', () => {
  const { state, closed } = run([play(0), play(1), fail(2), fail(3), fail(4), fail(5), play(6)]);
  assert.deepStrictEqual(closed, [{ appId: '10', name: 'A', start: T0, end: T0 + 2 * MIN }]);
  assert.strictEqual(state.session.start, T0 + 6 * MIN);
});

test('switching games closes the previous session', () => {
  const { state, closed } = run([play(0), play(1), play(2, '20', 'B')]);
  assert.deepStrictEqual(closed, [{ appId: '10', name: 'A', start: T0, end: T0 + 2 * MIN }]);
  assert.strictEqual(state.session.appId, '20');
});

test('step does not mutate the input state', () => {
  const state = { session: { appId: '10', name: 'A', start: T0, lastSeen: T0 } };
  step(state, play(1), OPTS);
  assert.strictEqual(state.session.lastSeen, T0);
});

test('flush closes the open session', () => {
  const { state } = run([play(0), play(1)]);
  const r = flush(state, OPTS);
  assert.strictEqual(r.state.session, null);
  assert.deepStrictEqual(r.closed, [{ appId: '10', name: 'A', start: T0, end: T0 + 2 * MIN }]);
});

test('gameDay uses a 4:00 cutoff in JST', () => {
  assert.strictEqual(gameDay(Date.parse('2026-09-25T03:59:00+09:00'), CFG), '2026-09-24');
  assert.strictEqual(gameDay(Date.parse('2026-09-25T04:00:00+09:00'), CFG), '2026-09-25');
});

test('splitByHour splits at local hour boundaries', () => {
  const start = Date.parse('2026-09-24T20:30:00+09:00');
  const end = Date.parse('2026-09-24T22:15:00+09:00');
  assert.deepStrictEqual(
    splitByHour(start, end, CFG).map((p) => p.minutes),
    [30, 60, 15]
  );
});

test('aggregate splits a session across the 4:00 boundary and counts it on its start day', () => {
  const sessions = [
    { start: Date.parse('2026-09-25T03:00:00+09:00'), end: Date.parse('2026-09-25T05:00:00+09:00') },
  ];
  const since = Date.parse('2026-09-24T12:00:00+09:00'); // Thu game day
  const now = Date.parse('2026-09-25T12:00:00+09:00'); // Fri game day
  const failures = [Date.parse('2026-09-25T10:00:00+09:00')];
  const { daily, heatmap } = aggregate(sessions, failures, since, now, CFG);

  assert.deepStrictEqual(daily, [
    { day: '2026-09-24', weekday: 4, minutes: 60, count: 1, failures: 0 },
    { day: '2026-09-25', weekday: 5, minutes: 60, count: 0, failures: 1 },
  ]);
  // Slot 23 = 3:00 (last hour of Thursday's game day), slot 0 = 4:00 (Friday).
  assert.strictEqual(heatmap[4][23], 60);
  assert.strictEqual(heatmap[5][0], 60);
});

test('formatMinutes', () => {
  assert.strictEqual(formatMinutes(0), '0:00');
  assert.strictEqual(formatMinutes(65), '1:05');
  assert.strictEqual(formatMinutes(600.4), '10:00');
});

test('aggregateByGame totals per game, longest first, with the latest name', () => {
  const s = (startMin, minutes, appId, name) => ({
    appId,
    name,
    start: T0 + startMin * MIN,
    end: T0 + (startMin + minutes) * MIN,
  });
  const sessions = [
    s(0, 30, '10', 'Old Name'),
    s(24 * 60, 60, '20', 'B'),
    s(2 * 24 * 60, 90, '10', 'New Name'),
  ];
  const games = aggregateByGame(sessions, CFG);
  assert.deepStrictEqual(games, [
    { appId: '10', name: 'New Name', minutes: 120, count: 2, firstDay: '2026-09-24', lastDay: '2026-09-26', avgMinutes: 60 },
    { appId: '20', name: 'B', minutes: 60, count: 1, firstDay: '2026-09-25', lastDay: '2026-09-25', avgMinutes: 60 },
  ]);
});

test('aggregateByGame returns an empty list without sessions', () => {
  assert.deepStrictEqual(aggregateByGame([], CFG), []);
});

test('periodOf maps a game day to its month or the Monday of its week', () => {
  assert.strictEqual(periodOf('2026-09-24', 'month'), '2026-09');
  assert.strictEqual(periodOf('2026-09-24', 'week'), '2026-09-21'); // Thursday
  assert.strictEqual(periodOf('2026-09-21', 'week'), '2026-09-21'); // Monday
  assert.strictEqual(periodOf('2026-10-04', 'week'), '2026-09-28'); // Sunday
});

test('aggregateByGamePeriod builds a games x periods matrix, longest total first', () => {
  const DAY = 24 * 60;
  const s = (startMin, minutes, appId, name) => ({
    appId,
    name,
    start: T0 + startMin * MIN,
    end: T0 + (startMin + minutes) * MIN,
  });
  const sessions = [
    s(0, 30, '10', 'Old Name'), // Thu 2026-09-24
    s(4 * DAY, 60, '20', 'B'), // Mon 2026-09-28
    s(8 * DAY, 90, '10', 'New Name'), // Fri 2026-10-02
  ];
  const now = T0 + 10 * DAY * MIN;

  assert.deepStrictEqual(aggregateByGamePeriod(sessions, T0, now, 'week', CFG), {
    periods: ['2026-09-21', '2026-09-28'],
    games: [
      { appId: '10', name: 'New Name', total: 120, minutes: [30, 90] },
      { appId: '20', name: 'B', total: 60, minutes: [0, 60] },
    ],
  });
  assert.deepStrictEqual(aggregateByGamePeriod(sessions, T0, now, 'month', CFG), {
    periods: ['2026-09', '2026-10'],
    games: [
      { appId: '10', name: 'New Name', total: 120, minutes: [30, 90] },
      { appId: '20', name: 'B', total: 60, minutes: [60, 0] },
    ],
  });
});

test('aggregateByGamePeriod splits a session crossing the cutoff into both game days', () => {
  // 2026-10-01 03:30-04:30 JST: the first half belongs to game day 2026-09-30.
  const start = Date.parse('2026-10-01T03:30:00+09:00');
  const sessions = [{ appId: '10', name: 'A', start, end: start + 60 * MIN }];
  const result = aggregateByGamePeriod(sessions, T0, start + 60 * MIN, 'month', CFG);
  assert.deepStrictEqual(result.periods, ['2026-09', '2026-10']);
  assert.deepStrictEqual(result.games[0].minutes, [30, 30]);
});

test('aggregateByGamePeriod drops games played only before logging started', () => {
  const sessions = [{ appId: '10', name: 'A', start: T0 - 8 * 24 * 60 * MIN, end: T0 - 8 * 24 * 60 * MIN + 30 * MIN }];
  assert.deepStrictEqual(aggregateByGamePeriod(sessions, T0, T0, 'week', CFG), { periods: ['2026-09-21'], games: [] });
});
