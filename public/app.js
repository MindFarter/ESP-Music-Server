'use strict';
// ---------- small helpers ----------
const $ = s => document.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) { init.method = init.method || 'POST'; init.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }; init.body = JSON.stringify(opts.json); delete init.json; }
  const r = await fetch(path, init);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((body && body.error) || `Request failed (${r.status})`);
  return body;
}
let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 5000 : 2200);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const mmss = s => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {                                         // plain http on a LAN is not a "secure context", so fall back
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    if (!ok) throw new Error('Could not copy: select the address and copy it by hand');
  }
}

// ---------- theme ----------
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
function applyTheme(t) {
  const r = document.documentElement.style;
  for (const k of ['accent', 'bg', 'surface', 'text', 'muted']) r.setProperty('--' + k, t[k]);
  r.setProperty('--accent-ink', contrast(t.accent, '#000000') > contrast(t.accent, '#ffffff') ? '#000000' : '#ffffff');
  $('#brandTitle').textContent = t.title;
  document.title = t.title;
}
function applyLogo(has) {
  const img = $('#logo');
  img.hidden = !has;
  if (has) img.src = '/logo?v=' + Date.now();
  $('#brand').classList.toggle('hasLogo', has);
  if (has) img.alt = '';
}

// ---------- state ----------
const S = {
  info: null, boards: [], boardId: localStorage.getItem('lwms.board') || '',
  output: localStorage.getItem('lwms.output') || 'board', last: null,
  current: { title: '', sub: '', trackId: '', kind: '' }, browserQueue: [], bq: 0,
};
const board = () => S.boards.find(b => b.id === S.boardId);

