# iOS seek timing

The native media timeline, not a synthetic timer, drives the player bar. A zero
seek tolerance selects an exact point on that timeline, but does not make an
estimated AVURLAsset byte/time index accurate.

`plugins/withPreciseAudioTiming.js` enables
`AVURLAssetPreferPreciseDurationAndTimingKey` in expo-audio's shared asset factory.
It preserves HTTP headers and applies to initial sources, replacements, and local
files. It is idempotent and fails the build if the expected upstream code changes.
Precise indexing may increase initial loading time for some formats. No media is
transcoded, modified, or truncated to match the progress bar.

The symptom (correct uninterrupted playback, audio continuing after the displayed
end only after seeking) matches a reported FLAC/AVFoundation issue. This is a
strong lead, not proof that every affected file has the same cause:

- [Apple asset timing option](https://developer.apple.com/documentation/avfoundation/avurlassetpreferprecisedurationandtimingkey)
- [FLAC seek overrun report and native workaround](https://github.com/jellyfin/jellyfin-web/issues/8084)

Downloaded songs now use the verified local file even when signed in online.
Missing local files fall back to streaming only in an online session.

## Verification

Run `node tests/precise-audio-timing.cjs`, `node tests/playback-source.cjs`, and
`node tests/playback-timeline.cjs`. After iOS prebuild, run
`node tests/precise-audio-timing.cjs --verify-installed`. The IPA workflow runs
these checks before Xcode compilation. Node tests verify patch application and
source selection, not the behavior of Apple's decoder on a physical iPhone.

This change requires a **new native IPA**, not a JavaScript reload/OTA update or
Expo Go. No bridge update or re-download of existing songs is required.

On iPhone, compare uninterrupted playback with seeks to the middle, backwards,
and to 15 seconds before the end of `Gamesofluck`. Check that the actual audible
ending and the counters agree. Test a downloaded file in airplane mode and an
undownloaded file over the network. Also check pause/resume and the next track.
Do not stop playback automatically at the catalog duration to hide an overrun.
