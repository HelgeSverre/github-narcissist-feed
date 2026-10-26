# Touch display modes implementation plan

Status: planned; interactive prototype exists, production implementation has not started.
Last updated: 2026-10-26.
Planning branch: `plan/display-modes`, branched from `feature/display-modes`.

## Goal

Adapt Narcissist Feed for a touch-enabled tablet or picture-frame display. It should be readable at a glance, usable without a mouse or keyboard, and capable of optional unattended rotation between screens. Keep the existing dashboard available for focused browsing and account setup.

The user has confirmed touch input and a separate display experience. The exact device, orientation, screen selection and playback defaults are not yet selected.

## Work already captured

- `530da51`: website/PWA builds, guided onboarding, public access without a token, and the clean script; committed and pushed to `main`.
- `32e1f7b`: sample-data display prototype; committed and pushed to `feature/display-modes`.
- The planning branch inherits both commits and all prototype files.

Run `bun run prototype:display` and open `/display-prototype.html`. The `variant` query parameter selects `spotlight`, `activity` or `repositories`.

The prototype is disposable design evidence. It makes no GitHub requests, saves no preferences, and is excluded from production build inputs. Do not promote its fixture data or timer implementation directly into production.

See [the prototype notes](../specs/display-modes.md) for the current interaction details. The reference application is `~/code/samsung-smarttv/devnull-tv`; inspect its README, `app/js/app.js`, and ambient screenshots when resuming. Its large individual items, separated reading/navigation modes and fading hints informed this sketch.

## Proposed architecture

Add a separate `display.html` entry containing a display shell with independent views. Use a URL hash or query parameter for the active view so direct links and reloads work on static hosting. Avoid separate documents for each view: switching screens should preserve playback and browsing state.

Reuse the existing account, cached-event, preference and refresh layers. View changes must not trigger GitHub requests or duplicate polling. Keep display preferences device-local and separate from the desktop layout. Provide clear entry and exit controls between the dashboard and display.

## Initial views to evaluate

| View         | Glanceable content                                                            | Touch behavior                                             |
| ------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Spotlight    | One event, person, repository and timestamp; optional compact weekly summary. | Previous/next event and event details.                     |
| Activity     | A small readable page of recent events, including titles.                     | Older/newer pages, event details and repository filtering. |
| Repositories | Per-repository observed activity over a clearly labeled period.               | Open that repository's activity.                           |

Use large touch targets, existing accessible accent colors and clear selected states. Support landscape and portrait without requiring horizontal scrolling. Keep navigation near the bottom, with no essential hover-only controls.

A separate weekly-summary screen is an open option, not part of the initial implementation commitment.

## Playback and interaction proposal

- Start with explicit, opt-in rotation; reconsider idle activation after trying the prototype.
- Offer a nonempty playlist of views and a configurable dwell time. The sketch has 10 seconds for testing, 30 seconds and one minute; production choices remain open.
- Touch pauses playback. The sketch uses a 30-second hold and an explicit Resume action.
- Reading details or changing settings pauses playback until the panel closes, regardless of the hold timer.
- Returning from a pause starts a fresh dwell interval; never immediately advance away from what someone is reading.
- A Spotlight-only playlist advances events rather than repeatedly showing the same event.
- Fade optional controls during unattended playback; restore them on touch or keyboard focus. Preserve accessible contrast whenever controls are visible.
- Do not advance hidden tabs or run catch-up transitions when the page becomes visible again.
- Queue incoming events while someone reads. Apply updates when leaving details or explicitly returning to the latest activity.
- Respect reduced-motion preferences and maintain keyboard navigation as a secondary input method.

## Data, privacy and unattended behavior

Default the display to public repositories, even when the connected account can read private data. Including private repository names, titles or events requires an explicit display-specific choice. Apply this filter to every view, detail panel and aggregate before rendering.