// ---------- player bar ----------
function renderBoardSelect() {
  const sel = $('#boardSel');
  sel.replaceChildren(h('option', { value: 'browser' }, 'This browser'),
    ...S.boards.map(b => h('option', { value: `board:${b.id}` }, b.name)));
  if (!S.boards.find(b => b.id === S.boardId)) S.boardId = S.boards[0]?.id || '';
  if (S.output !== 'browser' && !S.boardId) S.output = 'browser';
  sel.value = S.output === 'browser' ? 'browser' : `board:${S.boardId}`;
  updatePlayerControls();
}
function setNow(title, sub) {
  S.current.title = title; S.current.sub = sub;
  $('#nowTitle').textContent = title; $('#nowSub').textContent = sub;
  updateBigPlayer();
}
let polling = false;
async function pollBoard() {
  if (polling || S.output !== 'board' || !S.boardId || document.hidden) return;
  const requestedBoard = S.boardId;
  polling = true;
  try {
    const s = await api(`/api/boards/${requestedBoard}/status`);
    if (S.output !== 'board' || requestedBoard !== S.boardId) return;
    const b = board(); if (!b) return;
    if (!s.online) { S.current.kind = 'board'; S.current.trackId = ''; setNow(S.last ? S.last.title : 'Nothing playing', `${b.name} is not answering`); return; }
    const d = s.data || {};
    const now = d.NowPlaying || (S.last && S.last.title) || 'Connected';
    const q = s.queue ? ` \u00b7 track ${s.queue.index + 1} of ${s.queue.length}` : '';
    S.current.kind = 'board'; S.current.trackId = '';
    setNow(now, b.name + q + (s.queue?.warning ? ' \u00b7 ' + s.queue.warning : ''));
    const v = Number(d[b.volumeField]);
    if (Number.isFinite(v) && document.activeElement !== $('#vol')) $('#vol').value = v;
  } catch { /* the next tick will try again */ } finally { polling = false; }
}
function setOutput(output, boardId = S.boardId) {
  S.output = output;
  if (boardId) S.boardId = boardId;
  if (output === 'board') $('#audio').pause();
  localStorage.setItem('lwms.output', S.output);
  localStorage.setItem('lwms.board', S.boardId);
  renderBoardSelect();
  if (S.output === 'board') pollBoard();
  else setNow($('#audio').src ? S.current.title : 'Nothing playing', $('#audio').src ? S.current.sub : 'Ready in this browser');
}
async function stopPlayback() {
  if (S.output === 'browser') {
    const audio = $('#audio');
    audio.pause(); audio.removeAttribute('src'); audio.load();
    S.browserQueue = []; S.bq = 0; S.current.kind = ''; S.current.trackId = '';
    setNow('Stopped', 'This browser'); updatePlaybackPosition();
  } else if (board()) {
    await api(`/api/boards/${S.boardId}/stop`, { json: {} });
    S.browserQueue = []; S.current.kind = ''; S.current.trackId = '';
    setNow('Stopped', board().name);
  }
}
async function stepPlayback(by) {
  if (S.output === 'browser') {
    const next = S.bq + by;
    if (S.browserQueue[next]) playHere(S.browserQueue, next);
  } else if (board()) {
    await api(`/api/boards/${S.boardId}/${by > 0 ? 'next' : 'prev'}`, { json: {} });
  }
}
async function togglePlayback() {
  if (S.output !== 'browser') return;
  const audio = $('#audio');
  if (audio.paused && audio.src) { if (audio.ended) audio.currentTime = 0; await audio.play(); }
  else if (!audio.src && S.browserQueue[S.bq]) playHere(S.browserQueue, S.bq);
  else audio.pause();
}
function updatePlayerControls() {
  const browser = S.output === 'browser';
  const hasTarget = browser || !!board();
  const audio = $('#audio');
  for (const el of document.querySelectorAll('[data-player-action="prev"],[data-player-action="next"]'))
    el.disabled = !hasTarget || (browser && !S.browserQueue.length);
  for (const el of document.querySelectorAll('[data-player-action="stop"]'))
    el.disabled = !hasTarget || (browser && !audio.src);
  for (const el of document.querySelectorAll('[data-player-action="toggle"]'))
    el.disabled = !browser || (!audio.src && !S.browserQueue.length);
  $('#vol').disabled = !hasTarget;
  $('#playPause').textContent = audio.paused ? '\u25b6' : '\u23f8';
  $('#playPause').title = audio.paused ? 'Play' : 'Pause';
  $('#playPause').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
}
function updatePlaybackPosition() {
  const audio = $('#audio');
  const duration = S.output === 'browser' && Number.isFinite(audio.duration) ? audio.duration : 0;
  const current = S.output === 'browser' && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  for (const el of document.querySelectorAll('[data-seek]')) {
    el.max = String(Math.max(1, Math.round(duration * 10)));
    el.value = String(Math.round(current * 10));
    el.disabled = S.output !== 'browser' || !duration;
  }
  for (const el of document.querySelectorAll('[data-current-time]')) el.textContent = mmss(Math.floor(current)) || '0:00';
  for (const el of document.querySelectorAll('[data-duration]')) el.textContent = mmss(Math.floor(duration)) || '0:00';
  updatePlayerControls();
}
function listenButtons() {
  for (const button of document.querySelectorAll('[data-listen-track]')) {
    const active = S.output === 'browser' && S.current.trackId === button.dataset.listenTrack;
    button.classList.toggle('is-active', active);
    button.textContent = active ? 'Listening here' : 'Listen here';
  }
  for (const button of document.querySelectorAll('[data-listen-group]')) {
    const active = S.output === 'browser' && JSON.parse(button.dataset.listenGroup).includes(S.current.trackId);
    button.classList.toggle('is-active', active);
    button.textContent = active ? 'Listening here' : 'Listen here';
  }
}
document.addEventListener('click', guard(async e => {
  const action = e.target.closest('[data-player-action]')?.dataset.playerAction;
  if (action === 'toggle') await togglePlayback();
  else if (action === 'stop') await stopPlayback();
  else if (action === 'next') await stepPlayback(1);
  else if (action === 'prev') await stepPlayback(-1);
}));
$('#boardSel').addEventListener('change', e => {
  if (e.target.value === 'browser') setOutput('browser');
  else setOutput('board', e.target.value.slice(6));
});
$('#audio').volume = Number($('#vol').value) / 100;
let volTimer;
$('#vol').addEventListener('input', e => {
  if (S.output === 'browser') { $('#audio').volume = Number(e.target.value) / 100; return; }
  clearTimeout(volTimer);
  volTimer = setTimeout(guard(() => api(`/api/boards/${S.boardId}/volume`, { json: { volume: Number(e.target.value) } })), 250);
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-seek]') && S.output === 'browser' && Number.isFinite($('#audio').duration))
    $('#audio').currentTime = Number(e.target.value) / 10;
});
$('#audio').addEventListener('timeupdate', updatePlaybackPosition);
$('#audio').addEventListener('durationchange', updatePlaybackPosition);
$('#audio').addEventListener('play', () => { updatePlayerControls(); listenButtons(); updateBigPlayer(); });
$('#audio').addEventListener('pause', () => { updatePlayerControls(); listenButtons(); updateBigPlayer(); });
$('#audio').addEventListener('ended', () => { if (S.bq + 1 < S.browserQueue.length) playHere(S.browserQueue, S.bq + 1); });
setInterval(pollBoard, 4000);

async function playOnBoard(tracks, { shuffle = false, start = 0 } = {}) {
  if (!board()) { toast('Add a board first, under Boards', true); location.hash = '#boards'; return; }
  const ids = tracks.map(t => t.id);
  if (ids.length === 1) await api(`/api/boards/${S.boardId}/play`, { json: { trackId: ids[0] } });
  else await api(`/api/boards/${S.boardId}/queue`, { json: { trackIds: ids, shuffle, start } });
  const t = tracks[start] || tracks[0];
  S.last = { title: `${t.artist} - ${t.title}` };
  S.browserQueue = []; S.current.kind = 'board'; S.current.trackId = t.id;
  setOutput('board');
  setNow(S.last.title, board().name + (ids.length > 1 ? ` \u00b7 queue of ${ids.length}` : ''));
}
function playHere(tracks, i = 0) {
  S.browserQueue = tracks; S.bq = i;
  const a = $('#audio'), t = tracks[i];
  setOutput('browser');
  S.current = { title: `${t.artist} - ${t.title}`, sub: 'Playing in this browser', trackId: t.id, kind: 'track' };
  a.src = `/stream/${t.id}.mp3?p=hifi`; a.play().catch(e => toast('Your browser blocked playback: ' + e.message, true));
  setNow(`${t.artist} - ${t.title}`, 'Playing in this browser');
  listenButtons(); updatePlaybackPosition();
}
function playUrlHere(url, title, sub, kind = 'radio') {
  const audio = $('#audio');
  S.browserQueue = []; S.bq = 0;
  setOutput('browser');
  S.current = { title, sub, trackId: '', kind };
  audio.src = url; audio.play().catch(e => toast('Your browser blocked playback: ' + e.message, true));
  setNow(title, sub); listenButtons(); updatePlaybackPosition();
}

