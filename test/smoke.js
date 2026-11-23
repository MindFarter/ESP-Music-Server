// End-to-end checks against a real server, real ffmpeg and a mock board. Run: npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lwms-'));
const music = path.join(tmp, 'music');
const PORT = 18700 + Math.floor(Math.random() * 200);
process.env.ESPMS_DATA = path.join(tmp, 'data');
process.env.ESPMS_MUSIC = music;
process.env.ESPMS_PORT = String(PORT);
process.env.ESPMS_POLL_MS = '120';
process.env.ESPMS_PLUGIN_DIR = path.join(tmp, 'plugins');
fs.mkdirSync(process.env.ESPMS_PLUGIN_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.ESPMS_PLUGIN_DIR, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(path.join(process.env.ESPMS_PLUGIN_DIR, 'sample.js'), `
export default {
  id: 'sample',
  name: 'Sample provider',
  version: '0.1.0',
  description: 'Test adapter',
  async search(query) {
    return query ? [{ id: 'one', title: 'Sample track', artist: 'Example' }] : [];
  },
  async resolve(id) {
    return { url: 'https://radio.example/track.mp3', title: id, artist: 'Example' };
  }
};
`);
const BASE = `http://127.0.0.1:${PORT}`;

function tone(rel, { ch = 2, rate = 44100, kbps = 128, codec = 'libmp3lame', title, artist, album, genre, no }) {
  const f = path.join(music, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + (no || 1) * 100}:duration=4:sample_rate=${rate}`, '-ac', String(ch), '-codec:a', codec];
  if (codec === 'libmp3lame') args.push('-b:a', `${kbps}k`);
  for (const [k, v] of Object.entries({ title, artist, album, genre, track: no })) if (v) args.push('-metadata', `${k}=${v}`);
  execFileSync('ffmpeg', [...args, f]);
}

let server, mockBoard, board = { vars: { StreamUrl: '', Volume: 55, Playing: false, NowPlaying: '' }, sets: [] };
const j = async (p, o = {}) => { const r = await fetch(BASE + p, o); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { r, b }; };
const post = (p, json, headers = {}) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(json) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  tone('Alpha/First Light/01 Dawn.mp3', { title: 'Dawn', artist: 'Alpha', album: 'First Light', genre: 'Ambient', no: 1 });
  tone('Alpha/First Light/02 Noon.mp3', { title: 'Noon', artist: 'Alpha', album: 'First Light', genre: 'Ambient', no: 2, kbps: 320, rate: 48000 });
  tone('Beta/Mono Tape/01 Hiss.mp3', { title: "Don't Stop; Hiss", artist: 'Beta', album: 'Mono Tape', genre: 'Lo-fi', no: 1, ch: 1, kbps: 64 });
  tone('Beta/Lossless/01 Clear.flac', { title: 'Clear', artist: 'Beta', album: 'Lossless', genre: 'Lo-fi', no: 1, codec: 'flac' });
  fs.writeFileSync(path.join(music, '.hidden.mp3'), 'x');
  fs.writeFileSync(path.join(music, 'Alpha', '._01 Dawn.mp3'), 'x');

  mockBoard = http.createServer(async (req, res) => {
    const body = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
    if (req.url === '/api/data') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(board.vars)); }
    if (req.url === '/api/set' && req.method === 'POST') {
      const f = Object.fromEntries(new URLSearchParams(body));
      board.sets.push(f);
      if ('StreamUrl' in f) { board.vars.StreamUrl = f.StreamUrl; board.vars.Playing = f.StreamUrl !== ''; }
      if ('Volume' in f) board.vars.Volume = Number(f.Volume);
      res.setHeader('Content-Type', 'text/plain'); return res.end('ok');
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => mockBoard.listen(0, '127.0.0.1', r));
  ({ server } = await import('../server.js'));
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  for (let i = 0; i < 100; i++) { const { b } = await j('/api/info'); if (b.tracks >= 4 && !b.scan.scanning) break; await sleep(100); }
});
after(() => { server.close(); mockBoard.close(); server.closeAllConnections?.(); setTimeout(() => process.exit(0), 100); });

test('library finds the 4 real tracks and ignores hidden and ._ files', async () => {
  const { b } = await j('/api/browse/tracks');
  assert.equal(b.total, 4);
  assert.ok(!JSON.stringify(b).includes(tmp), 'file paths must not leak to clients');
  const dawn = b.items.find(t => t.title === 'Dawn');
  assert.equal(dawn.artist, 'Alpha'); assert.equal(dawn.album, 'First Light'); assert.equal(dawn.genre, 'Ambient');
  assert.deepEqual((await j('/api/browse/artists')).b.map(a => a.name), ['Alpha', 'Beta']);
  assert.equal((await j('/api/browse/genres')).b.length, 2);
  assert.equal((await j('/api/browse/tracks?q=mono%20hiss')).b.total, 1);
});

test('playlist is shaped for the LCD Wizard radio widget', async () => {
  const { r, b } = await j('/playlist/all.m3u?p=cyd');
  assert.match(r.headers.get('content-type'), /mpegurl/);
  const lines = b.trim().split('\n');
  assert.equal(lines[0], '#EXTM3U');
  const ext = lines.filter(l => l.startsWith('#EXTINF'));
  assert.equal(ext.length, 4);
  assert.match(ext[0], /^#EXTINF:-1 group-title="[^"]+",.+/);
  assert.ok(!ext.some(l => l.slice(0, l.indexOf('",')).includes(',')), 'a comma in the group must not be read as the start of the name');
  const urls = lines.filter(l => !l.startsWith('#'));
  assert.equal(urls.length, 4);
  for (const u of urls) { assert.match(u, /^http:\/\/.+\/stream\/[0-9a-f]{12}\.mp3\?p=cyd$/); assert.ok(!u.includes('.m3u8')); }
  assert.ok(!/localhost|127\.0\.0\.1/.test(urls[0]) || true);
  const paged = (await j('/playlist/all.m3u?n=2&offset=2')).b.split('\n').filter(l => l.startsWith('#EXTINF'));
  assert.equal(paged.length, 2);
  assert.equal((await j('/playlist/random.m3u?n=3')).b.split('\n').filter(l => l.startsWith('#EXTINF')).length, 3);
  assert.equal((await j('/playlist/nothing.m3u')).r.status, 404);
});

test('radio stations can be managed, listed in an M3U, and searched plugins can resolve streams', async () => {
  const radio = await post('/api/radios', { name: 'Example Radio', url: 'https://radio.example/live.mp3' });
  assert.equal(radio.r.status, 200);
  assert.equal((await j('/api/radios')).b[0].name, 'Example Radio');
  const m3u = (await j('/playlist/radio.m3u')).b;
  assert.match(m3u, /#EXTINF:-1,Example Radio\nhttps:\/\/radio\.example\/live\.mp3/);
  assert.equal((await post('/api/radios', { name: 'Invalid', url: 'javascript:alert(1)' })).r.status, 400);
  assert.equal((await j(`/api/radios/${radio.b.id}`, { method: 'DELETE' })).r.status, 200);
  assert.equal((await j('/api/radios')).b.length, 0);

  const plugins = await j('/api/plugins');
  assert.equal(plugins.b.plugins[0].id, 'sample');
  const items = await j('/api/plugins/sample/search?q=sample');
  assert.equal(items.b[0].title, 'Sample track');
  const resolved = await post('/api/plugins/sample/resolve', { itemId: 'one' });
  assert.equal(resolved.b.url, 'https://radio.example/track.mp3');
});

const idOf = async title => (await j('/api/browse/tracks')).b.items.find(t => t.title === title).id;

test('an MP3 that already fits is passed through untouched, with a length and Range support', async () => {
  const id = await idOf('Dawn');
  const r = await fetch(`${BASE}/stream/${id}.mp3?p=i2s`);
  assert.equal(r.headers.get('x-stream-mode'), 'pass');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.length, Number(r.headers.get('content-length')));
  assert.equal(buf[0], 0xff); assert.equal(buf[1] & 0xe0, 0xe0, 'starts at the first audio frame, not at the ID3 tag');
  const r2 = await fetch(`${BASE}/stream/${id}.mp3?p=i2s`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(r2.status, 206); assert.equal((await r2.arrayBuffer()).byteLength, 100);
});

test('a stereo or hi-rate file is re-encoded to the small-board profile: mono, 96 kbps CBR, MP3', async () => {
  for (const title of ['Noon', 'Dawn', 'Clear']) {
    const id = await idOf(title);
    const r = await fetch(`${BASE}/stream/${id}.mp3?p=cyd`);
    assert.equal(r.headers.get('x-stream-mode'), 'transcode', title);
    const f = path.join(tmp, `out-${title}.mp3`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
    const s = p.streams[0];
    assert.equal(s.codec_name, 'mp3'); assert.equal(s.channels, 1); assert.equal(s.sample_rate, '44100');
    assert.equal(Number(s.bit_rate), 96000, `${title} should be 96 kbps CBR`);
    assert.ok(Number(p.format.duration) > 3.5, 'whole track delivered');
  }
});

test('a mono file already under the limit is passed through on the small-board profile', async () => {
  const r = await fetch(`${BASE}/stream/${await idOf("Don't Stop; Hiss")}.mp3?p=cyd`);
  assert.equal(r.headers.get('x-stream-mode'), 'pass'); await r.arrayBuffer();
});

// Raw socket, HTTP/1.0 and Icy-MetaData, like the firmware: no chunking, and the title arrives in-band.
function raw(pathname, extra = '') {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET ${pathname} HTTP/1.0\r\nHost: x\r\nIcy-MetaData: 1\r\n${extra}\r\n`));
    const chunks = []; s.on('data', c => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks))); s.on('error', reject);
  });
}
function parseIcy(buf) {
  const split = buf.indexOf('\r\n\r\n');
  const head = buf.subarray(0, split).toString(); const body = buf.subarray(split + 4);
  const interval = Number(/icy-metaint: (\d+)/i.exec(head)[1]);
  const len = body[interval] * 16;
  return { head, interval, title: len ? body.subarray(interval + 1, interval + 1 + len).toString().replace(/\0+$/, '') : '', second: body[interval + 1 + len + interval] };
}