Label public-mode counts as observed activity; partial REST polling cannot establish complete account totals or complete trends. Distinguish a quiet period from missing coverage, an initial load, a failed refresh and no matching repositories.

Show the last successful refresh. Retain cached activity when offline or rate-limited, and avoid blanking the screen during refresh. Screen rotation and refresh scheduling are separate concerns.

Evaluate fullscreen and feature-detected screen wake-lock support on the intended device later. Do not assume installing the PWA prevents the device from sleeping or guarantees refresh while it is closed.

## Implementation sequence

### 1. Review the sketch and settle the brief

Confirm the actual display size/orientation, default view, desired playlist, dwell times, and explicit versus idle playback. Decide whether tapping an ambient event opens details immediately or first reveals controls. Verify rotation and touch pause by hand; that check remains outstanding.

### 2. Establish the production display entry

Create `display.html`, a production entry module and a small display shell. Add the entry to both website and extension build configurations as appropriate. Preserve the current `index.html` dashboard and extension toolbar behavior. Add a dashboard control to enter Display mode and an accessible way back.

### 3. Share data and persist display preferences

Connect to the existing storage and refresh abstractions without introducing another polling loop. Add a sanitized, device-local display preference object for the playlist, dwell time, default view and visibility choice. Define migrations/defaults without changing desktop filters or layout. Reuse onboarding when no account is configured, returning to the display after setup.

### 4. Build the live views

Implement Spotlight, Activity and Repositories using real filtered cached events. Define stable ordering, readable event grouping and paging. Implement details and repository drill-down. Handle sparse data and incomplete public coverage honestly.

### 5. Implement the playback state model

Separate stopped, playing, paused-for-interaction, paused-for-details/settings and hidden-page behavior. Track the selected view/event independently from the refresh lifecycle. Clean up timers/listeners on unmount and prevent duplicate playback loops across view changes.

### 6. Verify device behavior and release readiness

Verify the chosen hardware first, then representative landscape and portrait viewports. Check website and extension builds, PWA offline behavior, deep links and reloads. Replace prototype-only paths with the production entry and retain the sketch on its historical branch as design evidence.

## Acceptance checks

- Existing configured accounts, dashboard settings and extension behavior continue to work.
- Public mode works without a token; authenticated mode reuses the existing account connection.
- Switching display views causes no GitHub requests and creates no additional refresh scheduler.
- Private data cannot appear by default in events, details, summaries or charts.
- Each main view works using touch, with visible navigation and usable targets in both orientations.
- Playback holds the current view for the chosen interval, follows the playlist, pauses for touch/details/settings, and resumes without a sudden jump.
- Hidden pages stop advancing; returning does not replay missed transitions.
- New data does not interrupt reading or reset the current page unexpectedly.
- Offline, stale, empty, rate-limited and incomplete-coverage states remain useful and understandable.
- Display preferences survive reloads without altering desktop preferences.
- Direct URLs, back-to-dashboard navigation, focus handling, reduced motion and production builds work.

For the production implementation, add focused tests for playback transitions, visibility filtering and preference migration, plus browser checks for touch navigation, dialogs, persistence, offline rendering and view changes without fetching. Do not add implementation-mirroring tests to the disposable sketch.

## Current verification and limits

Before the baseline commit, type checks, lint, formatting and all 500 unit tests passed. The prior work also passed onboarding/PWA browser checks and 16 selected extension browser tests.

The sketch passed type checks, lint, formatting and the website build. Its landscape and portrait layouts were inspected; navigation between its main views was exercised. The final browser connection stalled, so timed playback, interruption/resume and detail/settings interactions still need a hands-on check. These are not recorded as validated behavior.

No final design direction has been approved, no production display mode has shipped, and this plan does not authorize deployment or merging the feature into `main`.

## Next session

Start by trying the prototype and answering the open decisions in step 1. Then implement the production shell and shared data connection. Keep the sketch and plan as references; do not treat the current sample data as real account activity.
