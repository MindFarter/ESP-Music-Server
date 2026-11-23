// Settings live in data/settings.json. Everything a user can change in the web UI is here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.ESPMS_DATA || path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'settings.json');

// Stream profiles. The board decodes MP3 by default; a Cheap Yellow Display has an 8-bit mono DAC,
// so sending it more than ~128 kbps costs CPU and heap without sounding better (LCD Wizard audio docs).
export const PROFILES = {
  cyd:      { label: 'Cheap Yellow Display (internal DAC)', kbps: 96,  channels: 1, rate: 44100 },
  i2s:      { label: 'I2S DAC or ES8311 codec',             kbps: 128, channels: 2, rate: 44100 },
  hifi:     { label: 'ESP32-S3 with PSRAM, or a browser',    kbps: 192, channels: 2, rate: 44100 },
};

export const THEME_PRESETS = {
  panel:  { accent: '#2f7d5b', bg: '#e6ebe3', surface: '#f5f8f2', text: '#1b231f', muted: '#5c6b63' },
  night:  { accent: '#ffb000', bg: '#101820', surface: '#19242f', text: '#e9eef2', muted: '#8d9dab' },
  slate:  { accent: '#d9534f', bg: '#eef0f3', surface: '#ffffff', text: '#1d2127', muted: '#626b76' },
  violet: { accent: '#b79cff', bg: '#17142a', surface: '#221e3a', text: '#ece8fb', muted: '#9b94bd' },
};

const DEFAULTS = {
  port: 8787,
  musicDirs: [],
  defaultProfile: 'i2s',
  rescanMinutes: 30,
  adminPassword: '',
  theme: { title: 'ESP Music Server', ...THEME_PRESETS.panel },
  logo: null,
  boards: [],
  radios: [],
};

let settings = structuredClone(DEFAULTS);
try { settings = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }
settings.theme = { ...DEFAULTS.theme, ...(settings.theme || {}) };
settings.boards = Array.isArray(settings.boards) ? settings.boards : [];
settings.radios = Array.isArray(settings.radios) ? settings.radios : [];
if (settings.theme.title === 'LCD Wizard Music') settings.theme.title = DEFAULTS.theme.title;
if (process.env.ESPMS_MUSIC) settings.musicDirs = process.env.ESPMS_MUSIC.split(path.delimiter).filter(Boolean);
if (process.env.ESPMS_PORT) settings.port = Number(process.env.ESPMS_PORT);

