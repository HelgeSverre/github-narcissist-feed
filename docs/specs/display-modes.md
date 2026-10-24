# Touch display modes — interactive sketch

Status: prototype on `feature/display-modes`, not a production feature or an approved final design.

Question: how should a touch-enabled desk tablet or picture frame move between ambient viewing and deliberate browsing?

## Try it

```sh
bun run prototype:display
```

The separate `display-prototype.html` entry opens independently of account setup. Direct views:

- `/display-prototype.html?variant=spotlight`
- `/display-prototype.html?variant=activity`
- `/display-prototype.html?variant=repositories`

Everything is clearly labeled sample data. There is no account access, API fetching, or persisted state. The prototype entry is excluded from the production build inputs.

## Reference

The reference lives at `~/code/samsung-smarttv/devnull-tv`, rather than `~/code/devnull-tv`.
Read its README, ambient implementation in `app/js/app.js`, and `docs/screens/ambient-still.png`.
Its ambient view separates reading from navigation, sizes content for distance, fades hints, and supports both playback and manual browsing.
This sketch borrows that separation while retaining Narcissist Feed's existing theme, accent derivation and icon set.

## Proposed views

| View         | At a glance                                                                                                       | On touch                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Spotlight    | One event with a large repository name, person and timestamp; a compact weekly summary alongside it in landscape. | Previous/next event; tap the event to read details.                     |
| Activity     | Four readable events at a time, with full titles and explicit paging.                                             | Browse older/newer pages, open details, or filter through a repository. |
| Repositories | Per-repository observed stars, forks, conversations and a seven-day chart.                                        | Tap a repository to browse its events in Activity.                      |

A bottom navigation bar makes the three views explicit. Left/right arrows also switch views on a keyboard. Portrait puts the Spotlight summary below the event and simplifies repository rows. Landscape is the starting composition; the exact device and orientation remain open decisions.

## Playback behavior in this sketch

- Rotation is opt-in; starting it preserves the current view for one interval.
- Intervals: 10 seconds for trying the sketch, 30 seconds, or one minute.
- The playlist can contain any nonempty subset of the three views. Spotlight-only playback advances through events.
- Touch pauses rotation for 30 seconds; Resume starts a fresh interval immediately.
- Details and settings pause rotation for as long as they are open, regardless of the touch timer.
- Controls fade during unattended playback and return on touch or keyboard focus. The header/clock stay legible.
- Hidden browser tabs do not advance. Screen rotation is independent of data refresh.
- Escape dismisses a dialog first, or stops playback when no dialog is open.

## Production architecture proposal

Use one separate `display.html` entry with a small display shell and independent Spotlight, Activity and Repositories views. Put the active view in a URL hash or query parameter so refresh and direct links work on static hosting. Separate HTML documents for every screen are unnecessary: they would restart the view and complicate preserving playback state.

Share the existing account, preference, cached-event and refresh layers with the normal dashboard. The display shell subscribes to the same data; changing views never fetches from GitHub. Keep the current dashboard as the place for detailed filters and account setup. Add an explicit link into/out of Display mode.

Keep display preferences separate from desktop layout preferences: playlist, duration, default view, display density and idle behavior belong to the device. Treat public visibility as an explicit display setting, with public-only as the safe initial choice. Do not expose private repository names or titles merely because the desktop account can read them.

For live data, show the last successful refresh and cached/offline state. Counts must say **observed activity** for public mode; incomplete polling cannot support claims about exact account totals or complete trends. New events should queue while someone is reading and appear after they leave the detail view.

## Decisions to make after trying it

- Preferred default view and which views should participate in idle playback.
- Landscape frame, portrait tablet, or equal emphasis on both.
- Whether playback should start explicitly or after an idle period.
- Whether a weekly summary earns a fourth dedicated view.
- Whether touching an ambient event should immediately open details or reveal controls first.

The prototype establishes no final choice among those options. It stays outside `main` until the interaction direction is selected and rewritten for production.
