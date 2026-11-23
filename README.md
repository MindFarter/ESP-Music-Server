# ESP Music Server — V0.0.2

A local music server and web player for ESP32 boards running 
[LCD Wizard](https://lcdwizard.com/). It scans your music folders, streams
music to a browser or an LCD Wizard board, manages internet radio stations,
builds playlists, and provides a board-ready remote-control pack.

**This is a community-built, independent project for use with LCD Wizard. It is
not an official LCD Wizard product.**

The server is designed around the LCD Wizard audio player rather than a
collection of separate players. On the board, Internet Radio stations, music
sent by this server, Play/Stop, Next/Previous, volume, track title and level
displays all use the same audio player. The server's bottom player bar likewise
has one shared set of controls: **Play on** selects the browser or a board, and
the same controls act on that selected output.

## Features

- **Music library:** scan one or more folders; browse artists, albums, genres,
  recent tracks and search results.
- **Board-friendly audio:** serve tracks as MP3, passing through files that
  already fit or using `ffmpeg` to convert for the selected board profile.
- **Shared player controls:** play tracks in the browser or on a configured
  board. The bottom bar controls the selected output; the Player tab shows a
  larger view with the same controls. Browser playback has play/pause, seek,
  volume and queue navigation; board actions include stop, next/previous and
  volume.
- **Queues:** send a track, album or selection to a board. If its `Playing`
  variable is reported, the server advances the queue when a track ends.
- **Playlists:** create `.m3u` playlists for the library, recent and shuffled
  tracks, genres, artists, albums and saved radio stations. Copy a playlist
  address into LCD Wizard's Internet Radio widget.
- **Radio tab:** add and delete stations by name and direct HTTP(S) stream URL;
  listen in the browser or send the station to a board.
- **Plugins tab:** load trusted, local provider adapters for search and playback.
  No provider plugins are bundled. This is an extension interface, not a
  Spotify or Tidal integration; provider authentication, service terms and
  stream compatibility must be handled by the adapter.
- **Board Page:** a remote control the board itself serves from its SD card. It
  wears the same theme, logo and stylesheet as this server's page, browses the
  same library and radio stations, and controls the same player. Download it as
  the **board pack**.
- **Appearance and access:** configure the name, theme, logo and optional admin
  password.

## Requirements

On **Ubuntu, Windows and macOS**, the server needs:

- **Node.js 20 or newer and npm**, available on the command line. npm installs
  the project's `music-metadata` dependency and its dependencies when you run `
  npm install`.
- A modern web browser and a network connection between the server and your
  board.
- **ffmpeg**, strongly recommended for converting music to board-friendly MP3. It
  must be on your `PATH` and have the `libmp3lame` encoder. Without it the
  server can only stream existing MP3 files, unchanged, even if they exceed the
  selected board profile.

The optional `npm test` suite additionally needs **ffprobe** (usually included
with ffmpeg) and **Python 3**, accessible as `python3`. On Windows, the tests
may need a Python installation or shell that provides the `python3` command.
Neither is required just to run the server.

### Ubuntu

Install Node.js and npm from your distribution or the 
[official Node.js download instructions](https://nodejs.org/en/download).
Ubuntu package versions vary: check that `node --version` reports **v20 or newer**
. For ffmpeg:

```sh
sudo apt update
sudo apt install ffmpeg
```
### Windows

Install Node.js 20 or newer from the 
[official Node.js download page](https://nodejs.org/en/download); the Windows
installer includes npm. Install an ffmpeg build with `libmp3lame` from a source
linked by the [ffmpeg download page](https://ffmpeg.org/download.html), and add
its `bin` folder to `PATH`. Open a new PowerShell or Command Prompt after
changing `PATH`.

### macOS

Install Node.js 20 or newer from the 
[official Node.js download page](https://nodejs.org/en/download), or use 
[Homebrew](https://brew.sh/). With Homebrew installed, Node.js and ffmpeg can
be installed with:

```sh
brew install node ffmpeg
```
### Check the installation

In a terminal, run:

```sh
node --version
npm --version
ffmpeg -version
ffmpeg -encoders
```
Check that Node.js is version 20 or newer, that npm and ffmpeg are found, and
that `libmp3lame` appears in the encoder list. If ffmpeg is not installed, the
last two commands will fail and the MP3-only limitation above applies.

## Starting and stopping

In a terminal opened in the project folder:

```sh
npm install
npm start
```
Open the address printed by the server (usually `http://\<this-computer>:8787` ;
use `http://localhost:8787` on the same computer). In **Settings**, add your
music folder(s) and select **Save and scan** . The server also runs on a
Raspberry Pi.