export const get = () => settings;
export function save() {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(settings, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

// The admin password is kept as a salted scrypt hash, never as text. (Board passwords must stay readable: the server sends them.)
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(given) {
  const [tag, salt, hash] = String(settings.adminPassword).split('$');
  if (tag !== 'scrypt') return false;
  const a = crypto.scryptSync(given, Buffer.from(salt, 'hex'), 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
if (settings.adminPassword && !settings.adminPassword.startsWith('scrypt$')) { settings.adminPassword = hashPassword(settings.adminPassword); save(); }   // older versions stored it as text

const HEX = /^#[0-9a-fA-F]{6}$/;
export function updateTheme(t) {
  const next = { ...settings.theme };
  if (typeof t.title === 'string') next.title = t.title.trim().slice(0, 40) || DEFAULTS.theme.title;
  for (const k of ['accent', 'bg', 'surface', 'text', 'muted']) if (HEX.test(t[k] || '')) next[k] = t[k].toLowerCase();
  settings.theme = next;
  save();
}

export function updateGeneral(body) {
  if (Array.isArray(body.musicDirs)) {
    settings.musicDirs = body.musicDirs.map(String).map(s => s.trim()).filter(Boolean);
  }
  if (PROFILES[body.defaultProfile]) settings.defaultProfile = body.defaultProfile;
  const m = Number(body.rescanMinutes);
  if (Number.isFinite(m) && m >= 0 && m <= 1440) settings.rescanMinutes = Math.round(m);
  if (typeof body.adminPassword === 'string') settings.adminPassword = body.adminPassword ? hashPassword(body.adminPassword) : '';
  save();
}

// ---- boards (players) ----
const clean = (s, n = 80) => String(s ?? '').trim().slice(0, n);
// A path must start with "/": otherwise "@host/x" would turn http://board@host/x into a request to another machine.
const routePath = (s, fallback) => { const p = clean(s) || fallback; return p.startsWith('/') ? p : '/' + p; };
export function upsertBoard(b) {
  const host = clean(b.host).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) throw new Error('A board needs an address, such as 192.168.1.50 or kitchen.local');
  const board = {
    id: b.id || crypto.randomBytes(4).toString('hex'),
    name: clean(b.name, 40) || host,
    host,
    profile: PROFILES[b.profile] ? b.profile : settings.defaultProfile,
    setPath: routePath(b.setPath, '/api/set'),
    dataPath: routePath(b.dataPath, '/api/data'),
    urlField: clean(b.urlField, 40) || 'StreamUrl',
    volumeField: clean(b.volumeField, 40) || 'Volume',
    playingField: clean(b.playingField, 40) || 'Playing',
    user: clean(b.user, 40),
    password: clean(b.password, 80),
  };
  const i = settings.boards.findIndex(x => x.id === board.id);
  if (i >= 0) settings.boards[i] = board; else settings.boards.push(board);
  save();
  return board;
}
export function removeBoard(id) {
  settings.boards = settings.boards.filter(b => b.id !== id);
  save();
}
export const publicBoard = b => ({ ...b, password: b.password ? '********' : '' });

// ---- internet radio stations ----
const radioInputError = message => Object.assign(new Error(message), { statusCode: 400 });
export function validStreamUrl(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { throw radioInputError('Enter a valid radio URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw radioInputError('Radio URLs must use HTTP or HTTPS and cannot include a username or password');
  return url.href;
}
export function upsertRadio(input) {
  input = input && typeof input === 'object' ? input : {};
  const name = String(input.name ?? '').trim().replace(/[\r\n]+/g, ' ').slice(0, 80);
  if (!name) throw radioInputError('A radio station needs a name');
  const radio = { id: /^[0-9a-f]{8}$/.test(input.id || '') ? input.id : crypto.randomBytes(4).toString('hex'), name, url: validStreamUrl(input.url) };
  const index = settings.radios.findIndex(r => r.id === radio.id);
  if (index >= 0) settings.radios[index] = radio; else settings.radios.push(radio);
  save();
  return radio;
}
export function removeRadio(id) {
  settings.radios = settings.radios.filter(r => r.id !== id);
  save();
}

// ---- logo ----
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
export const LOGO_MIME = Object.fromEntries(Object.entries(LOGO_TYPES).map(([m, e]) => [e, m]));
export function setLogo(buf, mime) {
  const ext = LOGO_TYPES[(mime || '').split(';')[0].trim().toLowerCase()];
  if (!ext) throw new Error('Use a PNG, JPEG, WebP, GIF or SVG image');
  if (buf.length > 1024 * 1024) throw new Error('The logo must be under 1 MB');
  clearLogo(false);
  const name = `logo.${ext}`;
  fs.writeFileSync(path.join(DATA_DIR, name), buf);
  settings.logo = name;
  save();
}
export function clearLogo(persist = true) {
  if (settings.logo) fs.rmSync(path.join(DATA_DIR, settings.logo), { force: true });
  settings.logo = null;
  if (persist) save();
}
export const logoPath = () => (settings.logo ? path.join(DATA_DIR, settings.logo) : null);

// The same stylesheet is used by the server's own UI and by the board pack.
export function themeCss() {
  const t = settings.theme;
  return `:root{--accent:${t.accent};--bg:${t.bg};--surface:${t.surface};--text:${t.text};--muted:${t.muted};}\n`;
}
