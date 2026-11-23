ESP Music Server: board pack
============================

What is in this zip
  www/index.html      A remote control the BOARD serves: search the music server, play, volume, queue.
  www/theme.css       The colours chosen in the music server's Settings > Appearance.
  www/style.css       The music server's own stylesheet, so this page looks like the server's.
  www/config.js       Where the music server is, which board type it plays to, and the variable names.
  www/<your logo>     Only if you uploaded one in Settings.
  design/lw_routes_example.cpp   What the two routes do (LCD Wizard writes the same for you).

Change the colours or logo later and download a new pack: only theme.css and the logo change.

1. In the LCD Wizard designer
-----------------------------
 a. Hardware > Audio: switch audio on, codec MP3. On a Cheap Yellow Display the output is the internal
    DAC on GPIO 26 (the preset fills it in).
 b. Add a WiFi Setup widget (the board needs a network) and a Web server widget.
    Set a Name and Password on the Web server (the Problems tab asks for it).
    On an SD card board, set "Files are kept" to the SD card, folder /www.
 c. Data tab: add four variables
        StreamUrl    Text      source: (set by events only)
        Volume       Integer   bind to Audio > Volume (two-way)
        Playing      Boolean   Audio > Playing
        NowPlaying   Text      Audio > Track title
    These names are what the pack and the music server expect; the music server's Boards page lets you
    change them if yours differ.
 d. Web server widget > Routes > Add a route:
        GET  /api/data     (answers with the variables as JSON)
        POST /api/set      (sets each variable it is sent)
    LCD Wizard writes the first answer for both, so they already do what is needed. Leave "Password" ticked
    off on these two if you want the music server and this page to work without signing in, or tick it and
    enter the same name and password on the music server's Boards page (the page you open on the board
    will then ask for it as well).
 e. Automation: when the StreamUrl variable changes ->
        if it is not empty: Play audio, "an address held in a Text variable", StreamUrl
        if it is empty:     Stop audio
    (Events and actions > Automations in the docs shows how to build a change trigger and a condition.)
 f. Add an Internet Radio or Radio icon widget if you also want stations on the screen; they and the
    music server share the same player, so volume, level meters and the track title work for both.
 g. Generate the code and flash it.

2. Put the site on the board
----------------------------
Open http://<board address>/files, sign in, and drop the files from www/ onto the page
(index.html, theme.css, style.css, config.js and the logo). Then http://<board address>/ shows the remote.

3. Check it
-----------
 - http://<board address>/api/data should show StreamUrl, Volume, Playing and NowPlaying.
 - On the music server: Boards > add the board > Test. Then play a track from the Library.

How continuous play works
-------------------------
A board plays one address at a time. When a track that was playing has ended, the next one is sent:
 - by the music server, if the board is added on its Boards page (it watches "Playing"), or
 - by this page, while it is open in a browser and the server is not already doing it.
The page asks the server, and recognises the board by the address you opened the page with, so add
the board on the Boards page with that same address (kitchen.local, or its IP).
A track stopped by hand before it could have ended does not make the queue skip on.
If your design names the variables differently, edit www/config.js on the card
(urlField, volumeField, playingField, nowField). If the Wi-Fi-by-phone page moves the Web server to
port 8080, use <board address>:8080 both on the Boards page and in the browser.

Playlists as stations
---------------------
For a radio-style list on the screen, use the music server's Playlists page: copy an address into the
Internet Radio widget under "Takes more stations from" > "A playlist at an address".

Limits worth knowing
--------------------
 - The board fetches a playlist when it starts and lists up to 256 stations.
 - Use http, not https: a board without PSRAM has no room for a secure connection while it plays.
 - A Cheap Yellow Display has an 8-bit mono DAC, so the "Cheap Yellow Display" board type sends
   96 kbps mono MP3; sending more only costs CPU and memory.
