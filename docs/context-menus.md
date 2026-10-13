# Artist hero and contextual menus

The catalog hero extends through the measured top safe-area inset. Its navigation
buttons retain that inset; the scroll view must not add an automatic inset again.
ScreenInsetsProvider measures the existing native SafeAreaView at the app root,
without hard-coded iPhone/Dynamic Island dimensions or new native dependencies.

Song, album, Qobuz, player and library menus share FloatingMenu. The panel anchors
to the triggering control's measured window bounds, not root-relative touch
coordinates. It is clamped inside the safe area and scrolls with an indicator.
The control is remembered for taps, long presses and accessibility activation;
stale/unmounted controls fall back to the safe top-right corner. Measurement and
content sizing finish offscreen before the entrance spring to avoid a position jump.
Long menus lift upward instead of being squeezed into 300pt at the bottom. They
can use up to 720pt (or the available safe height), with a minimum 250pt width on
small phones to keep the three quick actions readable.
MenuControls supplies wrapping text, SF Symbols, grouped separators and quick
actions. GlassBackground handles light/dark, reduced transparency and older iOS;
the player uses a dark surface. A menu-only nearly opaque tint keeps white/black
text legible over album artwork even if native glass fails to render. Reduce
Transparency makes that tint fully opaque. Other glass surfaces are unchanged.
The panel animates scale only, never ancestor opacity: Expo GlassEffect documents
that a zero-opacity ancestor can prevent native glass rendering. Only the separate
backdrop fades. Reduced Motion disables the panel spring.

Reference: https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/#known-issues

Existing actions are retained: local removal never deletes a server file; server
deletion still requires its checked token and confirmation. Catalog download still
checks ownership and destination. Unsupported Apple Music actions are not added.

No bridge update or data migration is needed. Install a new client build.

## Device checks still required

- iPhone with Dynamic Island: open Caparezza from search, scroll down/up, return
  to search and switch tabs. No black status-bar strip, buttons clear of the island.
- Open track, album, artist, library-header and player menus, including rows at
  the bottom. All options are reachable; taps outside dismiss; actions keep working.
- Check light/dark, larger accessibility text, Reduce Motion and Reduce Transparency.
- Download/cancel/remove a local copy; toggle a favorite; choose a playlist;
  cancel the server-deletion confirmation. Do not delete real files just to test UI.
- Test portrait/landscape, small screen and opening menus while the keyboard is up.

Automated checks: TypeScript, tests/context-menus.cjs, existing tests/*.cjs,
and an iOS JS/Hermes export. These cannot verify native glass or touch on a device.
