// Scans the music folders, reads tags, keeps an index in memory and in data/library.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFile } from 'music-metadata';
import { DATA_DIR, get as settings } from './settings.js';

const EXTS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma']);
const CACHE = path.join(DATA_DIR, 'library.json');
const sha = (s, n) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);

let tracks = new Map();           // id -> track
export const status = { scanning: false, scanned: 0, total: 0, finishedAt: null, errors: 0, error: '' };
let rescan = false;               // a scan was asked for while one was running

try {
  for (const t of JSON.parse(fs.readFileSync(CACHE, 'utf8'))) tracks.set(t.id, t);
  status.finishedAt = fs.statSync(CACHE).mtimeMs;
} catch { /* no cache yet */ }

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;                    // hidden files, and the ._ twins a Mac leaves
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) yield p;
  }
}

async function readTrack(file, st, old) {
  if (old && old.mtime === st.mtimeMs && old.size === st.size) return old;
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, ext);
  let m = null;
  try { m = await parseFile(file, { skipCovers: true }); } catch { status.errors++; }
  const c = m?.common || {}, f = m?.format || {};
  return {
    id: sha(file, 12),
    file,
    ext,
    title: c.title || base.replace(/_/g, ' '),
    artist: c.artist || c.albumartist || 'Unknown Artist',
    albumArtist: c.albumartist || c.artist || 'Unknown Artist',
    album: c.album || 'Unknown Album',
    genre: (c.genre && c.genre[0]) || 'Unknown Genre',
    year: c.year || 0,
    no: c.track?.no || 0,
    disc: c.disk?.no || 1,
    duration: Math.round(f.duration || 0),
    bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : 0,
    rate: f.sampleRate || 0,
    channels: f.numberOfChannels || 2,
    codec: (f.codec || '').toLowerCase(),
    // True MP3 only (an .mp3 name with something else inside is transcoded rather than trusted).
    isMp3: ext === '.mp3' && /^mpeg/i.test(f.container || '') && /layer 3/i.test(f.codec || ''),
    size: st.size,
    mtime: st.mtimeMs,
    added: old?.added || Date.now(),
  };
}

export async function scan() {
  if (status.scanning) { rescan = true; return; }
  Object.assign(status, { scanning: true, scanned: 0, total: 0, errors: 0, error: '' });
  try {
    const files = [];
    for (const dir of settings().musicDirs) {
      // An unplugged drive or sleeping NAS must not look like an empty library: keep what we have.
      try { fs.readdirSync(dir); } catch { throw new Error(`Cannot read the music folder ${dir}. The library was left as it was.`); }
      for (const f of walk(dir)) files.push(f);
    }
    status.total = files.length;
    const next = new Map();
    let i = 0;
    const worker = async () => {
      while (i < files.length) {
        const file = files[i++];
        try {
          const st = fs.statSync(file);
          const t = await readTrack(file, st, tracks.get(sha(file, 12)));
          next.set(t.id, t);
        } catch { status.errors++; }
        status.scanned++;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    tracks = next; ordered = null;
    fs.writeFileSync(CACHE + '.tmp', JSON.stringify([...tracks.values()]));
    fs.renameSync(CACHE + '.tmp', CACHE);
    status.finishedAt = Date.now();
  } catch (e) {
    status.error = e.message;
    throw e;
  } finally {
    status.scanning = false;
  }
  if (rescan) { rescan = false; return scan(); }
}

// ---- queries ----
const lc = s => String(s || '').toLowerCase();
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });   // built once: localeCompare with options rebuilds one per call
const cmp = (a, b) => collator.compare(a, b);
export const trackOrder = (a, b) =>
  cmp(a.albumArtist, b.albumArtist) || cmp(a.album, b.album) || a.disc - b.disc || a.no - b.no || cmp(a.title, b.title);

export const getTrack = id => tracks.get(id);
export const all = () => [...tracks.values()];
let ordered = null;               // all tracks in album order; dropped when a scan replaces them
const inOrder = () => ordered ||= all().sort(trackOrder);
export const albumKey = t => `${t.albumArtist}\u0000${t.album}`;
export const albumId = t => sha(albumKey(t), 10);

export function find({ q, artist, album, genre, sort = 'order' } = {}) {
  let list = inOrder();
  if (artist) list = list.filter(t => t.albumArtist === artist || t.artist === artist);
  if (album) list = list.filter(t => albumId(t) === album);
  if (genre) list = list.filter(t => t.genre === genre);
  if (q) {
    const words = lc(q).split(/\s+/).filter(Boolean);
    list = list.filter(t => {
      const hay = lc(`${t.title} ${t.artist} ${t.album} ${t.genre}`);
      return words.every(w => hay.includes(w));
    });
  }
  return sort === 'recent' ? [...list].sort((a, b) => b.added - a.added || trackOrder(a, b)) : list;
}

export function artists() {
  const m = new Map();
  for (const t of tracks.values()) {
    const e = m.get(t.albumArtist) || { name: t.albumArtist, tracks: 0, albums: new Set() };
    e.tracks++; e.albums.add(t.album); m.set(t.albumArtist, e);
  }
  return [...m.values()].map(e => ({ name: e.name, tracks: e.tracks, albums: e.albums.size }))
    .sort((a, b) => cmp(a.name, b.name));
}

export function albums({ artist } = {}) {
  const m = new Map();
  for (const t of tracks.values()) {
    if (artist && t.albumArtist !== artist) continue;
    const id = albumId(t);
    const e = m.get(id) || { id, album: t.album, artist: t.albumArtist, year: t.year, tracks: 0, firstTrack: t.id };
    e.tracks++; if (!e.year) e.year = t.year; m.set(id, e);
  }
  return [...m.values()].sort((a, b) => cmp(a.artist, b.artist) || (a.year - b.year) || cmp(a.album, b.album));
}

export function genres() {
  const m = new Map();
  for (const t of tracks.values()) m.set(t.genre, (m.get(t.genre) || 0) + 1);
  return [...m].map(([name, tracks]) => ({ name, tracks })).sort((a, b) => cmp(a.name, b.name));
}

// ---- cover art: embedded picture first, then folder.jpg / cover.jpg ----
const artCache = new Map();
export async function art(t) {
  const key = albumId(t);
  if (artCache.has(key)) return artCache.get(key);
  let out = null;
  try {
    const m = await parseFile(t.file, { skipCovers: false });
    const p = m.common.picture?.[0];
    if (p) out = { data: Buffer.from(p.data), mime: p.format || 'image/jpeg' };
  } catch { /* fall through to folder art */ }
  if (!out) {
    for (const n of ['cover.jpg', 'folder.jpg', 'cover.png', 'folder.png', 'front.jpg']) {
      const p = path.join(path.dirname(t.file), n);
      if (fs.existsSync(p)) { out = { data: fs.readFileSync(p), mime: n.endsWith('png') ? 'image/png' : 'image/jpeg' }; break; }
    }
  }
  if (artCache.size > 300) artCache.delete(artCache.keys().next().value);
  artCache.set(key, out);
  return out;
}
