// Builds .m3u playlists the LCD Wizard Internet Radio widget can read.
//
// From the LCD Wizard audio docs:
//  - the station's name comes from the line before its address (#EXTINF:-1,Name);
//  - the line under the name comes from group-title="...";
//  - a list holds 256 items at most, so playlists are capped (default 200) and can be paged;
//  - .m3u8 (HLS) cannot be played, so we never emit that.
import * as lib from './library.js';
import { get, PROFILES } from './settings.js';

export const MAX_ITEMS = 256;
const oneLine = s => String(s).replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();

export function streamUrl(base, track, profile) {
  return `${base}/stream/${track.id}.mp3?p=${profile}`;
}

export function build({ base, profile, tracks, limit = 200, offset = 0, title = 'Music' }) {
  const p = PROFILES[profile] ? profile : 'cyd';
  const n = Math.max(1, Math.min(MAX_ITEMS, Number(limit) || 200));
  const slice = tracks.slice(Math.max(0, Number(offset) || 0), (Number(offset) || 0) + n);
  const lines = ['#EXTM3U', `# ${oneLine(title)}: ${slice.length} of ${tracks.length} tracks`];
  for (const t of slice) {
    const group = `${t.albumArtist} - ${t.album}`.replace(/,/g, ' ');       // the board reads the name after the first comma
    // Under the name the board shows the artist and album; the name itself stays short for small screens.
    lines.push(`#EXTINF:-1 group-title="${oneLine(group)}",${oneLine(t.title)}`);
    lines.push(streamUrl(base, t, p));
  }
  return lines.join('\n') + '\n';
}

// Every playlist the server can make, as { name, path } so the UI can list and copy them.
export function catalogue() {
  const out = [
    { group: 'Everything', name: 'Whole library (first 200)', path: '/playlist/all.m3u' },
    { group: 'Everything', name: 'Shuffled, 50 tracks', path: '/playlist/random.m3u?n=50' },
    { group: 'Everything', name: 'Recently added', path: '/playlist/recent.m3u' },
    { group: 'Radio', name: 'Saved radio stations', path: '/playlist/radio.m3u', tracks: get().radios.length },
  ];
  for (const g of lib.genres()) out.push({ group: 'Genres', name: g.name, path: `/playlist/genre.m3u?name=${encodeURIComponent(g.name)}`, tracks: g.tracks });
  for (const a of lib.artists()) out.push({ group: 'Artists', name: a.name, path: `/playlist/artist.m3u?name=${encodeURIComponent(a.name)}`, tracks: a.tracks });
  for (const a of lib.albums()) out.push({ group: 'Albums', name: `${a.artist} - ${a.album}`, path: `/playlist/album.m3u?id=${a.id}`, tracks: a.tracks });
  return out;
}

export function forRequest(url) {
  const q = url.searchParams;
  const kind = url.pathname.replace(/^\/playlist\//, '').replace(/\.m3u$/, '');
  let tracks, title;
  switch (kind) {
    case 'all': tracks = lib.find(); title = 'Whole library'; break;
    case 'recent': tracks = lib.find({ sort: 'recent' }); title = 'Recently added'; break;
    case 'random': {
      tracks = lib.all();
      for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
      title = 'Shuffled'; break;
    }
    case 'genre': tracks = lib.find({ genre: q.get('name') }); title = q.get('name'); break;
    case 'artist': tracks = lib.find({ artist: q.get('name') }); title = q.get('name'); break;
    case 'album': tracks = lib.find({ album: q.get('id') }); title = 'Album'; break;
    case 'search': tracks = lib.find({ q: q.get('q') }); title = `Search: ${q.get('q')}`; break;
    default: return null;
  }
  return { tracks, title, limit: q.get('n') || q.get('limit'), offset: q.get('offset'), profile: q.get('p') };
}