function updateBigPlayer() {
  const title = $('#bigTitle');
  if (!title) return;
  title.textContent = S.current.title || 'Nothing playing';
  $('#bigSub').textContent = S.current.sub || 'Choose a track, radio station, or player';
  const cover = $('#bigCover'), visual = $('#bigVisual');
  if (S.current.kind === 'track' && S.current.trackId) {
    cover.src = `/art/${S.current.trackId}`;
    cover.hidden = false; visual.hidden = true;
  } else {
    cover.hidden = true; visual.hidden = false;
  }
  const toggle = document.querySelector('#view [data-player-action="toggle"]');
  if (toggle) {
    toggle.textContent = $('#audio').paused ? '\u25b6' : '\u23f8';
    toggle.title = $('#audio').paused ? 'Play' : 'Pause';
    toggle.disabled = S.output !== 'browser';
  }
  updatePlayerControls();
  updatePlaybackPosition();
}

function viewPlayer() {
  const root = view(); root.replaceChildren();
  root.append(h('div', { class: 'head' }, h('h1', {}, 'Player')));
  const cover = h('img', { id: 'bigCover', class: 'bigCover', alt: 'Album cover', hidden: true });
  cover.onerror = () => { cover.hidden = true; $('#bigVisual').hidden = false; };
  root.append(h('section', { class: 'bigPlayer panel' },
    h('div', { class: 'bigArtwork' }, cover, h('div', { id: 'bigVisual', class: 'bigVisual', 'aria-hidden': 'true' },
      ...Array.from({ length: 28 }, (_, i) => h('i', { style: `--bar:${20 + ((i * 37) % 70)}%` })))),
    h('div', { class: 'bigNow' }, h('h2', { id: 'bigTitle' }, 'Nothing playing'), h('p', { id: 'bigSub', class: 'muted' }, 'Choose a track, radio station, or player')),
    h('div', { class: 'bigTransport' },
      h('button', { class: 'btn icon bigControl', 'data-player-action': 'prev', 'aria-label': 'Previous' }, '\u23ee'),
      h('button', { class: 'btn primary bigControl', 'data-player-action': 'toggle', 'aria-label': 'Play or pause' }, '\u25b6'),
      h('button', { class: 'btn icon bigControl', 'data-player-action': 'stop', 'aria-label': 'Stop' }, '\u23f9'),
      h('button', { class: 'btn icon bigControl', 'data-player-action': 'next', 'aria-label': 'Next' }, '\u23ed')),
    h('div', { class: 'bigSeek' },
      h('span', { class: 'small muted', 'data-current-time': '' }, '0:00'),
      h('input', { type: 'range', min: 0, max: 1000, value: 0, 'data-seek': '', 'aria-label': 'Playback position' }),
      h('span', { class: 'small muted', 'data-duration': '' }, '0:00')),
    h('p', { class: 'muted small' }, 'These are the same player controls as the bottom bar. Choose the output in “Play on” below.')));
  updateBigPlayer();
}

