# Rhythm Polygraph

A browser-based "lie detector" that reads the rhythm of your mouse clicks.

## How it works

1. The subject clicks the **left mouse button** on the chart at one steady tempo. Six even beats calibrate the machine.
2. Ask a question out loud and press **Space** the moment it has been asked (on a phone, tap **Question asked**).
3. The subject answers while trying to keep the same rhythm. The next 10 beats are measured.
4. The machine compares those beats with the calibrated rhythm and stamps **TRUTH** or **LIE**.

The stress index (0–100) adds up three signals:

| Signal | Max points | What it measures |
| --- | --- | --- |
| Beat-to-beat jitter | 40 | Average deviation of each beat from the calibrated beat, in standard deviations |
| Hesitation spike | 30 | The single most off-tempo beat |
| Tempo drift | 30 | How much the average tempo sped up or slowed down |

If the clicking stalls after the question, the index jumps to 88. A score of 30 or more is a **LIE**.

It is a party game: a change in rhythm shows nervousness or distraction, not proof of lying.

## Play online (`online.html`)

1. One player opens `online.html` and taps **Start a new room**. They get a 4-letter room code and see the chart.
2. The other player opens `online.html`, types the code (or opens the shared link) and gets a big button.
3. Ask a question on your call or chat and press **Space**. The player sees only **TRUTH** or **LIE**.

Rooms are synced through Firebase Realtime Database.

### Firebase setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Build → Realtime Database → Create database** (any location, start in locked mode).
3. In the database's **Rules** tab, paste the contents of `database.rules.json` and publish.
4. **Project settings → Your apps → Web app** (`</>`), register it, and copy the `firebaseConfig` values into `firebase-config.js`. Make sure `databaseURL` is included.

Until `firebase-config.js` is filled in, `online.html` shows that online play is not available. The one-device version works without it.

## Files

- `index.html`: one-device version
- `online.html`, `online.js`: online rooms
- `firebase-config.js`, `database.rules.json`, `firebase.json`: Firebase settings and security rules
- `polygraph.js`, `polygraph.css`: shared analyser, chart and styles

## Run it

Static files only, no build step and no server code. Open `index.html` in a browser, or host it online with GitHub Pages: **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`.
