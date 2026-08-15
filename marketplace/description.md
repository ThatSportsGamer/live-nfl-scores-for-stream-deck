# Marketplace Listing Draft — Live NFL Scores

## Name
Live NFL Scores

## Short tagline (optional, if Marketplace supports one)
Live NFL scores on every button.

## Description (≈1,230 characters — under the 1,500 limit)

Track live NFL scores directly on your Stream Deck. Each button follows one team and refreshes automatically every 30 seconds — 15 seconds during the two-minute warning, so you don't miss a crunch-time score — with no browser tab, no app switching, and no missed touchdowns.

See the score, quarter, and game clock at a glance, with a possession indicator and red-zone highlighting for extra context during close games. Buttons flash in your team's colors when they score, and a short fireworks animation plays when they win. Before kickoff, see the matchup and scheduled time; after the game, catch the final score with OT labeling, and BYE WEEK shows automatically on a team's off week.

Tracking more than one team? Give each button its own background color and opacity right from the settings panel, so your Cowboys and Eagles buttons are never a guessing game.

Search by team or city name, or browse by division — all 32 NFL teams across all 8 divisions are supported (AFC East, North, South, West and NFC East, North, South, West).

Press any button to jump straight to ESPN Gamecast for that game, or to your team's schedule if nothing's on tap. No account or API key required — scores come from ESPN's public scoreboard API.

## Tags / keywords to include
NFL, football, football scores, live scores, sports, ESPN, scoreboard, AFC, NFC, gameday

## Release notes for this submission (v1.0.10.0)
- Custom key background color and opacity, set per button in the settings panel — makes it easy to tell teams apart across multiple buttons
- Adaptive refresh: polls every 15 seconds during the two-minute warning instead of 30, so late-game scoring plays aren't missed
- BYE WEEK detection for teams with no game that week
- Final score now holds steady through the following Tuesday at 3:00 AM ET instead of flipping to the next matchup as soon as it's scheduled
- Fixed possession indicator briefly flashing blank around scoring plays
- Fixed an ESPN edge-network issue that could show an `Err` state
- Centered, correctly-spaced live score lines on real hardware
- Branded plugin, action, and category icons