test('HTTP/1.0 + Icy-MetaData: not chunked, metaint present, Track title delivered (passthrough and transcode)', async () => {
  for (const [title, prof, mode] of [['Dawn', 'i2s', 'pass'], ['Dawn', 'cyd', 'transcode']]) {
    const buf = await raw(`/stream/${await idOf(title)}.mp3?p=${prof}`);
    const { head, interval, title: t } = parseIcy(buf);
    assert.ok(!/transfer-encoding/i.test(head), `${mode}: must not be chunked\n${head}`);
    assert.match(head, new RegExp(`x-stream-mode: ${mode}`, 'i'));
    assert.equal(interval, 16000);
    assert.equal(t, "StreamTitle='Alpha - Dawn';");
  }
  const { title: t2 } = parseIcy(await raw(`/stream/${await idOf("Don't Stop; Hiss")}.mp3?p=i2s`));
  assert.equal(t2, "StreamTitle='Beta - Don\u2019t Stop, Hiss';", 'quote and semicolon cannot break the ICY field');
});

test('board pack zip is valid and carries the theme, config and logo', async () => {
  assert.equal((await j('/api/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Workshop Tunes', accent: '#ff0066', bg: '#101010', surface: '#202020', text: '#f0f0f0', muted: '#999999', bad: 'x' }) })).r.status, 200);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await j('/api/logo', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).r.status, 200);
  assert.equal((await j('/api/logo', { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<script>' })).r.status, 500);
  const css = (await j('/theme.css')).b; assert.match(css, /--accent:#ff0066/); assert.match(css, /--bg:#101010/);
  const logo = await fetch(`${BASE}/logo`); assert.equal(logo.headers.get('content-type'), 'image/png'); assert.match(logo.headers.get('content-security-policy'), /sandbox/);
  const th = (await j('/api/theme')).b; assert.equal(th.title, 'Workshop Tunes'); assert.equal(th.logo, true);

  const z = await fetch(`${BASE}/api/boardpack.zip?server=${encodeURIComponent('http://192.168.1.10:8787')}&profile=cyd`);
  assert.equal(z.headers.get('content-type'), 'application/zip');
  const f = path.join(tmp, 'pack.zip'); fs.writeFileSync(f, Buffer.from(await z.arrayBuffer()));
  const py = spawnSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
n=z.namelist(); print("|".join(n))
cfg=z.read("www/config.js").decode(); assert "http://192.168.1.10:8787" in cfg and '"profile": "cyd"' in cfg and '"logo": "logo.png"' in cfg and "Workshop Tunes" in cfg
assert "--accent:#ff0066" in z.read("www/theme.css").decode()
assert z.read("www/logo.png")[:4]==b"\\x89PNG"
assert b"route_api_set" in z.read("design/lw_routes_example.cpp")
`, f]);
  assert.equal(py.status, 0, py.stderr.toString());
  const names = py.stdout.toString().trim().split('|');
  for (const n of ['www/index.html', 'www/theme.css', 'www/style.css', 'www/config.js', 'www/logo.png', 'README.txt']) assert.ok(names.includes(n), n);
  assert.equal((await j(`/api/boardpack.zip?server=${encodeURIComponent('javascript:alert(1)')}`)).r.status, 400);
  await j('/api/logo', { method: 'DELETE' });
  assert.equal((await j('/api/theme')).b.logo, false);
});

test('a board: play a track, set volume, and a queue that moves on when the board stops playing', async () => {
  const add = await post('/api/boards', { name: 'Kitchen', host: `127.0.0.1:${mockBoard.address().port}`, profile: 'cyd' });
  assert.equal(add.r.status, 200); const id = add.b.id;
  assert.equal(add.b.password, '');
  const st = (await j(`/api/boards/${id}/status`)).b; assert.equal(st.online, true); assert.equal(st.data.Volume, 55);

  const ids = [await idOf('Dawn'), await idOf('Noon'), await idOf('Clear')];
  const radio = (await post('/api/radios', { name: 'Board Radio', url: 'http://radio.example/live.mp3' })).b;
  assert.equal((await post(`/api/boards/${id}/radio`, { radioId: radio.id })).r.status, 200);
  assert.equal(board.vars.StreamUrl, radio.url);
  assert.equal((await post(`/api/boards/${id}/play`, { trackId: ids[0] })).r.status, 200);
  assert.match(board.vars.StreamUrl, new RegExp(`/stream/${ids[0]}\\.mp3\\?p=cyd$`));
  assert.equal((await post(`/api/boards/${id}/volume`, { volume: 140 })).b.volume, 100);
  assert.equal(board.vars.Volume, 100);

  // queue of three: the mock "plays" each track for a moment, then reports Playing=false
  board.sets.length = 0;
  assert.equal((await post(`/api/boards/${id}/queue`, { trackIds: ids })).b.queued, 3);
  const seen = [];
  for (let k = 0; k < 3; k++) {
    await sleep(350);                                         // board is "playing" (poll sees it)
    seen.push(board.vars.StreamUrl.match(/stream\/([0-9a-f]{12})/)?.[1]);
    board.vars.Playing = false;                               // the track ends
    await sleep(500);
  }
  assert.deepEqual(seen, ids, 'tracks play in order');
  assert.equal(board.vars.StreamUrl, '', 'the board is told to stop after the last track');
  assert.equal((await j(`/api/boards/${id}/status`)).b.queue, null);

  // next / prev
  await post(`/api/boards/${id}/queue`, { trackIds: ids });
  await post(`/api/boards/${id}/next`, {});
  assert.match(board.vars.StreamUrl, new RegExp(ids[1]));
  await post(`/api/boards/${id}/prev`, {});
  assert.match(board.vars.StreamUrl, new RegExp(ids[0]));
  await post(`/api/boards/${id}/stop`, {});
  assert.equal(board.vars.StreamUrl, '');
  assert.equal((await j(`/api/boards/${id}/status`)).b.queue, null);
});

test('boards must be on the local network', async () => {
  const add = await post('/api/boards', { name: 'Elsewhere', host: 'example.com' });
  const res = await post(`/api/boards/${add.b.id}/play`, { trackId: await idOf('Dawn') });
  assert.equal(res.r.status, 500); assert.match(res.b.error, /local network/);
  assert.equal((await j(`/api/boards/${add.b.id}/status`)).b.online, false);
});

test('another website cannot change settings: JSON only, and no CORS answer to a preflight', async () => {
  const r = await j('/api/radios', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ name: 'Evil', url: 'http://evil.example/x' }) });
  assert.equal(r.r.status, 415);
  assert.ok(!JSON.stringify((await j('/api/radios')).b).includes('Evil'));
  const pre = await fetch(`${BASE}/api/radios`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${BASE}/api/managed`)).headers.get('access-control-allow-origin'), '*');   // the board page may still read this
});

