# Marketplace Listing Draft — Live NFL Scores

## Name
Live NFL Scores

## Short tagline (optional, if Marketplace supports one)
Live NFL scores on every button.

## Overview

Shows live NFL scores on your Stream Deck.

Each button tracks one team — see the current score, quarter, clock, and possession at a glance.

**Setup**

1. Drag the **Live NFL Scores** action onto any button
2. In the settings panel on the right, search for your team or browse by division
3. (Optional) Turn on a custom background color and opacity so buttons for different teams are easy to tell apart
4. That's it. The button will load your team's current or upcoming game within a few seconds and refresh every 30 seconds from there — 15 seconds during the two-minute warning.

**Note:** Pressing the button opens the game in ESPN Gamecast, or your team's schedule on ESPN if there's no game, including bye weeks.

**How It Works**

The plugin polls ESPN's public NFL scoreboard API once every 30 seconds per button — 15 seconds during the two-minute warning of the 2nd or 4th quarter, so a fast-moving crunch-time sequence isn't missed between refreshes. No API key or account is required. The plugin is fully self-contained — it uses only Node.js built-in modules and requires no external dependencies. Because NFL teams play roughly once a week, the plugin always shows the most relevant game for your team: live beats upcoming beats last week's final. A final score holds steady through the following Tuesday at 3:00 AM ET instead of flipping to the next matchup as soon as it's scheduled, and BYE WEEK shows automatically on a team's off week.

**Disclaimer**

This plugin is not affiliated with, endorsed by, or sponsored by the NFL, ESPN, or any team. All data is sourced from ESPN's public scoreboard API and is subject to ESPN's terms of use. This plugin is intended for individual, personal, non-commercial use only.

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
