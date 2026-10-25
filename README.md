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

1. Open `online.html`. It creates a room and shows a link to send to the other player.
2. The other player opens the link. They see only a big button and, after each question, **TRUTH** or **LIE**. No chart, no numbers.
3. You see their rhythm live on the chart. Ask a question on your call or chat and press **Space**.
4. Secret override: press **T** (or the Force truth button) to force TRUTH, **L** to force LIE, and the same key again to cancel. It applies to the next verdict. The other player never sees it.
5. If their rhythm is way off (stress index 70 or more, or they stop pressing), your override is ignored and the machine's own verdict is used.

Button presses go straight between the two browsers over WebRTC. The free [PeerJS](https://peerjs.com) server only introduces them, so there is nothing to host besides the static files.

## Files

- `index.html`: one-device version
- `online.html`, `online.js`: online room version
- `polygraph.js`, `polygraph.css`: shared analyser, chart and styles

## Run it

Static files only, no build step and no server code. Open `index.html` in a browser, or host it online with GitHub Pages: **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`.