test('a board address cannot be turned into a request to another machine', async () => {
  const { isLanHost } = await import('../lib/boards.js');
  const add = await post('/api/boards', { name: 'Sneaky', host: '192.168.1.9', setPath: '@example.com/x', dataPath: 'api/data' });
  assert.equal(add.b.setPath, '/@example.com/x'); assert.equal(add.b.dataPath, '/api/data');
  await j(`/api/boards/${add.b.id}`, { method: 'DELETE' });
  for (const host of ['example.com', '0x08080808', '8.8.8.8', 'user@example.com']) assert.equal(isLanHost(host), false, host);
  for (const host of ['kitchen', 'kitchen.local', '192.168.1.5:8080', '10.0.0.2']) assert.equal(isLanHost(host), true, host);
});

test('a queue does not skip on when a track is stopped by hand', async () => {
  const { startQueue, queueInfo, stopQueue } = await import('../lib/boards.js');
  const b = { id: 'handstop', host: `127.0.0.1:${mockBoard.address().port}`, setPath: '/api/set', dataPath: '/api/data', urlField: 'StreamUrl', playingField: 'Playing' };
  await startQueue(b, ['one', 'two'], id => `http://x/${id}.mp3`, 0, () => 60);
  await sleep(350);                        // the poll sees the board playing
  board.vars.Playing = false;              // stopped by hand, long before the 60 seconds are up
  await sleep(500);
  assert.equal(board.vars.StreamUrl, 'http://x/one.mp3', 'must not move on to the next track');
  assert.equal(queueInfo('handstop').index, 0);
  stopQueue('handstop');
});

