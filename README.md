# Live NFL Scores — Stream Deck Plugin

A Stream Deck plugin that shows live NFL scores directly on your buttons. Each button tracks one team and updates automatically every 30 seconds.

![Live NFL Scores Plugin](https://img.shields.io/badge/Stream%20Deck-Plugin-blue) ![Version](https://img.shields.io/badge/version-1.0.10-green)

---

## Features

- **Live scores** — shows away score, home score, quarter, and game clock while a game is in progress
- **Possession indicator** — the team with the ball is shown in brown, turning orange if they're in the red zone
- **Two-minute warning** — the clock turns red during the final 2:00 of the 2nd and 4th quarters
- **Pre-game** — shows the matchup (e.g. `DEN @ KC`) and scheduled kickoff day/time
- **Final scores** — shows the final score with a "Final" label, including OT labeling for overtime games
- **Score-change flash** — when a team scores, the button flashes in that team's primary color
- **End-of-game fireworks** — a short celebratory animation in the winning team's colors plays when the game ends
- **Gamecast shortcut** — press any button to open that game directly in ESPN Gamecast
- **Bye-week shortcut** — if your team has no game scheduled, pressing the button opens that team's full schedule on ESPN instead
- **No-flicker updates** — buttons only redraw when the display actually changes
- **Multi-button support** — add as many team buttons as you want, each refreshes independently
- **Custom background color** — set a per-button background color and opacity in the settings panel, handy for telling teams apart at a glance across multiple buttons
- **All 32 NFL teams** across all 8 divisions (AFC East, North, South, West and NFC East, North, South, West)

---

## Recent Updates

**v1.0.10.0**
- Added a custom background color option in the settings panel: toggle it on, pick a color, and adjust its opacity. Useful for telling teams apart at a glance when you've got several buttons configured (e.g. your Falcons button in red, your Panthers button in blue). Off by default — buttons keep the original plain black background unless you turn it on. Applies to the normal score display; the score-flash and end-of-game fireworks animations still use their own colors on top of it.

**v1.0.9.0**
- Replaced the action and category icons (the small football-glyph placeholders) with the provided player-silhouette artwork, recolored white-on-transparent and sized down to the required 20×20 / 40×40 / 28×28 / 56×56, matching the branded look now used for the main plugin icon. Centered on the pose's visual mass rather than its raw bounding box — the bbox was already symmetric, but the bulkier shoulder-pad geometry on one side still read as visibly off-center to the eye.

**v1.0.8.0**
- Replaced the plugin icon with the branded player-silhouette artwork (matching the style of the Live CFB Scores icon), resized to the required 256×256 / 512×512 (high-DPI) variants.

**v1.0.7.0**
- Bye weeks now show `BYE WEEK` instead of the generic `No Game`. Detected without any extra API call: if other teams have games in the current window but this one doesn't, that specifically means a bye — a normally-scheduled team can never actually go empty given the hold-until-Tuesday and 10-day-forward rules, only a bye (roughly double the usual gap between games) can push it past both.

**v1.0.6.0**
- Replaced the ESPN-calendar-based "hold the final" rule from v1.0.5.0 with a simpler, fixed one: a final now holds until the next Tuesday, 3:00 AM ET, after that specific game, regardless of which point in the season it is. No extra API call needed for this anymore — it's a plain date calculation anchored to the finished game's own kickoff time.

**v1.0.5.0**
- Fixed the final score getting replaced by next week's matchup almost immediately once that next game is close enough to appear in the rolling 21-day window — previously an upcoming preview always outranked a finished game, so in preseason (where games can be barely a week apart) the final could be visible for only one refresh cycle.

**v1.0.4.0**
- Added an adaptive refresh cadence: buttons now poll every 15 seconds (instead of the normal 30) once the game is inside the two-minute warning window of the 2nd or 4th quarter, so a fast-moving crunch-time sequence is less likely to skip past a score or clock-management play between refreshes. Falls back to 30 seconds the moment the quarter ends.

**v1.0.3.0**
- Fixed the possession indicator briefly flashing to white right around scoring plays (e.g. during an extra point attempt right after the preceding touchdown). ESPN's possession data occasionally goes blank for a single poll at exactly that moment even though the game is still live; the plugin now holds onto the last known possession for that specific game through a blank gap instead of dropping to "nobody has the ball."
- That same carry-forward is deliberately skipped during halftime — ESPN's possession data is blank there too, but for 15-20 real minutes with genuinely nobody holding the ball, so the button correctly shows no possession color through the whole intermission instead of freezing on whoever had it at the two-minute warning.

**v1.0.2.0**
- Fixed live-game score lines (e.g. `CAR 0` / `ARI 0`) rendering visibly off-center on real Stream Deck hardware. The possession-color split now renders as two colored `<tspan>`s inside a single centered text element — the same native centering the clock line already used — instead of manually computing where two separate text elements should sit. This removes any dependency on guessing the device's real font metrics for positioning.
- Fixed the gap between the team abbreviation and score collapsing (`CAR0` instead of `CAR 0`): the tspan `dx` offset used to create that gap was silently ignored by the device's renderer. It's now a literal space character with `xml:space="preserve"` on the parent element so it can't be trimmed away.

**v1.0.1.0**
- Fixed a bug where ESPN's edge network (Akamai) would return a `403 Access Denied` HTML page instead of JSON for requests that didn't look like a real browser, which showed up on the button as an `Err` state. Requests now send a realistic browser header set (User-Agent, Accept, Accept-Encoding) and transparently decompress the gzip/brotli response that comes back as a result.

**v1.0.0.0**
- Initial release — live scores, possession indicator, red zone highlighting, pre-game/final states, score-change flash, end-of-game fireworks, Gamecast shortcut, and all 32 NFL teams across 8 divisions

---

## Requirements

- [Elgato Stream Deck](https://www.elgato.com/stream-deck) hardware
- [Stream Deck software](https://www.elgato.com/downloads) version 6.9 or later (Mac or Windows)
- No account or API key required — the plugin uses ESPN's free public scoreboard API

---

## Installation

1. Download the latest **`Live NFL Scores.streamDeckPlugin`** from the [Releases](../../releases) page
2. Double-click the file — Stream Deck will install it automatically
3. The plugin will appear in the Stream Deck action picker under **Live NFL Scores**

---

## Setup

1. Drag the **Live NFL Scores** action onto any button
2. In the settings panel on the right, find your team by typing into the search box or by picking a division and then a team from the dropdowns
3. That's it — the button will load your team's current or upcoming game within a few seconds and refresh every 30 seconds from there

---

## What the Button Shows

**Before the game:**
```
DEN @ KC
Sun 1:00 PM
```

**Live game:**
```
DEN    7
KC    17
Q3 8:42
```
The team with the ball is colored brown (orange in the red zone); the clock turns red during the two-minute warning.

**Final score:**
```
DEN    7
KC    24
 Final
```

**Bye week:**
```
 KC
BYE WEEK
```
Pressing the button in this state opens that team's schedule on ESPN.

**No game found at all** (e.g. deep off-season):
```
 KC
No Game
```
Same button behavior as a bye — pressing it opens the team's schedule on ESPN.

---

## How It Works

The plugin polls [ESPN's public NFL scoreboard API](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) once every 30 seconds per button. No API key or account is required. The plugin is fully self-contained — it uses only Node.js built-in modules and requires no external dependencies.

Because NFL teams play roughly once per week rather than daily, the plugin queries a rolling 21-day window (ten days back, ten days ahead) and picks the most relevant game for your team: a game in progress takes priority over an upcoming game, which takes priority over last week's final — so the button holds onto a result until the next game appears on the schedule.

---

## Uninstalling

Open Stream Deck → Preferences → Plugins, select **Live NFL Scores**, and click the **−** button.

---

## Contributing

Bug reports and feature requests are welcome — open an [Issue](../../issues) to get started.

---

## Disclaimer

This plugin is not affiliated with, endorsed by, or sponsored by the NFL, ESPN, or any team. All data is sourced from ESPN's public scoreboard API and is subject to ESPN's terms of use. This plugin is intended for individual, personal, non-commercial use only.

---

## Credits

Created by **T.J. Lauerman aka ThatSportsGamer**

Created with Claude Cowork by Anthropic

Data provided by [ESPN](https://www.espn.com/nfl/)