// ---------- library ----------
const L = { mode: 'artists', artist: null, genre: null, album: null, q: '', label: '' };
const view = () => $('#view');
const tabs = (items, current, on) => h('div', { class: 'tabs', role: 'tablist' }, items.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': String(k === current), onclick: () => on(k) }, label)));

async function viewLibrary() {
  const root = view(); root.replaceChildren();
  if (!S.info.tracks && !S.info.scan.scanning) {
    root.append(h('div', { class: 'head' }, h('h1', {}, 'Library')),
      h('div', { class: 'empty' }, h('p', {}, 'No music yet. Tell the server where your music lives.'), h('a', { class: 'btn primary', href: '#settings' }, 'Choose a music folder')));
    return;
  }
  const go = (patch) => { Object.assign(L, patch); viewLibrary(); };
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search artists, albums and tracks', value: L.q, 'aria-label': 'Search',
    onkeydown: e => { if (e.key === 'Enter') go({ mode: 'tracks', q: e.target.value.trim(), artist: null, album: null, genre: null, label: e.target.value.trim() ? `Search: ${e.target.value.trim()}` : '' }); } });
  const trail = [];
  if (L.mode === 'tracks' || (L.mode === 'albums' && L.artist)) trail.push(h('a', { href: '#library', onclick: e => { e.preventDefault(); go({ mode: 'artists', artist: null, album: null, genre: null, q: '' }); } }, 'Library'), ' / ');
  const title = L.mode === 'tracks' ? (L.label || 'Tracks') : L.mode === 'albums' && L.artist ? L.artist : 'Library';
  root.append(h('div', { class: 'head' }, h('div', {}, trail.length ? h('div', { class: 'crumbs' }, trail) : null, h('h1', {}, title)), search));
  if (L.mode !== 'tracks' && !L.artist) root.append(tabs([['artists', 'Artists'], ['albums', 'Albums'], ['genres', 'Genres'], ['recent', 'Recently added']], L.mode, k => go({ mode: k, artist: null, genre: null, album: null, q: '' })));

  if (L.mode === 'artists') {
    const list = await api('/api/browse/artists');
    root.append(h('ul', { class: 'list' }, list.map(a => h('li', { class: 'nocover' },
      h('button', { class: 'go', onclick: () => go({ mode: 'albums', artist: a.name }) }, h('div', { class: 't' }, h('b', {}, a.name), h('span', {}, `${a.albums} album${a.albums === 1 ? '' : 's'}, ${a.tracks} tracks`))),
      h('button', { class: 'btn', onclick: guard(async () => { const r = await api(`/api/browse/tracks?artist=${encodeURIComponent(a.name)}&limit=500`); await playOnBoard(r.items, { shuffle: true }); }) }, 'Shuffle')))));
  } else if (L.mode === 'albums') {
    const list = await api('/api/browse/albums' + (L.artist ? `?artist=${encodeURIComponent(L.artist)}` : ''));
    root.append(h('ul', { class: 'list' }, list.map(a => h('li', {},
      h('img', { class: 'cover', src: `/art/${a.firstTrack}`, alt: '', loading: 'lazy', onerror: e => { e.target.style.visibility = 'hidden'; } }),
      h('button', { class: 'go', onclick: () => go({ mode: 'tracks', album: a.id, artist: null, genre: null, label: `${a.album}` }) }, h('div', { class: 't' }, h('b', {}, a.album), h('span', {}, `${a.artist}${a.year ? ' \u00b7 ' + a.year : ''} \u00b7 ${a.tracks} tracks`))),
      h('button', { class: 'btn', onclick: guard(async () => { const r = await api(`/api/browse/tracks?album=${a.id}&limit=500`); await playOnBoard(r.items); }) }, 'Play album')))));
  } else if (L.mode === 'genres') {
    const list = await api('/api/browse/genres');
    root.append(h('ul', { class: 'list' }, list.map(g => h('li', { class: 'nocover' },
      h('button', { class: 'go', onclick: () => go({ mode: 'tracks', genre: g.name, label: g.name, artist: null, album: null }) }, h('div', { class: 't' }, h('b', {}, g.name), h('span', {}, `${g.tracks} tracks`))),
      h('span', {})))));
  } else {
    const q = new URLSearchParams({ limit: '500' });
    if (L.mode === 'recent') { q.set('sort', 'recent'); L.label = 'Recently added'; }
    for (const k of ['artist', 'album', 'genre', 'q']) if (L[k]) q.set(k, L[k]);
    const r = await api('/api/browse/tracks?' + q);
    root.append(h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('button', { class: 'btn primary', disabled: !r.items.length, onclick: guard(() => playOnBoard(r.items)) }, 'Play on board'),
      h('button', { class: 'btn', disabled: !r.items.length, onclick: guard(() => playOnBoard(r.items, { shuffle: true })) }, 'Shuffle on board'),
      h('button', { class: 'btn', disabled: !r.items.length, 'data-listen-group': JSON.stringify(r.items.map(t => t.id)), onclick: () => playHere(r.items) }, 'Listen here'),
      h('span', { class: 'muted small' }, r.total > r.items.length ? `Showing the first ${r.items.length} of ${r.total}` : `${r.total} tracks`)));
    root.append(r.items.length ? h('ul', { class: 'list' }, r.items.map((t, i) => h('li', { class: 'nocover' },
      h('div', { class: 't' }, h('b', {}, `${t.no ? t.no + '. ' : ''}${t.title}`), h('span', {}, `${t.artist} \u00b7 ${t.album} \u00b7 ${mmss(t.duration)}`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: guard(() => playOnBoard(r.items, { start: i })) }, 'Play'),
        h('button', { class: 'btn', 'data-listen-track': t.id, onclick: () => playHere(r.items, i) }, 'Listen here'))))) : h('div', { class: 'empty' }, 'Nothing matches.'));
  }
}

