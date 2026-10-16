# Library downloads and tab navigation

## iPhone downloads

- In Library → Songs → ⋯, `Scarica tutti su iPhone` enumerates every page of
  the authenticated library before downloading. It does not use the currently
  loaded list as the complete library. The same actions are available in Downloads.
- Confirmation explains disk/network use. Downloads use the existing serial,
  account-scoped queue and validated local files: individually saved songs and
  in-flight downloads are not duplicated. Available artwork, lyrics and metadata
  follow the existing enrichment path. Qobuz catalog streams are not included.
- An inline status reports preparation, saved/skipped counts, failures and
  completion. Each downloading song retains its existing progress ring. Cancel
  stops the bulk operation; finished files stay available. A failure stops the
  batch; retry skips the files already saved. No fake percentage is shown while
  discovering the library or while byte length is unknown.
- This remains a foreground download queue. Keep the app open; iOS background
  transfer/relaunch persistence is not promised. Retrying after interruption is safe.
- `Rimuovi tutti i download` requires destructive confirmation and affects only
  the current account's app-managed iPhone files, including covers/lyrics. It
  cancels queued audio and enrichment, waits for transfers to settle, and pauses
  a selected local song before deleting. No server/trash/favorites endpoint is
  invoked. The operation works offline and cannot remove other accounts' files.

## Four bottom tabs

- A single tap switches immediately, keeping each mounted screen's navigation
  state and remembering its open library album and scroll position.
- Two short taps on the same icon within 350 ms reset only that tab. Home/New
  scroll to the top and dismiss the album; Library returns to its root; Search
  clears its query/detail and returns to discovery (library when offline).
- Dragging or holding an icon selects it without being treated as a double tap.
  VoiceOver offers separate Open tab / Home page actions.
- The retained PanResponder calls the latest callback, avoiding stale tab/album
  state. Repeated playback renders do not republish list content offsets.

## Verification and deployment

TypeScript and automated tests exercise complete pagination, skipped downloads,
retry, cancellation/removal races, account isolation, gesture classification,
and stable scroll offsets. Native layout, iPhone gesture feel and background
behavior still need device testing. This is an app-only update: no bridge change
or server rebuild is required.
