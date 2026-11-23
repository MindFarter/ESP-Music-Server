// The board pack is what you put on the board's SD card (in the Web server widget's folder, /www by default)
// through the board's own /files page. It is a small remote-control site served BY THE BOARD that
// browses this server's library and plays tracks on that board.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as settings from './settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.join(here, '..', 'board');
const read = f => fs.readFileSync(path.join(BOARD, f));
const PUBLIC = path.join(here, '..', 'public');          // the board page wears the server page's own stylesheet

// ---- a store-only zip writer, so there is nothing to install ----
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  const time = 0x6000, date = 0x5a21;               // a fixed 2025 date: the zip is the same every time
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---- the pack ----
export function files({ server, profile }) {
  const s = settings.get();
  const logoFile = settings.logoPath();
  const cfg = {
    server,                                   // where the music server is, as the board's browser reaches it
    profile,                                  // cyd | i2s | hifi
    title: s.theme.title,
    logo: logoFile ? path.basename(logoFile) : '',
    urlField: 'StreamUrl', volumeField: 'Volume', playingField: 'Playing', nowField: 'NowPlaying',   // edit config.js on the card if your design names them differently
    setPath: '/api/set', dataPath: '/api/data',
  };
  const out = [
    { name: 'www/index.html', data: read('index.html') },
    { name: 'www/theme.css', data: settings.themeCss() },
    { name: 'www/style.css', data: fs.readFileSync(path.join(PUBLIC, 'style.css')) },
    { name: 'www/config.js', data: `window.LWMS = ${JSON.stringify(cfg, null, 2)};\n` },
    { name: 'design/lw_routes_example.cpp', data: read('lw_routes_example.cpp') },
    { name: 'README.txt', data: read('PACK-README.txt') },
  ];
  if (logoFile) out.push({ name: `www/${cfg.logo}`, data: fs.readFileSync(logoFile) });
  return out;
}
