// lw_routes.cpp: the two routes the music server and the board-hosted page talk to.
//
// LCD Wizard writes this file afresh on every export, with a first answer already in each function
// (GET answers with the design's variables as JSON, POST sets each variable it is sent a value for).
// That first answer is all the music server needs, so for most designs you do NOT have to change
// anything: add the routes and the variables below and the generated code already does the job.
// This copy is here to show what the generated functions do, and where to change them.
//
// If your export's text setter takes a different argument type than the one used below, trust the
// function LCD Wizard generated over this copy.
//
// Designer setup (Data tab, Web server widget, Automations): see README.txt in the pack.

#include "app_logic.h"        // var_<Name>_get() and var_<Name>_set(), written by the export

// GET /api/data  ->  {"StreamUrl":"...","Volume":60,"Playing":true,"NowPlaying":"Artist - Title"}
void route_api_data(ServerRequest & req)
{
    ServerJson j;
    j.add("StreamUrl", var_StreamUrl);     // Text   (set by events only)
    j.add("Volume", var_Volume);           // Integer 0..100, two-way with the player's Volume
    j.add("Playing", var_Playing);         // Boolean, from Audio > Playing
    j.add("NowPlaying", var_NowPlaying);   // Text, from Audio > Track title (may stay empty on some streams)
    req.json(j);
}

// POST /api/set  <-  StreamUrl=http://192.168.1.10:8787/stream/ab12cd34ef56.mp3?p=cyd
//                    Volume=40
void route_api_set(ServerRequest & req)
{
    if (req.hasArg("StreamUrl")) var_StreamUrl_set(req.arg("StreamUrl"));   // an automation plays it
    if (req.hasArg("Volume"))    var_Volume_set((int32_t)req.argInt("Volume"));
    req.ok();
}
