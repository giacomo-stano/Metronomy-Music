# Navigation and playback latency (October 2026)

This pass preserves layout, animations, original audio quality, offline-first
playback, account boundaries and the exact album-completeness rules.

## Costs verified in code

- Each Qobuz catalog request previously created/closed its own HTTP client.
  Artist pages and exact album checks issue many requests, so this repeatedly
  paid connection/TLS setup costs. A bounded, reusable connection pool now serves
  catalog requests, with account credentials supplied per request and shutdown
  cleanup. Signed audio URLs are still resolved afresh and never persisted.
- Album inventory previously scanned every local song for every remote track.
  A request-local recording index narrows candidates by ISRC or artist/title,
  then applies the *same* recording/version/duration comparison in the same order.
  The index only contains the current user's accessible Navidrome snapshot.
- Playing catalog tracks already found in Navidrome required fetching every local
  song again before the queue could start. Catalog responses now include a small
  whitelist of local playback metadata. The app reuses it only when IDs match;
  older bridges and invalid/missing metadata retain the old authenticated lookup.
  A fully loaded album also reuses its loaded track list when Play is pressed.
- Home/News waited up to 220 ms for cover prefetch before revealing content.
  Artwork warm-up is now non-blocking and limited to three requests per batch;
  stale screen generations stop scheduling additional batches.
- Navidrome audio, artwork and metadata shared one connection pool. Dedicated
  audio/artwork pools avoid pool-slot contention with artwork bursts. Cover
  requests ask for 1024px images instead of unconstrained originals; no layout or
  audio format changes. Auth checks, Range forwarding and streaming are retained.
- Home upstream queries now run concurrently. Connectivity probes use `/health`
  instead of fetching an entire Home catalog just to check connectivity.

## Measurements and validation

Synthetic local benchmark: 5,000 local songs, 120 lookups near the end of the
library, no ISRC (metadata fallback). Linear matching took 1123.0 ms; indexed
matching including index construction took 11.9 ms, with identical results.
This is one local CPU benchmark, not an iPhone FPS or production latency claim.
The regression test also confirms 100 lookups in 10,000 songs invoke the final
recording comparator 100 times rather than scanning approximately one million
entries. Embedded metadata tests play a 14-track queue without any extra per-song
fetch; legacy-bridge fallback remains tested.

Run `npx tsc --noEmit`, all `tests/*.cjs`, and
`python -m unittest discover -s server/tests -v` with backend dependencies installed.
Export the iOS bundle to check bundling; a device build is still required for
actual frame/gesture and audio-start measurements.

## What remains network-dependent

Qobuz playback still checks availability and uses the authenticated qoget adapter
to obtain a full, signed stream URL. That adapter authenticates and requests the
file URL at startup. The CDN and the iPhone must then deliver/buffer audio.
Library streaming outside the LAN also depends on home uplink, mobile connection
and any proxy/VPN. These are plausible contributors, not measured causes on the
user's server. No transcoding or bitrate reduction has been introduced.

Bridge responses include `Server-Timing: bridge;dur=...` in milliseconds, covering
processing up to response headers (including auth/upstream setup), **not** complete
audio transfer or iPhone buffering. It contains no user IDs, tokens or URLs.
Compare this with client-observed startup on LAN vs mobile: high bridge time
points to server/upstream work; low bridge time with slow audible startup points
to a later network/player stage. Do not publish full diagnostic URLs or logs,
which may already contain media access tokens.

References: [HTTPX connection pooling](https://www.python-httpx.org/advanced/clients/)
and [OpenSubsonic cover sizing](https://opensubsonic.netlify.app/docs/endpoints/getcoverart/).

Deploy both app and bridge. No build, release or server deployment is started by
these source changes. Device QA should compare cold/warm artist pages, scrolling
Albums while playing, local-library vs Qobuz startup on LAN/mobile, and airplane
mode playback of a verified local download.
