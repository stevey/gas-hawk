# Release Notes

## Version 1.0.4
_April 2026_

### What's New

- Location denied error state — if Gas Hawk can't see your location, the cards are replaced with a clear message and a "Try Again" button; a second denial updates the hint to point you to browser settings
- Data loading retry — if the station feed fails to load, the app retries up to two more times (with a short delay) before giving up
- Error state in status bar — data load failures now show in red with a prompt to tap the refresh button

---

## Version 1.0.3
_April 2026_

### What's New

- Tapping the logo while sound is playing now stops it; tapping again restarts — no more overlapping playback
- Author credit and Bluesky bug report link added to Settings

---

## Version 1.0.2
_April 2026_

### What's New

- Press and hold any price card to reveal navigation intent: the distance badge grows and turns green, the arrow doubles in size, turns green, and bounces — release to cancel or lift to navigate

---

## Version 1.0.1
_April 2026_

### What's New

- App icon now appears when bookmarked or added to the iOS home screen
- Rich preview (icon, name, description) when shared on Facebook and other social platforms
- Version number and data source credit added to the Settings panel

---

## Version 1.0
_April 2026_

Initial release of Gas Hawk.

### What's Included

- Real-time gas prices sourced from the Régie de l'énergie du Québec (~2,200+ stations)
- Three distance rings — Nearest (<1 km), Close (<10 km), Regional (<100 km)
- Tap any card to open turn-by-turn directions in Apple Maps or Google Maps
- Fuel type selector on the main screen: Regular, Super, Diesel
- Auto-refresh with configurable interval (30 sec, 1 min, 2 min, 5 min)
- Countdown timer showing time until next refresh
- Settings persist across sessions
- CarPlay-inspired dark UI optimized for in-car use
- Automatic fallback to local data snapshot if the live feed is unavailable
