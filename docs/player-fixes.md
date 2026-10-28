# Player fixes — 2026-10-28

- Login uses the same approved v2 icon as the app configuration.
- The native mini player keeps its play/pause symbol while buffering. Removed
  the spinner view entirely instead of hiding the UIButton image (UIKit can
  restore that image during layout). Buffering remains available to VoiceOver.
- Artist/album play buttons also keep their play symbol; busy still prevents
  duplicate requests. Download indicators and content-loading indicators remain.
- The main Expo player uses keepAudioSessionActive. In expo-audio 57.0.5,
  onPlaybackComplete otherwise schedules deactivateSession after 100 ms and
  checks only isPlaying. A next source still buffering can therefore lose the
  session even though replace/play has already been called.
- EOF now dispatches directly from playbackStatusUpdate, once per source session,
  rather than relying on a React effect on the transient didJustFinish flag.
  Replacement, logout and removal invalidate the active completion session.
  Manual replay rearms EOF; repeat-one stays native; shuffle/repeat-all and the
  existing queue selection are unchanged. No duration-based end detection.

Validation: tests/playback-completion.cjs covers burst events, duplicates,
replacement, pause/buffering and replay; it runs in the iOS build checks.
Physical iOS validation is still required: play a multi-track album through EOF
using server streaming, Qobuz and local downloads, including with screen locked
and a slow network. Confirm next audio starts without touching Play, repeat-one,
repeat-all, pause/resume and a manual skip during loading. Check login and native
mini player on the new binary. A single-track queue still ends after that track.
No bridge changes required.