**To stop the server**, select the terminal where `npm start` is running and
press **Ctrl+C**. On Windows, if asked to terminate the batch job, confirm with `
Y`. Closing the browser page alone does not stop the server. If the server was
started in a different terminal, service or background process, stop it through
that terminal, service or process manager instead. Start it again with `npm start`
from the project folder.

Optional environment variables:


|Variable             |Purpose                                                                                          |
|---------------------|-------------------------------------------------------------------------------------------------|
|`ESPMS_MUSIC`        |Music folders, separated by the platform path separator (`:` on Linux/macOS, `;` on Windows).    |
|`ESPMS_PORT`         |HTTP port (default `8787`).                                                                      |
|`ESPMS_DATA`         |Settings and uploaded-logo directory (default `data/`).                                          |
|`ESPMS_PLUGIN_DIR`   |Plugin directory (default `plugins/`).                                                           |
|`ESPMS_MAX_CONVERSIONS`|How many tracks may be converted by ffmpeg at once (default `4`); more wait with a 503 and a retry.|

Keep the server on a trusted network. It uses plain HTTP.

## Which LCD Wizard boards?

**It is not limited to the Cheap Yellow Display.** The server sends standard HTTP
MP3 streams and playlists; it does not depend on one particular display model.
A suitable board needs a working network connection and an LCD Wizard design
that can play MP3 streams through its configured audio output. Remote control
additionally needs the Web server widget, the routes and automation described
below, and enough free memory. For the board-hosted page, it also needs
suitable storage for the pack.

