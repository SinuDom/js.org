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

If the clicking stalls after the question, the index jumps to 88. A score of 85 or more is a **LIE**.

It is a party game: a change in rhythm shows nervousness or distraction, not proof of lying.

## Run it

It is a single static file with no build step and no server code. Open `index.html` in a browser, or host it online with GitHub Pages: **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`.
