# Library scrolling, server downloads and artist albums

LibraryScreen now publishes its initial scroll offset only when the keyed page
changes. Audio ticks and mini-player visibility updates no longer send an older
JS scroll position back to the native list while momentum is active.

ServerDownloadsProvider lives inside the account-keyed tree. One foreground
poller shares server job state across search, recommendations, artist pages,
album tracks, discography, player and action menus. A sending/downloading spinner
uses actual job states, not a fabricated percentage (the bridge has no byte
progress). Reduce Motion shows a static hourglass. Errors show an alert badge;
the menu can retry. A cloud check means a library match, a cloud outline means
an album contains some local tracks, and cloud-download means the job finished
but presence in Navidrome is not yet confirmed. Local iPhone download indicators
remain separate.

Requests and poll snapshots are guarded against duplicate taps, stale responses
and logout. Completed jobs refresh catalog/library metadata once immediately
and once after 25 seconds, allowing Navidrome's scan and its 20-second index cache
to finish. Old history is
not proof that files still exist. The server remains the authority for duplicate
checks, destinations and account access. No download is started automatically.

Artist Album headings and All discography now open a dedicated two-column page
with title/date sorting of loaded releases, pagination, album playback and menus.
Covered pages remain mounted, so Back restores the artist/album-grid position.
No categories are invented when Qobuz doesn't supply them.

Deploy both the new client and bridge for album IDs and partial/complete album
badges. Existing bridges still support individual job indicators; track indicators
inside an open album also inherit its ID locally.

Device QA: scroll Albums with music playing, hide/show mini-player, return from
an album, enqueue a track and album, switch screens, check completion/error and
offline/reconnect, change accounts, open artist Album heading and paginate then
return. Automated tests cannot replace iPhone gesture/rendering validation.
