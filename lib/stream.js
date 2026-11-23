// Streams one track as MP3 in the shape a board can decode.
//
// What the LCD Wizard firmware does, and so what this has to cope with:
//  - it decodes MP3 (AAC and WAV are options, but MP3 is the default and the only one every board has room for);
//  - it asks for streams the HTTP/1.0 way so a server must not use chunked encoding: Node already
//    answers an HTTP/1.0 request with a plain, close-delimited body, and we never force chunking;
//  - it sends "Icy-MetaData: 1" and shows the title the stream sends as the player's Track title.
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PROFILES } from './settings.js';

export const ffmpegOk = (() => {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
})();

const ICY_INTERVAL = 16000;
const SAFE_RATES = new Set([16000, 22050, 24000, 32000, 44100, 48000]);

// Decide whether the file can go out as it is, or must be re-encoded for this profile.
export function plan(t, profileKey) {
  const p = PROFILES[profileKey] || PROFILES.cyd;
  const fits = t.isMp3 && t.channels <= p.channels && (!t.bitrate || t.bitrate <= p.kbps + 2) && SAFE_RATES.has(t.rate);
  if (fits) return { mode: 'pass', profile: p };
  if (!ffmpegOk) return { mode: t.isMp3 ? 'pass' : 'none', profile: p };   // an MP3 that is too big beats no sound
  return { mode: 'transcode', profile: p };
}

class IcyInject extends Transform {
  constructor(title) { super(); this.title = title; this.count = 0; this.sent = false; }
  block() {
    if (this.sent) return Buffer.from([0]);
    this.sent = true;
    const clean = this.title.replace(/'/g, '\u2019').replace(/;/g, ',').slice(0, 200);
    const body = Buffer.from(`StreamTitle='${clean}';`, 'utf8');
    const units = Math.min(255, Math.ceil(body.length / 16));
    const out = Buffer.alloc(1 + units * 16);
    out[0] = units;
    body.copy(out, 1, 0, units * 16);
    return out;
  }
  _transform(chunk, _enc, cb) {
    let off = 0;
    while (off < chunk.length) {
      const n = Math.min(ICY_INTERVAL - this.count, chunk.length - off);
      this.push(chunk.subarray(off, off + n));
      off += n; this.count += n;
      if (this.count === ICY_INTERVAL) { this.push(this.block()); this.count = 0; }
    }
    cb();
  }
}

const label = t => `${t.artist} - ${t.title}`;

// Bytes of ID3v2 tag at the start of a file (often a large cover picture). A board with a small buffer should get audio first.
function id3Length(file, size) {
  const b = Buffer.alloc(10);
  try {
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, b, 0, 10, 0); } finally { fs.closeSync(fd); }
  } catch { return 0; }                                   // a missing file is reported when it is opened for streaming
  if (b.toString('latin1', 0, 3) !== 'ID3') return 0;
  const n = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + (b[5] & 0x10 ? 10 : 0);
  return n < size ? n : 0;
}

let converting = 0;
const MAX_CONVERSIONS = Number(process.env.ESPMS_MAX_CONVERSIONS) || 4;   // each one is an ffmpeg process

export async function streamTrack(req, res, t, profileKey) {
  const pl = plan(t, profileKey);
  if (pl.mode === 'none') {
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    return res.end('This file is not an MP3 and ffmpeg is not installed, so it cannot be sent to a board.');
  }
  const wantsIcy = req.headers['icy-metadata'] === '1';
  const base = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'Accept-Ranges': pl.mode === 'pass' && !wantsIcy ? 'bytes' : 'none',
    'icy-name': t.album,
    'icy-br': String(pl.mode === 'pass' ? (t.bitrate || pl.profile.kbps) : pl.profile.kbps),
    'X-Stream-Mode': pl.mode,
  };
  if (wantsIcy) base['icy-metaint'] = String(ICY_INTERVAL);

  if (pl.mode === 'pass') {
    const skip = id3Length(t.file, t.size), size = t.size - skip;
    let start = 0, end = size - 1, status = 200;
    const range = !wantsIcy && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      if (range[1] === '' && range[2] !== '') { start = Math.max(0, size - Number(range[2])); }
      else { start = Number(range[1] || 0); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      status = 206;
      base['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    // Without ICY the length is known, which lets a board show progress and lets a browser seek.
    if (!wantsIcy) base['Content-Length'] = String(end - start + 1);
    res.writeHead(status, base);
    if (req.method === 'HEAD') return res.end();
    const src = fs.createReadStream(t.file, { start: start + skip, end: end + skip });
    try { await (wantsIcy ? pipeline(src, new IcyInject(label(t)), res) : pipeline(src, res)); } catch { /* client left */ }
    return;
  }

  // Transcode: constant bitrate, no Xing or ID3 header, so the first bytes are audio frames.
  if (converting >= MAX_CONVERSIONS) { res.writeHead(503, { 'Retry-After': '5', 'Content-Type': 'text/plain' }); return res.end('Too many tracks are being converted at once. Try again in a few seconds.'); }
  res.writeHead(200, base);
  if (req.method === 'HEAD') return res.end();
  converting++;
  const p = pl.profile;
  const ff = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-i', t.file, '-vn', '-map_metadata', '-1',
    '-ac', String(p.channels), '-ar', String(p.rate), '-codec:a', 'libmp3lame', '-b:a', `${p.kbps}k`,
    '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const stop = () => ff.kill('SIGKILL');
  res.on('close', stop);
  try { await (wantsIcy ? pipeline(ff.stdout, new IcyInject(label(t)), res) : pipeline(ff.stdout, res)); }
  catch { /* client left, or ffmpeg was stopped */ }
  finally { stop(); converting--; }
}