LCD Wizard's [Internet Radio widget](https://lcdwizard.com/docs/widget-radio)
and [Web server widget](https://lcdwizard.com/docs/widget-webserver)
documentation specifies Arduino export on ESP32 for these features. A board
appearing in the [LCD Wizard board catalogue](https://lcdwizard.com/boards)
does **not** by itself guarantee that the needed audio and web features work
together on that board or export.

The following are **candidates**, not a list of boards verified with ESP Music
Server. They are examples from the LCD Wizard catalogue with audio hardware or
a documented output:


|Board or family                                                   |Audio hardware / consideration                                                                                                       |
|------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
|[ESP32-2432S028R Cheap Yellow Display](https://lcdwizard.com/boards/cyd-2432s028r) and [ST7789 variant](https://lcdwizard.com/boards/cyd-2432s028r-st7789)|Classic ESP32 internal DAC and speaker amplifier; start with `cyd`.                                                                  |
|[Guition JC2432W328R](https://lcdwizard.com/boards/guition-jc2432w328r) and [JC2432W328C](https://lcdwizard.com/boards/guition-jc2432w328c)|ESP32 boards with speaker hardware; check the preset and board revision.                                                             |
|[LCDWIKI E32R28T](https://lcdwizard.com/boards/lcdwiki-e32r28t) and [E32R40T / E32N40T](https://lcdwizard.com/boards/lcdwiki-e32r40t)|Classic ESP32 boards with speaker amplifiers; their wiring differs from the Sunton CYD.                                              |
|[Guition JC3248W535](https://lcdwizard.com/boards/guition-jc3248w535) and [ESP32-4848S040 speaker version](https://lcdwizard.com/boards/guition-4848s040-speaker)|ESP32-S3 boards with I2S speaker amplifiers.                                                                                         |
|[Waveshare ESP32-S3-Touch-LCD-3.5B](https://lcdwizard.com/boards/waveshare-s3-35b)|ESP32-S3 with ES8311 speaker codec; LCD Wizard documents its audio wiring.                                                           |
|[LCDWIKI ES3C28P](https://lcdwizard.com/boards/lcdwiki-es3c28p), [ES3C35P](https://lcdwizard.com/boards/lcdwiki-es3c35p) and [ES3C40P](https://lcdwizard.com/boards/lcdwiki-es3c40p)|ESP32-S3 boards with ES8311 speaker codecs.                                                                                          |
|[Waveshare ESP32-S3-Touch-LCD-2.8](https://lcdwizard.com/boards/waveshare-s3-touch-lcd-28) and [2.8 V2](https://lcdwizard.com/boards/waveshare-s3-touch-lcd-28-v2)|ESP32-S3 boards with PCM5101A speaker output.                                                                                        |
|[Waveshare ESP32-C5-Touch-LCD-2.8](https://lcdwizard.com/boards/waveshare-c5-touch-lcd-28) and [ESP32-C6-Touch-LCD-2.8](https://lcdwizard.com/boards/waveshare-c6-touch-lcd-28)|ES8311 audio; confirm Arduino export, networking, available memory and the required widgets on your revision.                        |
|[Elecrow CrowPanel Advanced 9 inch ESP32-P4](https://lcdwizard.com/boards/elecrow-crowpanel-advanced-p4-9) and [Guition JC1060P470C](https://lcdwizard.com/boards/guition-jc1060p470c)|Audio hardware and network connectivity are listed; confirm the required LCD Wizard export and widget support before relying on them.|

Other catalogue boards may work with a suitable external DAC or amplifier and
free pins, but need their own wiring and firmware configuration. An S3 does not
have the classic ESP32's internal DAC, so do not assume the CYD wiring applies.
The server's `cyd`, `i2s` and `hifi` choices are **stream profiles, not a list of
supported board models**. Start conservatively and choose a profile the hardware
can decode.

**Verification status:** the server has been tested with a mock board, not
certified on the models above. LCD Wizard separately reports hardware testing
for some features; that does not verify integration with this server. Check
your exact board revision, export, audio wiring and free heap, then test on
your own hardware.

## Example build: ESP32-S3-Pico, 2-inch touch screen, PCM5102A

This is the build the project is being developed for. **It has not been tested on
that hardware yet.** The facts below come from the makers' documentation:

- [Waveshare ESP32-S3-Pico](https://docs.waveshare.com/ESP32-S3-Pico)**:**
  ESP32-S3R2 with 16 MB flash and 2 MB PSRAM. Waveshare says GPIO33 to GPIO37
  are used by the PSRAM, so do not assign them to anything in the designer.
- 
  [Waveshare 2-inch capacitive touch LCD](https://docs.waveshare.com/2inch_Capacitive_Touch_LCD)**
  :** 240 x 320, ST7789 driver on SPI, CST816D touch on I2C, and a TF (SD) card
  slot on the back. The SD slot shares the screen's SPI bus (MISO, MOSI, SCLK)
  and has its own chip select, so give both the same bus pins in the designer.
  Waveshare's ESP32-S3 guide for this screen lists MISO 42, MOSI 2, SCLK 1,
  SD_CS 38, LCD_CS 39, LCD_DC 41, LCD_RST 40, LCD_BL 6, touch SDA 15, SCL 7,
  INT 17 and RST 16. Check that against your wiring.
- **PCM5102A I2S DAC:** 3.3 V, I2S up to 32-bit and 384 kHz. It needs BCK, LRCK
  (word select) and DIN from the board. Check your breakout's own documentation
  for what its SCK, FMT, FLT and XSMT pins or solder pads must be set to.

In LCD Wizard, set **Hardware > Audio** to MP3 with an I2S output on three free
GPIOs (not the ones above), add the SD card and the Web server widget, and use
the `i2s` profile, which is also the server's default. The board has PSRAM, so `
hifi` (192 kbps) is possible, but move up only after the `i2s` profile plays
cleanly.

Any other ESP32-S3 or ESP32-C6 board with a screen works the same way. The
Board Page is only files on the board's storage, so the screen size does not
matter. What changes is the audio wiring and the profile. A board without PSRAM
(most ESP32-C6 boards) should start with `i2s` or `cyd`.

## The Board Page

Download the **board pack** from **Settings** and upload the files inside `www/`
to the board's `/www` folder through `http://\<board>/files`. Open `
http://\<board>/` in any browser on your network.

- **The same as the server:** it uses the server's own stylesheet, theme colours
  and logo, with the same library (artists, albums with covers, tracks,
  search), radio stations, now-playing display, transport buttons and volume.
  Change the theme or logo in Settings and download a new pack.
- **Playing on the board it is served from:** there is no "Play on" picker. It
  sets `StreamUrl` and `Volume` on the board and reads `Playing` and `NowPlaying`
  back, the same variables the server uses.
- **One queue, not two:** if the board is also added on the server's **Boards**
  page, the server runs the queue and the page does not send "next". The page
  spots this by the address you opened it with, so add the board using the same
  address (for example `kitchen.local` or its IP) that you type in the browser.
  If the board is not added on the server, the page runs its own queue while it
  is open.
- **Stopping is respected:** if a track is stopped by hand before it could have
  ended, the queue waits instead of skipping to the next track.
- **Variable names:** `www/config.js` holds `urlField`, `volumeField`, `
  playingField` and `nowField`. Edit it on the card if your design names them
  differently.
- **Web server port:** LCD Wizard's Wi-Fi-by-phone page can use port 80 and move
  the Web server to 8080 while both run. If yours does, add the board as `
  192.168.1.50:8080` and open the page on that port.
- The page loads the library from the music server in your browser, over plain
  HTTP, from the address chosen when the pack was downloaded.

## LCD Wizard setup

1.  In **Hardware > Audio**, enable audio and use the MP3 codec. Choose the board
    profile that matches the board's DAC/codec.
2.  Add Wi-Fi setup and a Web server widget. On SD-card boards, set its files
    folder to `/www`.
3.  Add the data variables expected by the board pack:
- `StreamUrl` — Text, set by events.
- `Volume` — Integer, bound both ways to Audio > Volume.
- `Playing` — Boolean, bound to Audio > Playing.
- `NowPlaying` — Text, bound to Audio > Track title.
4.  Add Web server routes `GET /api/data` and `POST /api/set`. The music
    server's **Boards** page lets you change route and variable names if your
    design differs.
5.  Add an automation for changes to `StreamUrl`: play the address when
    non-empty, and stop audio when empty.
6.  Add the board under the server's **Boards** tab. For the board's
    remote-control page, download the **Board pack** from Settings, then upload
    the files inside `www/` through `http://\<board>/files`.

The Board Page is described above. The exact trigger and action names depend on
the design. Follow the generated LCD Wizard code as the source of truth for
route signatures. See the 
[LCD Wizard audio documentation](https://lcdwizard.com/docs/audio), 
[Internet Radio widget documentation](https://lcdwizard.com/docs/widget-radio),
and [board pack instructions](./board/PACK-README.txt).

### Radio stations and playlists

Add a direct stream URL under **Radio**. Saved stations can be played in the
browser, sent to a board, or exported as an M3U list. The address copied by the
Radio tab can be used in LCD Wizard's Internet Radio widget under **Takes more
stations from > A playlist at an address**.

Station compatibility depends on the board firmware and stream format. The
board supports HTTP most reliably; HTTPS can require more free heap. The server
stores URLs and passes them through—it does not proxy or convert third-party
radio streams.

### Board profiles


|Profile                   |Suggested use                 |Output             |
|--------------------------|------------------------------|-------------------|
|Cheap Yellow Display (`cyd`)|Internal 8-bit mono DAC       |96 kbps mono MP3   |
|I2S (`i2s`)               |I2S DAC or ES8311 codec       |128 kbps stereo MP3|
|Hi-fi (`hifi`)            |ESP32-S3 with PSRAM or browser|192 kbps stereo MP3|

The default profile is `i2s`. An MP3 that already fits the selected profile is
passed through, starting at its first audio frame (a large ID3 tag with cover
art is skipped, so a small board's buffer is not filled with a picture). Other
supported audio files are converted by `ffmpeg`. The stream endpoint uses ICY
metadata for track titles and avoids chunked transfer encoding for firmware
that expects HTTP/1.0.

## Adding a plugin

Plugins are JavaScript modules that run in the server process. Only install
code you trust. Create a file named `plugins/\<plugin-id>.js`, then restart the
server. The file's default export must include:

```js
export default {
  id: 'example',
  name: 'Example provider',
  version: '0.1.0',
  description: 'Searches a music provider',
  async search(query) {
    // Return items with id, title, and optional artist, album, duration.
    return [];
  },
  async resolve(itemId) {
    // Return a directly playable HTTP(S) stream URL and optional title/artist.
    return { url: 'https://provider.example/audio.mp3', title: 'Track', artist: 'Artist' };
  },
};
```
The Plugins tab lists loaded adapters and lets you search, then play returned
streams in the browser or send them to a board. `search()` should return an
array of up to 100 items. `resolve()` should return an HTTP(S) URL without
embedded credentials. The server does not fetch or proxy the resolved URL; the
browser or board connects to it directly. For services such as Spotify or
Tidal, an adapter must use the service's permitted API and authentication flow
and return audio that the target can actually play. No such adapter is included
in V0.0.2.

## HTTP API

Open/read endpoints (JSON unless noted):

- `GET /stream/\<track-id>.mp3?p=cyd|i2s|hifi`
- `GET /playlist/{all,recent,random,genre,artist,album,search,radio}.m3u`
- `GET /art/\<track-id>`
- `GET /api/browse/{artists,albums,genres,tracks}`
- `GET /api/playlists`, `GET /api/radios`, `GET /api/theme`, `GET /api/managed`
- `GET /theme.css`, `GET /logo`

Admin-protected when a password is set:

- `GET|PUT /api/settings`, `PUT /api/theme`, `POST|DELETE /api/logo`, `POST
  /api/rescan`
- `POST /api/radios`, `DELETE /api/radios/\<id>`
- `GET /api/boards`, `POST /api/boards`, `GET /api/boards/\<id>/status`
- `POST /api/boards/\<id>/{play,queue,next,prev,stop,volume,radio,url}`
- `GET /api/plugins`, `GET /api/plugins/\<id>/search?q=...`, `POST
  /api/plugins/\<id>/resolve`
- `GET /api/boardpack.zip`

## Security notes

- There is no password by default, and Settings shows a warning until you set
  one. Set it under **Settings > Password** to protect settings, station
  management, plugins and board control. Browsing, streams and playlists remain
  open so boards can access them. The password is stored as a salted scrypt
  hash.
- This is plain HTTP; the optional password is not protection against someone
  monitoring the network.
- Changes to settings must be sent as JSON, and the server gives no cross-site
  permission for them, so a web page on another site cannot change your
  settings from a browser on your network.
- The server only sends board-control requests to private/local hosts, and a
  board's route paths always start with `/`.
- Plugin modules are trusted server-side code and can perform actions available
  to the server process. Do not install untrusted plugins.
- Library file paths are not returned to clients. Uploaded SVG logos are served
  in a sandbox.
- If a music folder cannot be read (an unplugged drive, a sleeping NAS), the
  scan stops and keeps the existing library instead of emptying it.

## Tests

Run `npm test`. The smoke test starts a real server with generated audio, `ffmpeg`
and a mock board. It covers library scanning, playlists and radio management,
plugin search/resolve, MP3 pass-through/transcoding, HTTP/1.0 and ICY behavior,
theme/logo, board-pack ZIP, board playback and queue controls (including
stopping by hand), local-network restrictions, cross-site requests, password
storage and protection, unreadable music folders and path traversal. The Board
Page's own JavaScript is not tested automatically.

## Hardware status

Verify your generated route code, automation and available heap on the target
board. The Radio and plugin pages pass stream URLs directly to the target, so
stream codec and network compatibility still apply.

## License

[MIT](./LICENSE). Copyright (c) 2026 MindFarter.

This is a community project for use with [LCD Wizard](https://lcdwizard.com/).
It is not an official LCD Wizard product, and LCD Wizard is not affiliated with
it.