// ---------- playlists ----------
const P = { base: '', profile: '', filter: '' };
async function viewPlaylists() {
  const root = view(); root.replaceChildren();
  const items = await api('/api/playlists');
  P.base = P.base || S.info.lan[0] || location.origin; P.profile = P.profile || S.info.defaultProfile;
  const bases = [...new Set([...S.info.lan, ...(/^(localhost|127\.)/.test(location.hostname) ? [] : [location.origin])])];
  const full = path => `${P.base}${path}${path.includes('?') ? '&' : '?'}p=${P.profile}`;
  const listEl = h('div', {});
  const draw = () => {
    listEl.replaceChildren();
    const f = P.filter.toLowerCase();
    for (const g of ['Everything', 'Genres', 'Artists', 'Albums', 'Radio']) {
      const rows = items.filter(i => i.group === g && (!f || i.name.toLowerCase().includes(f)));
      if (!rows.length) continue;
      listEl.append(h('h2', { style: 'margin:22px 0 8px' }, g), h('ul', { class: 'list' }, rows.slice(0, 300).map(i => h('li', { class: 'nocover' },
        h('div', { class: 't' }, h('b', {}, i.name), h('span', {}, i.tracks ? `${i.tracks} tracks` : '')),
        h('button', { class: 'btn', onclick: guard(async () => { await copyText(full(i.path)); toast('Address copied'); }) }, 'Copy address')))));
    }
    if (!listEl.children.length) listEl.append(h('div', { class: 'empty' }, 'No playlists yet: scan a music folder first.'));
  };
  root.append(h('div', { class: 'head' }, h('h1', {}, 'Playlists')),
    h('p', {}, 'Paste one of these into the Internet Radio widget in LCD Wizard, under ', h('b', {}, 'Takes more stations from'), ' \u2192 ', h('b', {}, 'A playlist at an address'), '. The board fetches it when it starts, so shuffled and recent lists are new each time.'),
    h('div', { class: 'row', style: 'margin:14px 0' },
      h('label', { class: 'field' }, 'Server address the board will use', h('select', { onchange: e => { P.base = e.target.value; } }, bases.map(b => h('option', { value: b, selected: b === P.base }, b)))),
      h('label', { class: 'field' }, 'Board type', h('select', { onchange: e => { P.profile = e.target.value; } }, Object.entries(S.info.profiles).map(([k, v]) => h('option', { value: k, selected: k === P.profile }, v.label)))),
      h('label', { class: 'field' }, 'Filter', h('input', { type: 'search', value: P.filter, oninput: e => { P.filter = e.target.value; draw(); } }))),
    h('p', { class: 'muted small' }, 'A board lists at most 256 stations, so each playlist holds up to 200 tracks. Add ', h('code', {}, '&offset=200'), ' for the next 200.'),
    listEl);
  draw();
}

async function playRadioOnBoard(radio) {
  if (!board()) { toast('Add a board first, under Boards', true); location.hash = '#boards'; return; }
  await api(`/api/boards/${S.boardId}/radio`, { json: { radioId: radio.id } });
  S.last = { title: radio.name };
  S.browserQueue = []; S.current = { title: radio.name, sub: board().name, trackId: '', kind: 'radio' };
  setOutput('board'); setNow(radio.name, board().name);
}

async function viewRadio() {
  const root = view(); root.replaceChildren();
  const radios = await api('/api/radios');
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Station name', required: true });
  const url = h('input', { type: 'url', placeholder: 'https://example.com/stream.mp3', required: true });
  const serverBase = S.info.lan[0] || location.origin;
  root.append(h('div', { class: 'head' }, h('h1', {}, 'Radio')),
    h('p', { class: 'muted' }, 'Save internet radio stream URLs here. Compatible stations can play in this browser or be sent directly to an LCD Wizard board.'),
    h('section', { class: 'panel' }, h('h2', {}, 'Add a station'),
      h('form', { class: 'grid2', onsubmit: guard(async e => {
        e.preventDefault();
        await api('/api/radios', { json: { name: name.value, url: url.value } });
        toast('Radio station added'); viewRadio();
      }) },
      h('label', { class: 'field' }, 'Station name', name),
      h('label', { class: 'field' }, 'Stream URL (HTTP or HTTPS)', url),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add radio station')))),
    h('section', { class: 'panel' }, h('div', { class: 'row', style: 'justify-content:space-between' },
      h('h2', {}, 'Saved stations'),
      h('button', { class: 'btn', onclick: guard(async () => { await copyText(`${serverBase}/playlist/radio.m3u`); toast('Radio playlist address copied'); }) }, 'Copy LCD Wizard playlist address')),
    radios.length ? h('ul', { class: 'list' }, radios.map(radio => h('li', { class: 'nocover' },
      h('div', { class: 't' }, h('b', {}, radio.name), h('span', {}, radio.url)),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => playUrlHere(radio.url, radio.name, 'Playing in this browser', 'radio') }, 'Listen here'),
        h('button', { class: 'btn', disabled: !board(), onclick: guard(() => playRadioOnBoard(radio)) }, 'Play on board'),
        h('button', { class: 'btn danger', onclick: guard(async () => {
          if (!confirm(`Delete ${radio.name}?`)) return;
          await api(`/api/radios/${radio.id}`, { method: 'DELETE' });
          toast('Radio station deleted'); viewRadio();
        }) }, 'Delete'))))) : h('div', { class: 'empty' }, 'No radio stations yet. Add a name and a direct stream URL above.')));
}

