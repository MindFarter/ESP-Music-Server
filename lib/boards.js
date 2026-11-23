// Talks to a board through the routes of its LCD Wizard Web server widget:
//   GET  <dataPath>  -> the design's variables as JSON            (default /api/data)
//   POST <setPath>   -> sets each variable it is sent a value for  (default /api/set)
// Both are the routes LCD Wizard writes the first answer for, so a design only has to add the
// routes and an automation that plays whatever address arrives (see board/README).
import { get as settings } from './settings.js';

// Only talk to things on the local network: this server must not become a way to poke the internet.
export function isLanHost(host) {
  const h = host.replace(/:\d+$/, '').toLowerCase();
  if (/^[a-z][a-z0-9-]*(\.local)?$/.test(h)) return true;                       // kitchen, kitchen.local (a letter first: 0x08080808 is an address, not a name)
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function headers(board, extra = {}) {
  const h = { 'X-LW': '1', ...extra };
  if (board.user || board.password) h.Authorization = 'Basic ' + Buffer.from(`${board.user}:${board.password}`).toString('base64');
  return h;
}

export const find = id => settings().boards.find(b => b.id === id);

export async function push(board, fields) {
  if (!isLanHost(board.host)) throw new Error('Boards must be on your local network');
  const r = await fetch(`http://${board.host}${board.setPath}`, {
    method: 'POST',
    headers: headers(board, { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`The board answered ${r.status}`);
}

export async function status(board) {
  if (!isLanHost(board.host)) return { online: false };
  try {
    const r = await fetch(`http://${board.host}${board.dataPath}`, { headers: headers(board), signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { online: true, error: `HTTP ${r.status}` };
    return { online: true, data: await r.json() };
  } catch {
    return { online: false };
  }
}

// ---------- queues ----------
// A board plays one address at a time. To keep it going, the server watches the design's "Playing"
// variable (bind it to Audio > Playing and expose it in the data route) and, when a track that was
// playing stops, sends the next address. This is the same polling idea as reading a sensor board.
const queues = new Map();                       // boardId -> queue
const POLL_MS = Number(process.env.ESPMS_POLL_MS) || 3000;
const truthy = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

export function queueInfo(boardId) {
  const q = queues.get(boardId);
  return q ? { length: q.ids.length, index: q.index, trackId: q.ids[q.index], warning: q.warning || '' } : null;
}

// Hosts of boards whose queue this server is running, so a board's own page knows not to send "next" as well.
export const managedHosts = () => [...queues.keys()].map(id => find(id)?.host).filter(Boolean);

export function stopQueue(boardId) {
  const q = queues.get(boardId);
  if (q) { clearInterval(q.timer); queues.delete(boardId); }
}

async function go(board, q, index) {
  if (index < 0 || index >= q.ids.length) { stopQueue(board.id); await push(board, { [board.urlField]: '' }).catch(() => {}); return false; }
  await push(board, { [board.urlField]: q.makeUrl(q.ids[index]) });
  q.index = index; q.seen = false; q.idle = false; q.misses = 0; q.pushedAt = Date.now();
  return true;
}

export async function startQueue(board, ids, makeUrl, start = 0, durationOf = () => 0) {
  stopQueue(board.id);
  const q = { ids, index: -1, makeUrl, durationOf, seen: false, idle: false, misses: 0, busy: false, pushedAt: 0, warning: '' };
  queues.set(board.id, q);
  try { await go(board, q, start); } catch (e) { stopQueue(board.id); throw e; }
  q.timer = setInterval(async () => {
    if (q.busy) return;
    q.busy = true;
    try {
      const s = await status(board);
      if (!s.online || !s.data) {
        if (++q.misses > 100) stopQueue(board.id);              // about 5 minutes of silence: stop watching a board that is gone
        return;
      }
      q.misses = 0;
      if (!(board.playingField in s.data)) {
        q.warning = `The board's data route does not report "${board.playingField}", so the queue cannot move on by itself.`;
        clearInterval(q.timer);
        return;
      }
      const elapsed = Date.now() - q.pushedAt;
      if (truthy(s.data[board.playingField])) { q.seen = true; q.idle = false; }
      else if (q.seen) {
        q.seen = false;
        // Stopped before the track could have finished: someone stopped it by hand, so wait instead of skipping on.
        if (elapsed >= (q.durationOf(q.ids[q.index]) - 5) * 1000) await go(board, q, q.index + 1);
        else q.idle = true;
      } else if (!q.idle && elapsed > 20000) {                       // never started: a bad address would otherwise freeze the queue
        q.warning = 'The board did not start playing this track.';
        clearInterval(q.timer);
      }
    } catch { /* try again on the next tick */ } finally { q.busy = false; }
  }, POLL_MS);
  q.timer.unref?.();
}

export const step = (board, by) => {
  const q = queues.get(board.id);
  if (!q) throw new Error('Nothing is queued for this board');
  return go(board, q, q.index + by);
};
