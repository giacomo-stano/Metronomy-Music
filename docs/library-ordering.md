# Library order and continuous scrolling

## What changed

- Brani requests `/library/songs?sort=newest|oldest|title|artist`. The bridge
  orders the complete accessible collection **before** selecting a page, rather
  than reversing/sorting the 100 rows currently loaded on the iPhone.
- In multi-user mode the native Navidrome song API receives `_sort=createdAt`
  with DESC/ASC for date order, or title/artist with ASC. It uses the authenticated
  user's existing native token. Failed/denied native requests are not retried as
  an administrator. Only whitelisted song display/playback metadata is returned.
- Native queries explicitly send `missing=false`: Navidrome can retain database
  records for deleted files. Filtering those records must happen upstream before
  pagination/lookahead, not after receiving a page. This is a read filter; it
  does not purge the database, trash, or any offline iPhone copies.
  A file deleted outside the app (or a scan denied to a non-admin) may still need
  a Navidrome scan before it is marked missing. After scanning, refresh Brani to
  invalidate its existing client cache. This fix needs only a bridge update.
- Date means the Navidrome database entry's creation time, not the release year,
  file modification time, or the date a song was starred. A file appears only
  after Navidrome has scanned it. Existing DB dates cannot reconstruct a different
  historical import order after a database rebuild.
- Legacy API-key installations sort their complete Subsonic library index before
  slicing; this reuses the existing 20-second index cache. Favorites are ordered
  using their added dates, not the order returned by getStarred2. Missing dates
  stay last rather than inventing a release-date order.
- Downloaded-on-iPhone lists use the local save date. Offline Brani/Preferiti use
  stored server dates when available, falling back to save dates for old metadata.
- Album title/artist order is also requested globally, not reapplied to each
  appended page. This does not change the Home/Newest album sections.
- FlatList loads the next page at 0.6 viewports from the end. A small footer spinner
  replaces “Carica altri”; only a failed page exposes a retry button. Initial
  refresh and pagination have separate loading states.
- Request generation, list/order keys, offset guards, ID deduplication, and
  advancing-offset checks prevent late responses, duplicate end events and empty
  upstream pages from corrupting the visible list. Pagination never republishes
  the initial scroll offset or starts pull-to-refresh. Returning to a sort restores
  its saved position; refreshing uses the selected order.

## Checks and deployment

Run `npx tsc --noEmit`, all `tests/*.cjs`, and
`python -m unittest discover -s server/tests -v` with backend dependencies.
The tests cover 205-song pagination, date vs release year, native sort parameters,
access failures, safe response fields, invalid query parameters, favorites,
offline order, duplicates, empty pages, explicit retry and stale completions.

Update **both bridge and app**. No build, release, or server deployment is started
by this commit. Validate on iPhone with more than 100 tracks: newest/oldest/title/
artist, several page boundaries while audio plays, rapid sort changes, offline
downloads, and loss/recovery of connectivity near the end of a list.
Bundle export and automated tests do not establish device-level frame smoothness.

API behavior checked against the
[Navidrome media file repository](https://github.com/navidrome/navidrome/blob/v0.64.0/persistence/mediafile_repository.go)
and [model](https://github.com/navidrome/navidrome/blob/v0.64.0/model/mediafile.go).