async function viewPlugins() {
  const root = view(); root.replaceChildren();
  const result = await api('/api/plugins');
  root.append(h('div', { class: 'head' }, h('h1', {}, 'Plugins')),
    h('p', { class: 'muted' }, 'Plugins extend the server with searchable music providers. They use the same shared player controls as your library and radio stations.'),
    h('section', { class: 'panel' }, h('h2', {}, 'Add a plugin'),
      h('p', {}, 'Plugins are trusted local JavaScript modules. Add a file named ', h('code', {}, 'plugins/<plugin-id>.js'), ' and restart ESP Music Server. See README.md for the adapter API. Do not install code from sources you do not trust.')));
  for (const error of result.errors) root.append(h('p', { class: 'warn' }, `Could not load ${error}`));
  if (!result.plugins.length) {
    root.append(h('div', { class: 'empty' }, 'No plugins are installed yet. The local adapter interface is ready for future providers.'));
    return;
  }
  for (const plugin of result.plugins) {
    const search = h('input', { type: 'search', placeholder: `Search ${plugin.name}`, 'aria-label': `Search ${plugin.name}` });
    const results = h('div', {});
    const searchPlugin = guard(async () => {
      const items = await api(`/api/plugins/${plugin.id}/search?q=${encodeURIComponent(search.value)}`);
      results.replaceChildren(items.length ? h('ul', { class: 'list' }, items.map(item => h('li', { class: 'nocover' },
        h('div', { class: 't' }, h('b', {}, item.title), h('span', {}, [item.artist, item.album].filter(Boolean).join(' \u00b7 '))),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: guard(async () => {
            const resolved = await api(`/api/plugins/${plugin.id}/resolve`, { method: 'POST', json: { itemId: item.id } });
            playUrlHere(resolved.url, resolved.title || item.title, resolved.artist || item.artist || plugin.name, 'plugin');
          }) }, 'Listen here'),
          h('button', { class: 'btn', disabled: !board(), onclick: guard(async () => {
            const resolved = await api(`/api/plugins/${plugin.id}/resolve`, { method: 'POST', json: { itemId: item.id } });
            await api(`/api/boards/${S.boardId}/url`, { json: { url: resolved.url } });
            S.last = { title: resolved.title || item.title };
            S.browserQueue = []; S.current = { title: S.last.title, sub: board().name, trackId: '', kind: 'plugin' };
            setOutput('board'); setNow(S.last.title, board().name);
          }) }, 'Play on board'))))) : h('div', { class: 'empty' }, 'No results.'));
    });
    const searchButton = h('button', { class: 'btn primary', type: 'button', onclick: searchPlugin }, 'Search');
    root.append(h('section', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', {}, h('h2', {}, plugin.name), h('p', { class: 'muted small' }, `${plugin.description || 'Music provider'} \u00b7 v${plugin.version}`)),
        h('span', { class: 'chip on' }, 'Installed')),
      h('form', { class: 'row', onsubmit: e => { e.preventDefault(); searchPlugin(); } }, search, searchButton),
      results));
  }
}

// ---------- boards ----------
async function viewBoards() {
  const root = view(); root.replaceChildren();
  root.append(h('div', { class: 'head' }, h('h1', {}, 'Boards')),
    h('p', {}, 'A board is an ESP32 running an LCD Wizard design with the Web server widget. Add it here to send it tracks and read its volume and what is playing. The board pack under Settings sets up the other end.'));
  for (const b of S.boards) root.append(boardForm(b));
  root.append(boardForm(null));
}
function boardForm(b) {
  const isNew = !b; b = b || { name: '', host: '', profile: S.info.defaultProfile, setPath: '/api/set', dataPath: '/api/data', urlField: 'StreamUrl', volumeField: 'Volume', playingField: 'Playing', user: '', password: '' };
  const f = {};
  const field = (k, label, type = 'text', attrs = {}) => h('label', { class: 'field' }, label, f[k] = h('input', { type, value: b[k] ?? '', autocomplete: 'off', ...attrs }));
  const status = h('span', { class: 'chip' }, isNew ? 'New' : 'Checking\u2026');
  const profile = f.profile = h('select', {}, Object.entries(S.info.profiles).map(([k, v]) => h('option', { value: k, selected: k === b.profile }, v.label)));
  const save = guard(async () => {
    const body = { id: b.id }; for (const k of Object.keys(f)) body[k] = f[k].value;
    await api('/api/boards', { json: body }); S.boards = await api('/api/boards'); renderBoardSelect(); toast('Board saved'); viewBoards();
  });
  if (!isNew) api(`/api/boards/${b.id}/status`).then(s => { status.textContent = s.online ? 'Online' : 'Not answering'; status.classList.toggle('on', !!s.online); }).catch(() => { status.textContent = 'Not answering'; });
  return h('section', { class: 'panel' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, isNew ? 'Add a board' : b.name), status),
    h('div', { class: 'grid2' }, field('name', 'Name', 'text', { placeholder: 'Kitchen' }), field('host', 'Address', 'text', { placeholder: '192.168.1.50 or kitchen.local' }),
      h('label', { class: 'field' }, 'Board type', profile)),
    h('details', {}, h('summary', {}, 'Routes and variable names'),
      h('div', { class: 'grid2', style: 'margin-top:10px' },
        field('setPath', 'Route that sets variables (POST)'), field('dataPath', 'Route that reads variables (GET)'),
        field('urlField', 'Text variable that takes the stream address'), field('volumeField', 'Variable for volume (0 to 100)'),
        field('playingField', 'Variable that says if audio is playing'), field('user', 'Web server name'), field('password', 'Web server password', 'password', { autocomplete: 'new-password' }))),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', onclick: save }, isNew ? 'Add board' : 'Save'),
      !isNew && h('button', { class: 'btn danger', onclick: guard(async () => { if (!confirm(`Remove ${b.name}?`)) return; await api(`/api/boards/${b.id}`, { method: 'DELETE' }); S.boards = await api('/api/boards'); renderBoardSelect(); viewBoards(); }) }, 'Remove')));
}

