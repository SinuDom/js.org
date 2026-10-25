# Rhythm Polygraph

A two-player online "lie detector" that reads the rhythm of your button presses.

## How it works

1. One player opens the site and taps **Start a new room**. They get a 4-letter room code and see the chart.
2. The other player opens the site, types the code (or opens the shared link) and gets a big button. They press it in one steady rhythm; six even beats calibrate the machine.
3. Ask a question on your call or chat and press **Space** (or tap **Question asked**) the moment it has been asked.
4. The player answers while trying to keep the same rhythm. The next 10 beats are measured and both screens show **TRUTH** or **LIE**.

The stress index (0–100) adds up three signals:

| Signal | Max points | What it measures |
| --- | --- | --- |
| Beat-to-beat jitter | 40 | Average deviation of each beat from the calibrated beat, in standard deviations |
| Hesitation spike | 30 | The single most off-tempo beat |
| Tempo drift | 30 | How much the average tempo sped up or slowed down |

If the clicking stalls after the question, the index jumps to 88. A score of 30 or more is a **LIE**.

It is a party game: a change in rhythm shows nervousness or distraction, not proof of lying.

## Online rooms

Rooms are synced through Firebase Realtime Database. `online.html` forwards to the site's main page, so older links keep working.

### Firebase setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Build → Realtime Database → Create database** (any location, start in locked mode).
3. In the database's **Rules** tab, paste the contents of `database.rules.json` and publish.
4. **Project settings → Your apps → Web app** (`</>`), register it, and copy the `firebaseConfig` values into `firebase-config.js`. Make sure `databaseURL` is included.

Until `firebase-config.js` is filled in, the site shows that online play is not available.

## Files

- `index.html`, `online.js`: the lobby, the control screen and the player's button
- `online.html`: forwards old links to `index.html`
- `firebase-config.js`, `database.rules.json`, `firebase.json`: Firebase settings and security rules
- `polygraph.js`, `polygraph.css`: shared analyser, chart and styles

## Run it

Static files only, no build step and no server code. Host the folder on any static host (it runs on Netlify).
