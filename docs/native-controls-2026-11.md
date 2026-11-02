# Native iOS controls

The iOS build now uses public UIKit controls for the standard interactions that previously simulated system controls in React Native. This is a controls migration, not a rewrite of every screen in SwiftUI or a claim of pixel-identical Apple Music UI.

## Coverage

| Interaction | Implementation |
| --- | --- |
| Song, album, catalog, player and library filter menus | `UIButton.menu` / `UIMenu` / `UIAction`; UIKit owns layout, scrolling, highlighting and presentation/dismissal |
| Quick menu actions | Inline menu group with the system's small element size; ordinary rows retain large elements, subtitles, selection and destructive state |
| Options/filter buttons, play/pause, simple text or symbol buttons | `UIButton`; existing shared button entry point converts supported content while keeping callbacks and disabled state |
| Individual glass buttons | `UIButton.Configuration.glass()` on iOS 26+, system gray configuration on older iOS |
| Playback seek and fallback app volume | `UISlider`; commit seeks at release, cancel safely, support VoiceOver adjustments |
| System volume | `MPVolumeView` with its original thumb, track and interaction; removed custom images, subview traversal and scale animation |
| Qobuz/library scope, appearance, artist album ordering | `UISegmentedControl`, with controlled-value reconciliation when a selection is rejected offline |
| Tab bar, AirPlay, text inputs, alerts and sharing | Existing native integrations remain in place |

Artwork cards, composite navigation rows, synchronized lyrics and screen transitions retain their app-specific layout. The shared button converter deliberately declines rich/nested content rather than dropping a subtitle, child action or custom rendering. Lyrics explicitly keep their timed styling. A button with an external ref keeps the existing implementation so callers retain measurement access. Android, Expo Go and installed binaries without the new module retain the prior controls.

## Behavior and safety

- Programmatic UIKit menus require iOS 17.4. The module exposes `supportsNativeMenus`; earlier iOS versions and binaries without that capability use the existing fallback menu while retaining the other supported native controls. The Swift call to `performPrimaryAction()` is availability-guarded as well.
- The menu collector renders hook-owning actions such as offline downloads normally. Only layout wrappers are flattened. Numeric paths preserve ordering across fragments, asynchronous rows and download groups.
- Menu callbacks stay in JavaScript. UIKit receives descriptors and identifiers; disabled, busy, stale and unmounted entries are checked again before dispatch.
- Keeping menus presented permits favorite/download state and playlist submenus to update without dismissing and reopening the menu. Destructive confirmations and authorization remain in the existing action handlers.
- Menu placement uses the measured trigger in window coordinates. UIKit chooses the final placement and overflow behavior. A transparent React Native modal isolates the underlying screen from menu dismissal touches.
- A native slider does not overwrite the thumb while tracking. It emits preview, commit and cancellation separately; ordinary scrubbing does not send repeated seek requests. The existing seek coordination and playback engine remain unchanged.
- Simple buttons use current callback refs and stable native configuration; a delayed native event cannot execute an old callback after a rerender. The native button owns its highlighted appearance.
- The new module is local and requires no additional package or bridge endpoint.

## Validation

- TypeScript `tsc --noEmit`.
- 28 JavaScript regression suites, including native-menu registration/order, live updates, callback invalidation, offline selection rejection, seek/cancel/VoiceOver and button conversion.
- Expo Apple autolinking resolves `MetronomyControlsModule` and the existing audio-control modules.
- iOS Metro/Hermes export.

Windows cannot compile UIKit/Swift or verify device rendering. A new iOS build must still compile and be checked on iPhone: open menus near the top/bottom, switch playlist submenus, scroll a long menu, cancel a download, test nested options buttons without starting the song, scrub/cancel/adjust with VoiceOver, use larger text and both themes, and repeat in offline mode. No build or release is triggered by this change.

## Public API references

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and [native views](https://docs.expo.dev/modules/native-view-tutorial/).
- [UIKit system control design](https://developer.apple.com/videos/play/wwdc2025/284/) and [glass button configuration](https://developer.apple.com/documentation/uikit/uibutton/configuration-swift.struct/glass()).
- [UIControl primary action](https://developer.apple.com/documentation/uikit/uicontrol/performprimaryaction()) and [updating a visible context menu](https://developer.apple.com/documentation/uikit/uicontextmenuinteraction/updatevisiblemenu(_:)).