// ---------- settings ----------
const SW = [['accent', 'Accent'], ['bg', 'Background'], ['surface', 'Panels'], ['text', 'Text'], ['muted', 'Secondary text']];
async function viewSettings() {
  const root = view(); root.replaceChildren();
  const s = await api('/api/settings');
  const theme = { ...s.theme };
  root.append(h('div', { class: 'head' }, h('h1', {}, 'Settings')));

  // library
  const dirs = h('textarea', { 'aria-label': 'Music folders', placeholder: '/home/me/Music\nD:\\Music' }); dirs.value = s.musicDirs.join('\n');
  const prof = h('select', {}, Object.entries(S.info.profiles).map(([k, v]) => h('option', { value: k, selected: k === s.defaultProfile }, v.label)));
  const mins = h('input', { type: 'number', min: 0, max: 1440, value: s.rescanMinutes });
  const scanLine = h('p', { class: 'muted small' });
  const drawScan = () => { const sc = S.info.scan; scanLine.textContent = sc.scanning ? `Scanning: ${sc.scanned} of ${sc.total} files` : `${S.info.tracks} tracks${sc.errors ? `, ${sc.errors} files could not be read` : ''}${sc.error ? '. ' + sc.error : ''}`; };
  drawScan();
  const poll = async () => { S.info = await api('/api/info'); drawScan(); if (S.info.scan.scanning && location.hash === '#settings') setTimeout(poll, 1000); };
  root.append(h('section', { class: 'panel' }, h('h2', {}, 'Music library'),
    h('label', { class: 'field' }, 'Music folders, one per line', dirs),
    h('div', { class: 'grid2', style: 'margin-top:12px' }, h('label', { class: 'field' }, 'Default board type', prof), h('label', { class: 'field' }, 'Rescan every (minutes, 0 is never)', mins)),
    !S.info.ffmpeg && h('p', { class: 'warn', style: 'margin-top:10px' }, 'ffmpeg is not installed. Only MP3 files can be sent to boards, and they cannot be slimmed down for small boards.'),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: guard(async () => { await api('/api/settings', { method: 'PUT', json: { musicDirs: dirs.value.split('\n'), defaultProfile: prof.value, rescanMinutes: Number(mins.value) } }); toast('Saved. Scanning\u2026'); setTimeout(poll, 400); }) }, 'Save and scan'), scanLine)));

  // appearance
  const prevLogo = h('div', { class: 'prev' }, s.logo ? h('img', { src: '/logo?v=' + Date.now(), alt: 'Current logo' }) : h('span', { class: 'muted small' }, 'No logo'));
  const warn = h('p', { class: 'warn' });
  const inputs = {};
  const sync = () => {
    applyTheme(theme);
    for (const [k] of SW) inputs[k].value = theme[k];
    const msgs = [];
    if (contrast(theme.text, theme.bg) < 4.5) msgs.push('Text is hard to read on this background.');
    if (contrast(theme.muted, theme.bg) < 3) msgs.push('Secondary text is very faint.');
    if (contrast(theme.accent, theme.bg) < 2) msgs.push('The accent barely shows against the background.');
    warn.textContent = msgs.join(' ');
  };
  const titleIn = h('input', { type: 'text', maxlength: 40, value: theme.title, oninput: e => { theme.title = e.target.value; applyTheme(theme); } });
  const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', 'aria-label': 'Choose a logo',
    onchange: guard(async e => { const file = e.target.files[0]; if (!file) return;
      await api('/api/logo', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
      s.logo = true; applyLogo(true); prevLogo.replaceChildren(h('img', { src: '/logo?v=' + Date.now(), alt: 'Current logo' })); toast('Logo saved'); }) });
  root.append(h('section', { class: 'panel' }, h('h2', {}, 'Appearance'),
    h('p', { class: 'muted' }, 'The colours and logo are used here and in the board pack, so the page your board serves matches this one.'),
    h('label', { class: 'field', style: 'max-width:340px;margin-bottom:14px' }, 'Name shown in the corner', titleIn),
    h('div', { class: 'presets', style: 'margin-bottom:14px' }, Object.entries(s.presets).map(([name, p]) => h('button', { class: 'btn preset', onclick: () => { Object.assign(theme, p); sync(); } },
      h('span', { class: 'dots' }, [p.bg, p.surface, p.accent, p.text].map(c => h('i', { style: `background:${c}` }))), name[0].toUpperCase() + name.slice(1)))),
    h('div', { class: 'swatches' }, SW.map(([k, label]) => h('label', {}, inputs[k] = h('input', { type: 'color', value: theme[k], oninput: e => { theme[k] = e.target.value; sync(); } }), label))),
    warn,
    h('div', { class: 'logoBox', style: 'margin-top:16px' }, prevLogo, h('div', { class: 'grid2' },
      h('label', { class: 'field' }, 'Your logo (PNG, JPEG, WebP, GIF or SVG, under 1 MB)', logoIn),
      h('div', {}, h('button', { class: 'btn', onclick: guard(async () => { await api('/api/logo', { method: 'DELETE' }); s.logo = false; applyLogo(false); prevLogo.replaceChildren(h('span', { class: 'muted small' }, 'No logo')); toast('Logo removed'); }) }, 'Remove logo')))),
    h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn primary', onclick: guard(async () => { await api('/api/theme', { method: 'PUT', json: theme }); toast('Appearance saved'); }) }, 'Save appearance'),
      h('button', { class: 'btn', onclick: async () => { const t = await api('/api/theme'); Object.assign(theme, t); titleIn.value = t.title; sync(); } }, 'Undo changes'))));
  sync();

  // board pack
  const bases = [...new Set([...S.info.lan, ...(/^(localhost|127\.)/.test(location.hostname) ? [] : [location.origin])])];
  const packBase = h('select', {}, bases.map(b => h('option', { value: b }, b)));
  const packProf = h('select', {}, Object.entries(S.info.profiles).map(([k, v]) => h('option', { value: k, selected: k === s.defaultProfile }, v.label)));
  const packLink = h('a', { class: 'btn primary', download: 'esp-music-server-board-pack.zip' }, 'Download board pack');
  const setLink = () => { packLink.href = `/api/boardpack.zip?server=${encodeURIComponent(packBase.value)}&profile=${packProf.value}`; };
  packBase.onchange = packProf.onchange = setLink; setLink();
  root.append(h('section', { class: 'panel' }, h('h2', {}, 'Board pack'),
    h('p', {}, 'A small site for the board to serve: a remote control with this theme and your logo. Unzip it and upload the files inside ', h('code', {}, 'www'), ' through the board\u2019s ', h('code', {}, '/files'), ' page (Web server widget). The README in the zip lists the variables and the automation the design needs.'),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Where this server is, as the board sees it', packBase), h('label', { class: 'field' }, 'Board type', packProf)),
    h('div', { style: 'margin-top:12px' }, packLink)));

  // security
  const pw = h('input', { type: 'password', placeholder: s.hasPassword ? 'A password is set' : 'No password', autocomplete: 'new-password' });
  root.append(h('section', { class: 'panel' }, h('h2', {}, 'Password'),
    h('p', { class: 'muted' }, 'Protects settings and board control. Browsing, playlists and streams stay open because a board cannot sign in. This is plain HTTP, so it keeps out casual visitors on your network, not someone watching the wire.'),
    !s.hasPassword && h('p', { class: 'warn' }, 'No password is set: anyone on your network can change these settings and control your boards.'),
    h('div', { class: 'row' }, h('div', { style: 'min-width:240px' }, pw),
      h('button', { class: 'btn', onclick: guard(async () => { await api('/api/settings', { method: 'PUT', json: { adminPassword: pw.value, rescan: false } }); toast(pw.value ? 'Password set' : 'Password removed'); pw.value = ''; }) }, 'Save password'))));
}

// ---------- router ----------
const VIEWS = { library: viewLibrary, playlists: viewPlaylists, player: viewPlayer, radio: viewRadio, boards: viewBoards, plugins: viewPlugins, settings: viewSettings };
async function route() {
  const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'library';
  for (const a of document.querySelectorAll('nav a')) {
    if (a.dataset.v === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  try { await VIEWS[name](); listenButtons(); updatePlayerControls(); updateBigPlayer(); }
  catch (e) { view().replaceChildren(h('div', { class: 'empty' }, e.message)); }
}
window.addEventListener('hashchange', route);

(async function start() {
  try {
    const [theme, info, boards] = await Promise.all([api('/api/theme'), api('/api/info'), api('/api/boards').catch(() => [])]);
    S.info = info; S.boards = boards; applyTheme(theme); applyLogo(theme.logo);
    renderBoardSelect(); route(); pollBoard();
  } catch (e) { view().replaceChildren(h('div', { class: 'empty' }, 'Could not reach the server: ' + e.message)); }
})();
