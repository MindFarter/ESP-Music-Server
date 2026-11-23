# ESP Music Server
Node >=20 ESM, plain `node:http`, one dependency (music-metadata). No build, linter or formatter.

- Run: `npm start`. Test: `npm test` (e2e `test/smoke.js`; needs ffmpeg with libmp3lame; uses temp dirs via ESPMS_DATA/ESPMS_PORT/ESPMS_MUSIC/ESPMS_PLUGIN_DIR).
- Server: `server.js`; modules in `lib/`; web UI in `public/`; board pack in `board/`; local provider plugins in `plugins/` (contract in `lib/plugins.js`).
- Never edit `data/` (real settings, library cache, logo) or `package-lock.json` by hand; a hook blocks it.
- Keep dependencies minimal; version lives in both `package.json` and the README title.
