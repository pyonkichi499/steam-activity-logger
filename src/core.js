/**
 * Pure logic with no Apps Script dependencies, so it can be unit-tested in Node.
 * All times are epoch milliseconds.
 */

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

if (typeof module !== 'undefined') {
  module.exports = { step: step, flush: flush };
}