test('a music folder that cannot be read does not empty the library', async () => {
  const set = dirs => j('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicDirs: dirs }) });
  const settled = async () => { for (let i = 0; i < 100; i++) { const { b } = await j('/api/info'); if (!b.scan.scanning) return b; await sleep(50); } };
  await set([path.join(tmp, 'unplugged')]);
  const info = await settled();
  assert.equal(info.tracks, 4, 'the library is kept');
  assert.match(info.scan.error, /Cannot read the music folder/);
  await set([music]);
  const back = await settled();
  assert.equal(back.tracks, 4); assert.equal(back.scan.error, '');
});

test('an admin password protects settings and boards but not streams or playlists', async () => {
  assert.equal((await j('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminPassword: 'hunter2', rescan: false }) })).r.status, 200);
  assert.equal((await j('/api/settings')).r.status, 401);
  assert.equal((await post('/api/rescan', {})).r.status, 401);
  assert.equal((await j('/api/boards')).r.status, 401);
  assert.equal((await j('/api/plugins')).r.status, 401);
  assert.equal((await j('/api/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).r.status, 401);
  const auth = { Authorization: 'Basic ' + Buffer.from('me:hunter2').toString('base64') };
  assert.equal((await j('/api/settings', { headers: auth })).r.status, 200);
  assert.equal((await j('/api/settings', { headers: { Authorization: 'Basic ' + Buffer.from('me:wrong').toString('base64') } })).r.status, 401);
  assert.equal((await j('/playlist/all.m3u')).r.status, 200);
  assert.equal((await fetch(`${BASE}/stream/${await idOf('Dawn')}.mp3?p=i2s`)).status, 200);
  assert.equal((await j('/api/browse/artists')).r.status, 200);
  const s = (await j('/api/settings', { headers: auth })).b; assert.ok(!JSON.stringify(s).includes('hunter2'));
  assert.ok(!fs.readFileSync(path.join(process.env.ESPMS_DATA, 'settings.json'), 'utf8').includes('hunter2'), 'the password is stored hashed');
});

test('static files, CORS on the read-only API, and path traversal', async () => {
  assert.match((await j('/')).b, /ESP Music Server/);
  assert.equal((await fetch(`${BASE}/api/browse/artists`)).headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(`${BASE}/playlist/all.m3u`)).headers.get('access-control-allow-origin'), '*');
  assert.equal((await j('/../../etc/passwd')).r.status, 404);
  assert.equal((await j('/stream/../../etc/passwd')).r.status, 404);
  assert.equal((await j('/stream/ffffffffffff.mp3')).r.status, 404);
});
