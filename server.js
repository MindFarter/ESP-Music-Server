// ESP Music Server V0.0.2. Run it with: node server.js
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as settings from './lib/settings.js';
import * as lib from './lib/library.js';
import * as playlist from './lib/playlist.js';
import * as boards from './lib/boards.js';
import * as pack from './lib/boardpack.js';
import * as plugins from './lib/plugins.js';
import { streamTrack, ffmpegOk } from './lib/stream.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = settings.get;

// ---------- helpers ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const json = (res, body, code = 200) => send(res, code, body);
const fail = (res, code, message) => json(res, { error: message }, code);

async function readBody(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('That upload is too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
// Only JSON is accepted, which a web page on another site cannot send without our permission (the browser asks first, and we say no).
const readJson = async req => {
  const b = await readBody(req, 64 * 1024);
  if (!b.length) return {};
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw NEED_JSON;
  return JSON.parse(b.toString('utf8'));
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
const isLoopback = h => /^(localhost|127\.|\[?::1)/i.test(h);
function baseFor(req) {
  let host = req.headers.host || `localhost:${S().port}`;
  if (isLoopback(host)) host = `${lanAddresses()[0] || 'localhost'}:${S().port}`;
  return `http://${host}`;
}
// For a push to a board, use the server address on the same subnet as that board.
function baseForBoard(board) {
  const lan = lanAddresses();
  const pre = /^(\d+\.\d+\.\d+)\./.exec(board.host)?.[1];
  const ip = (pre && lan.find(a => a.startsWith(pre + '.'))) || lan[0] || 'localhost';
  return `http://${ip}:${S().port}`;
}

// Optional admin password. Streams, playlists and browsing stay open: a board cannot log in.
function isAdmin(req) {
  const pw = S().adminPassword;
  if (!pw) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  return settings.checkPassword(Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':'));
}
const needAdmin = (req, res) => {
  if (isAdmin(req)) return false;
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="ESP Music Server"', 'Content-Type': 'application/json' });
  res.end('{"error":"Sign in to change settings"}');
  return true;
};

const pubTrack = t => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, albumId: lib.albumId(t), no: t.no, duration: t.duration, bitrate: t.bitrate, year: t.year, genre: t.genre });
const CORS = { 'Access-Control-Allow-Origin': '*' };      // read-only endpoints, so a board-hosted page can browse the library
const NEED_JSON = Object.assign(new Error('Send application/json'), { statusCode: 415 });

// ---------- routing ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // No CORS answer to a preflight: the board page only makes plain GETs, and refusing here keeps other sites from posting JSON to the admin API.
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // static
    if (STATIC[p] && (req.method === 'GET' || req.method === 'HEAD')) {
      const [file, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(here, 'public', file)), type, { 'Cache-Control': 'no-cache' });
    }
    if (p === '/theme.css') return send(res, 200, settings.themeCss(), 'text/css; charset=utf-8', { 'Cache-Control': 'no-cache', ...CORS });
    if (p === '/logo') {
      const lp = settings.logoPath();
      if (!lp) return fail(res, 404, 'No logo set');
      const type = settings.LOGO_MIME[path.extname(lp).slice(1)] || 'application/octet-stream';
      // An SVG can carry script: serve it so that nothing in it can run.
      return send(res, 200, fs.readFileSync(lp), type, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", ...CORS });
    }

    // audio
    let m = /^\/stream\/([0-9a-f]{12})\.mp3$/.exec(p);
    if (m) {
      const t = lib.getTrack(m[1]);
      if (!t) return fail(res, 404, 'No such track');
      return streamTrack(req, res, t, url.searchParams.get('p') || S().defaultProfile);
    }
    if (p.startsWith('/playlist/') && p.endsWith('.m3u')) {
      if (p === '/playlist/radio.m3u') {
        const lines = ['#EXTM3U'];
        for (const radio of S().radios) lines.push(`#EXTINF:-1,${radio.name.replace(/[\r\n]/g, ' ')}`, radio.url);
        return send(res, 200, lines.join('\n') + '\n', 'audio/x-mpegurl; charset=utf-8', { 'Cache-Control': 'no-store', ...CORS });
      }
      const spec = playlist.forRequest(url);
      if (!spec) return fail(res, 404, 'No such playlist');
      const body = playlist.build({ base: baseFor(req), profile: spec.profile || S().defaultProfile, ...spec });
      return send(res, 200, body, 'audio/x-mpegurl; charset=utf-8', { 'Cache-Control': 'no-store', ...CORS });
    }
    m = /^\/art\/([0-9a-f]{12})$/.exec(p);
    if (m) {
      const t = lib.getTrack(m[1]);
      const a = t && await lib.art(t);
      if (!a) return fail(res, 404, 'No cover art');
      return send(res, 200, a.data, a.mime, { 'Cache-Control': 'max-age=86400', ...CORS });
    }

    // read-only API
    if (p === '/api/theme' && req.method === 'GET') return json(res, { ...S().theme, logo: !!S().logo }, 200);
    if (p === '/api/info') {
      const port = S().port;
      return json(res, {
        lan: lanAddresses().map(a => `http://${a}:${port}`), ffmpeg: ffmpegOk, profiles: settings.PROFILES,
        defaultProfile: S().defaultProfile, scan: lib.status, tracks: lib.all().length, protected: !!S().adminPassword,
      });
    }
    if (p === '/api/browse/artists') return send(res, 200, JSON.stringify(lib.artists()), 'application/json', CORS);
    if (p === '/api/browse/genres') return send(res, 200, JSON.stringify(lib.genres()), 'application/json', CORS);
    if (p === '/api/browse/albums') return send(res, 200, JSON.stringify(lib.albums({ artist: url.searchParams.get('artist') || undefined })), 'application/json', CORS);
    if (p === '/api/browse/tracks') {
      const q = url.searchParams;
      const list = lib.find({ q: q.get('q'), artist: q.get('artist'), album: q.get('album'), genre: q.get('genre'), sort: q.get('sort') || 'order' });
      const off = Math.max(0, Number(q.get('offset')) || 0), lim = Math.min(500, Number(q.get('limit')) || 100);
      return send(res, 200, JSON.stringify({ total: list.length, items: list.slice(off, off + lim).map(pubTrack) }), 'application/json', CORS);
    }
    if (p === '/api/playlists') return json(res, playlist.catalogue());
    if (p === '/api/radios' && req.method === 'GET') return send(res, 200, JSON.stringify(S().radios), 'application/json', CORS);
    if (p === '/api/managed') return send(res, 200, JSON.stringify({ hosts: boards.managedHosts() }), 'application/json', { 'Cache-Control': 'no-store', ...CORS });

    // ----- admin API -----
    const adminRoute = (p.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(req.method)) ||
      p === '/api/settings' || p === '/api/boardpack.zip' || /^\/api\/boards/.test(p) || p.startsWith('/api/plugins');
    if (adminRoute) {
      if (needAdmin(req, res)) return;
    }
    if (p === '/api/radios' && req.method === 'POST') return json(res, settings.upsertRadio(await readJson(req)));
    m = /^\/api\/radios\/([0-9a-f]{8})$/.exec(p);
    if (m && req.method === 'DELETE') { settings.removeRadio(m[1]); return json(res, { ok: true }); }
    if (p === '/api/plugins' && req.method === 'GET') return json(res, plugins.list());
    m = /^\/api\/plugins\/([a-z0-9][a-z0-9-]{0,39})\/search$/.exec(p);
    if (m && req.method === 'GET') return json(res, await plugins.search(m[1], url.searchParams.get('q') || ''));
    m = /^\/api\/plugins\/([a-z0-9][a-z0-9-]{0,39})\/resolve$/.exec(p);
    if (m && req.method === 'POST') return json(res, await plugins.resolve(m[1], (await readJson(req)).itemId));
    if (p === '/api/settings' && req.method === 'GET') {
      const s = S();
      return json(res, { musicDirs: s.musicDirs, defaultProfile: s.defaultProfile, rescanMinutes: s.rescanMinutes, hasPassword: !!s.adminPassword, theme: s.theme, presets: settings.THEME_PRESETS, logo: !!s.logo });
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      const body = await readJson(req);
      settings.updateGeneral(body);
      if (body.rescan !== false) lib.scan().catch(() => {});
      return json(res, { ok: true });
    }
    if (p === '/api/theme' && req.method === 'PUT') { settings.updateTheme(await readJson(req)); return json(res, { ok: true }); }
    if (p === '/api/logo' && req.method === 'POST') {
      settings.setLogo(await readBody(req, 1024 * 1024 + 1), req.headers['content-type']);       // an image type, so a page on another site cannot send it unasked
      return json(res, { ok: true });
    }
    if (p === '/api/logo' && req.method === 'DELETE') { settings.clearLogo(); return json(res, { ok: true }); }
    if (p === '/api/rescan' && req.method === 'POST') { lib.scan().catch(() => {}); return json(res, { ok: true }); }

    if (p === '/api/boards' && req.method === 'GET') return json(res, S().boards.map(settings.publicBoard));
    if (p === '/api/boards' && req.method === 'POST') {
      const body = await readJson(req);
      const old = body.id && boards.find(body.id);
      if (old && body.password === '********') body.password = old.password;       // the UI never sees the real one
      return json(res, settings.publicBoard(settings.upsertBoard(body)));
    }
    m = /^\/api\/boards\/([0-9a-f]{8})(?:\/(\w+))?$/.exec(p);
    if (m) {
      const board = boards.find(m[1]);
      if (!board) return fail(res, 404, 'No such board');
      if (!m[2] && req.method === 'DELETE') { boards.stopQueue(board.id); settings.removeBoard(board.id); return json(res, { ok: true }); }
      if (m[2] === 'status') return json(res, { ...(await boards.status(board)), queue: boards.queueInfo(board.id) });
      if (req.method === 'POST') {
        const body = await readJson(req);
        const makeUrl = id => `${baseForBoard(board)}/stream/${id}.mp3?p=${board.profile}`;
        if (m[2] === 'play') {
          const t = lib.getTrack(body.trackId);
          if (!t) return fail(res, 404, 'No such track');
          boards.stopQueue(board.id);
          await boards.push(board, { [board.urlField]: makeUrl(t.id) });
          return json(res, { ok: true, url: makeUrl(t.id) });
        }
        if (m[2] === 'url') {
          const streamUrl = settings.validStreamUrl(body.url);
          boards.stopQueue(board.id);
          await boards.push(board, { [board.urlField]: streamUrl });
          return json(res, { ok: true, url: streamUrl });
        }
        if (m[2] === 'radio') {
          const radio = S().radios.find(item => item.id === body.radioId);
          if (!radio) return fail(res, 404, 'No such radio station');
          boards.stopQueue(board.id);
          await boards.push(board, { [board.urlField]: radio.url });
          return json(res, { ok: true, url: radio.url });
        }
        if (m[2] === 'queue') {
          let ids = (Array.isArray(body.trackIds) ? body.trackIds : []).filter(id => lib.getTrack(id)).slice(0, 1000);
          if (!ids.length) return fail(res, 400, 'Nothing to queue');
          if (body.shuffle) for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
          await boards.startQueue(board, ids, makeUrl, Math.max(0, Number(body.start) || 0), id => lib.getTrack(id)?.duration || 0);
          return json(res, { ok: true, queued: ids.length });
        }
        if (m[2] === 'next' || m[2] === 'prev') {
          await boards.step(board, m[2] === 'next' ? 1 : -1);
          return json(res, { ok: true });
        }
        if (m[2] === 'stop') { boards.stopQueue(board.id); await boards.push(board, { [board.urlField]: '' }); return json(res, { ok: true }); }
        if (m[2] === 'volume') {
          const v = Math.max(0, Math.min(100, Math.round(Number(body.volume))));
          await boards.push(board, { [board.volumeField]: String(v) });
          return json(res, { ok: true, volume: v });
        }
      }
    }
    if (p === '/api/boardpack.zip') {
      const origin = url.searchParams.get('server') || lanAddresses().map(a => `http://${a}:${S().port}`)[0] || baseFor(req);
      if (!/^https?:\/\/[\w.\-:]+$/.test(origin)) return fail(res, 400, 'That server address is not valid');
      const prof = settings.PROFILES[url.searchParams.get('profile')] ? url.searchParams.get('profile') : S().defaultProfile;
      return send(res, 200, pack.zip(pack.files({ server: origin, profile: prof })), 'application/zip', { 'Content-Disposition': 'attachment; filename="esp-music-server-board-pack.zip"' });
    }

    fail(res, 404, 'Not found');
  } catch (e) {
    if (!res.headersSent) fail(res, e.statusCode || (e instanceof SyntaxError ? 400 : 500), e.message || 'Something went wrong');
    else res.end();
  }
});

// ---------- start ----------
await plugins.load();
server.listen(S().port, '0.0.0.0', () => {
  console.log(`ESP Music Server V0.0.2 on port ${S().port}`);
  for (const a of lanAddresses()) console.log(`  http://${a}:${S().port}`);
  if (!ffmpegOk) console.log('  ffmpeg not found: only MP3 files can be sent to boards, and not re-encoded for small boards.');
  if (!S().musicDirs.length) console.log('  No music folder set yet: open the page and add one under Settings.');
  else lib.scan().then(() => console.log(`  ${lib.all().length} tracks in the library`)).catch(e => console.log('  scan failed:', e.message));
});
setInterval(() => { if (S().rescanMinutes > 0 && S().musicDirs.length) lib.scan().catch(() => {}); }, 60 * 1000 * Math.max(1, S().rescanMinutes || 30)).unref();
export { server };
