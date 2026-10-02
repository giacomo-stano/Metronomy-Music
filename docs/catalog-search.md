# Personalized catalog search

- Search queries return tracks, albums and artists together. Each upstream group
  has its own 12-result page; `nextOffset`, not the mixed item count, paginates it.
  Artist pages open albums and album pages open tracks. Local library artists use
  Navidrome's authenticated artist endpoint.
- Qobuz tracks use the main player, including lock-screen controls and LRCLIB
  lyrics. The bridge resolves a fresh signed stream on each start. Its existing
  qoget client rejects preview-only responses. An active eligible Qobuz account
  and an available recording are required; no subscription or territory bypass
  and no preview fallback are implemented. Streams use lossless CD quality.
- Three-dot menus offer **Scarica sul server**. This remains an explicit action,
  separate from playback. Existing fresh duplicate checks and per-user destination
  permissions remain authoritative. Qobuz-only tracks cannot be deleted from
  Navidrome or added to its playlists/favorites until imported into the library.
- A bounded local listening profile records tracks after 10 seconds of observed
  playback; seek jumps don't count. Profiles are separated by server and username.
  Up to 12 frequent/recent track IDs are sent to the authenticated bridge. Local
  IDs are resolved only through that user's accessible library; Qobuz IDs through
  the catalog. Top genre matches select tracks from Qobuz featured albums.
- With no usable profile, Navidrome's recent albums supply initial genre hints.
  Without usable genres, the UI labels the results as a general bestseller
  selection rather than pretending they are personalized. This is a genre-based
  heuristic, not Qobuz's private recommendation algorithm.

## Deploy and verify

Rebuild/recreate the bridge with the existing Compose files and environment. The
image must rebuild `metronomy-appid` as well as Python code. Then build/install the
new IPA from develop. Existing music, account configuration and download history
do not need to be removed or reinstalled.

Checks: `node tests/network-search.cjs`, `npx tsc --noEmit`, and
`python -m unittest discover -s server/tests -p 'test_*.py' -v` with backend
requirements installed. The catalog workflow also compiles the adapter against
Docker's pinned qoget revision. Tests use mocks, not a real Qobuz subscription.

On iPhone, search an artist without selecting a type, open their album, play a
missing song beyond 30 seconds, change tabs, seek and pause from the lock screen.
Download via the three dots into the authorized destination, and confirm a second
download is refused. Check both Navidrome accounts and airplane-mode behavior.
