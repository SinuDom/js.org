// Rhythm Polygraph engine: beat analysis, verdict panel and strip chart.
// RhythmPolygraph(opts) wires itself to the page's polygraph markup.
//   opts.pointerInput  count left-button presses on the page as beats (solo mode)
//   opts.clock         time source in ms; beats passed to api.beat() use the same clock
//   opts.decide(q)     may change q.result before the verdict is shown
//   opts.onVerdict(q)  called after a verdict is shown
//   opts.onQuestion(q) called when a question is marked
//   opts.penTint()     token name for the pen head colour (default 'pen')
//   opts.tempoLabels() [slow, fast] words for the CH2 scale (default SLOWER / FASTER)
window.RhythmPolygraph = function RhythmPolygraph(options) {
  'use strict';
  const opts = options || {};

  const CFG = {
    calBeats: 6,        // intervals needed before a question can be asked
    baseWindow: 12,     // intervals used for the baseline
    postBeats: 10,      // intervals measured after the question
    postMaxMs: 7000,    // stop measuring after this long
    lostMs: 2500,       // a gap this long (outside a question) restarts calibration
    maxCv: 0.3,         // baseline must be at least this steady
    threshold: 30,      // stress index at or above this = LIE
    chartMs: 10000,
  };
  RhythmPolygraph.CFG = CFG;
  RhythmPolygraph.confidenceFor = (score) => Math.round(Math.min(97, 55 + Math.abs(score - CFG.threshold) * 0.84));

  const $ = (id) => document.getElementById(id);
  const canvas = $('chart'), ctx = canvas.getContext('2d');
  const pad = $('pad');

  let clicks = [];          // ms timestamps
  let intervals = [];       // {t, iv, dev}
  let segStart = 0;         // baseline only uses intervals after this time
  let questions = [];       // {n, t, base, end, result}
  let active = null;
  let qCount = 0;
  let flashTimer = 0;

  const now = opts.clock || (() => performance.now());
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const pulse = (d) => Math.exp(-(((d - 10) / 28) ** 2)) - 0.32 * Math.exp(-(((d - 95) / 45) ** 2));

  function flash(msg) {
    $('flash').textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => ($('flash').textContent = ''), 3500);
  }

  // ---------- input ----------
  function beat(t = now()) {
    const last = clicks[clicks.length - 1];
    if (last === undefined || (!active && t - last > CFG.lostMs)) {
      segStart = t;
    } else {
      const iv = t - last;
      let ref = null;
      if (active) {
        ref = active.base.mean;
      } else {
        const from = Math.max(segStart, lastQuestionEnd());
        const prev = intervals.filter((x) => x.t > from).slice(-8).map((x) => x.iv);
        if (prev.length >= 3) ref = median(prev);
      }
      intervals.push({ t, iv, dev: ref ? (iv - ref) / ref : null });
    }
    clicks.push(t);
    const cutoff = t - 60000;
    while (clicks.length > 40 && clicks[0] < cutoff) clicks.shift();
    while (intervals.length > 40 && intervals[0].t < cutoff) intervals.shift();
    $('hint').hidden = true;
  }

  if (opts.pointerInput) {
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, textarea, select, .log-wrap')) return;
      beat();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('input, textarea')) return;
    e.preventDefault();
    if (e.repeat) return;
    askQuestion();
  });

  $('btn-q').addEventListener('click', (e) => { e.currentTarget.blur(); askQuestion(); });
  $('btn-reset').addEventListener('click', (e) => { e.currentTarget.blur(); reset(); });

  // ---------- analysis ----------
  function lastQuestionEnd() {
    const q = questions[questions.length - 1];
    return q ? (q.end ?? Infinity) : -Infinity;
  }

  function baseline(at) {
    const from = Math.max(segStart, lastQuestionEnd());
    let ivs = intervals.filter((x) => x.t > from && x.t <= at).slice(-CFG.baseWindow).map((x) => x.iv);
    if (ivs.length < CFG.calBeats) return { n: ivs.length };
    const med = median(ivs);
    ivs = ivs.filter((x) => x > med * 0.5 && x < med * 2);
    if (ivs.length < CFG.calBeats) return { n: ivs.length };
    const m = mean(ivs), s = sd(ivs);
    return { n: ivs.length, mean: m, sd: s, cv: s / m };
  }

  function machineState(t) {
    if (active) return 'listening';
    const last = clicks[clicks.length - 1];
    if (last === undefined) return 'idle';
    if (t - last > CFG.lostMs) return 'lost';
    const b = baseline(t);
    if (b.mean === undefined) return 'calibrating';
    if (b.cv > CFG.maxCv) return 'unsteady';
    return 'ready';
  }

  function askQuestion() {
    const t = now();
    const st = machineState(t);
    if (st === 'listening') return flash('Still measuring the last answer. Keep clicking.');
    if (st === 'idle' || st === 'lost') return flash('Start clicking a steady rhythm first.');
    if (st === 'calibrating') return flash(`Calibrating: ${CFG.calBeats - baseline(t).n} more even beats needed.`);
    if (st === 'unsteady') return flash('Rhythm too uneven to calibrate. Steady the beat, then ask.');
    active = { n: ++qCount, t, base: baseline(t), end: null, result: null };
    questions.push(active);
    showMeasuring(0);
    opts.onQuestion?.(active);
  }

  function postIntervals(q) {
    return intervals.filter((x) => x.t > q.t).map((x) => x.iv);
  }

  function checkActive(t) {
    if (!active) return;
    const post = postIntervals(active);
    const last = clicks[clicks.length - 1];
    const freezeMs = Math.max(2000, active.base.mean * 4);
    const frozen = t - last > freezeMs;
    if (post.length >= CFG.postBeats || frozen || t - active.t > CFG.postMaxMs) {
      finish(active, post, frozen ? t - last : 0, t);
    } else {
      showMeasuring(post.length / CFG.postBeats);
    }
  }

  function analyse(base, post, freezeGap) {
    const m = base.mean;
    const s = Math.max(base.sd, m * 0.05);
    const cvBase = Math.max(base.cv, 0.05);
    const all = freezeGap ? [...post, freezeGap] : post;
    const res = { reasons: [], freeze: !!freezeGap || post.length < 3 };

    if (all.length) {
      const z = all.map((iv) => Math.abs(iv - m) / s);
      const meanZ = mean(z), maxZ = Math.max(...z);
      const postMean = mean(post.length ? post : all);
      const shift = (postMean - m) / m;
      const cvPost = post.length >= 3 ? sd(post) / mean(post) : cvBase;
      const worst = all.reduce((a, b) => (Math.abs(b - m) > Math.abs(a - m) ? b : a), all[0]);

      const jitterPts = clamp((meanZ - 1.2) / 3) * 40;
      const spikePts = clamp((maxZ - 2.5) / 5) * 30;
      const tempoPts = clamp((Math.abs(shift) - 0.05) / 0.25) * 30;
      res.score = jitterPts + spikePts + tempoPts;
      res.shift = shift;

      res.reasons.push({
        hit: tempoPts > 6,
        text: `Tempo ${shift >= 0 ? 'slowed' : 'sped up'} by ${Math.abs(shift * 100).toFixed(1)}% (${Math.round(60000 / m)} → ${Math.round(60000 / postMean)} BPM)`,
      });
      res.reasons.push({
        hit: jitterPts > 6,
        text: `Beat-to-beat variation ${(cvPost / cvBase).toFixed(1)}× your calibrated rhythm`,
      });
      const ratio = worst / m;
      res.reasons.push({
        hit: spikePts > 6,
        text: ratio >= 1
          ? `Longest hesitation ${ratio.toFixed(2)}× a normal beat (${Math.round(worst)} ms vs ${Math.round(m)} ms)`
          : `Fastest beat came ${((1 - ratio) * 100).toFixed(0)}% early (${Math.round(worst)} ms vs ${Math.round(m)} ms)`,
      });
    } else {
      res.score = 0;
      res.shift = 0;
    }

    if (res.freeze) {
      res.score = Math.max(res.score, 88);
      res.reasons.unshift({ hit: true, text: 'Rhythm broke down: the clicking stalled after the question' });
    }
    res.score = Math.round(clamp(res.score, 0, 100));
    res.lie = res.score >= CFG.threshold;
    res.confidence = RhythmPolygraph.confidenceFor(res.score);
    return res;
  }

  function finish(q, post, freezeGap, t) {
    q.end = t;
    q.result = analyse(q.base, post, freezeGap);
    active = null;
    opts.decide?.(q);
    showResult(q);
    addLog(q);
    if (freezeGap) segStart = t; // force a fresh calibration after a freeze
    opts.onVerdict?.(q);
  }

  // ---------- verdict UI ----------
  function setStamp(cls, text) {
    const el = $('stamp');
    el.className = 'stamp ' + cls;
    el.textContent = text;
  }

  function showMeasuring(p) {
    $('v-title').textContent = `Question ${active.n} · measuring response`;
    setStamp('measuring', 'Measuring…');
    $('v-meta').hidden = true;
    $('v-meter').hidden = true;
    $('v-progress').hidden = false;
    $('v-progress-bar').style.width = `${Math.round(p * 100)}%`;
    const reasons = $('reasons');
    if (!reasons.dataset.measuring) {
      reasons.innerHTML = '<li>Keep the same tempo while the subject answers.</li>';
      reasons.dataset.measuring = '1';
    }
  }

  function showResult(q) {
    const r = q.result;
    $('v-title').textContent = `Question ${q.n} · verdict`;
    setStamp(r.lie ? 'lie pop' : 'truth pop', r.lie ? 'Lie' : 'Truth');
    $('v-progress').hidden = true;
    $('v-meta').hidden = false;
    $('v-meter').hidden = false;
    $('v-score').textContent = `${r.score} / 100`;
    $('v-conf').textContent = `Confidence ${r.confidence}%`;
    const bar = $('v-meter-bar');
    bar.style.width = `${Math.max(2, r.score)}%`;
    bar.style.background = r.lie ? 'var(--alarm)' : 'var(--ok)';
    const ul = $('reasons');
    delete ul.dataset.measuring;
    ul.innerHTML = '';
    for (const x of r.reasons) {
      const li = document.createElement('li');
      li.className = x.hit ? 'hit' : 'ok';
      li.textContent = x.text;
      ul.appendChild(li);
    }
  }

  function addLog(q) {
    const tb = $('log');
    tb.querySelectorAll('tr.example').forEach((tr) => tr.remove());
    const r = q.result;
    const tr = document.createElement('tr');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const shift = r.freeze ? 'stopped' : `${r.shift >= 0 ? '+' : '−'}${Math.abs(r.shift * 100).toFixed(1)}%`;
    [String(q.n), r.lie ? 'LIE' : 'TRUTH', String(r.score), shift, time].forEach((txt, i) => {
      const td = document.createElement('td');
      td.textContent = txt;
      if (i === 1) td.className = r.lie ? 'v-lie' : 'v-truth';
      tr.appendChild(td);
    });
    tb.prepend(tr);
  }

  function reset(note = 'Session cleared. Start clicking a steady rhythm to calibrate.') {
    clicks = []; intervals = []; questions = []; active = null; qCount = 0; segStart = 0;
    $('v-title').textContent = 'Verdict';
    setStamp('idle', 'Awaiting question');
    $('v-meta').hidden = true; $('v-meter').hidden = true; $('v-progress').hidden = true;
    $('reasons').innerHTML = '';
    const li = document.createElement('li');
    li.textContent = note;
    $('reasons').appendChild(li);
    $('log').innerHTML = '';
    $('hint').hidden = false;
    if (!opts.silentReset) flash('Session reset.');
  }

  // ---------- gauges ----------
  const STATUS = {
    idle: ['', 'Waiting for clicks'],
    lost: ['', 'Rhythm lost. Click again'],
    calibrating: ['cal', 'Calibrating'],
    unsteady: ['cal', 'Too uneven. Steady up'],
    ready: ['ready', 'Ready. Ask a question'],
    listening: ['listening', 'Measuring answer'],
  };
  let lastGauge = 0;
  function updateGauges(t) {
    if (t - lastGauge < 100) return;
    lastGauge = t;
    const st = machineState(t);
    const [lampCls, text] = STATUS[st];
    $('lamp').className = 'lamp ' + lampCls;
    $('g-status').textContent = st === 'calibrating' ? `Calibrating ${baseline(t).n}/${CFG.calBeats}` : text;
    const live = st === 'idle' || st === 'lost' ? [] : intervals.filter((x) => x.t >= segStart).slice(-6).map((x) => x.iv);
    if (live.length >= 2) {
      const m = mean(live);
      $('g-bpm').innerHTML = `${Math.round(60000 / m)}<small>BPM</small>`;
      $('g-ms').innerHTML = `${Math.round(m)}<small>ms</small>`;
      $('g-steady').innerHTML = `${Math.round(clamp(1 - (sd(live) / m) * 2) * 100)}<small>%</small>`;
    } else {
      $('g-bpm').innerHTML = '—<small>BPM</small>';
      $('g-ms').innerHTML = '—<small>ms</small>';
      $('g-steady').innerHTML = '—<small>%</small>';
    }
  }

  // ---------- strip chart ----------
  let colors = {};
  let lastColorRead = -1e9;
  function readColors(t) {
    if (t - lastColorRead < 1000) return;
    lastColorRead = t;
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['panel', 'grid', 'grid-strong', 'ink', 'muted', 'pen', 'alarm', 'ok', 'warn']) {
      colors[k] = cs.getPropertyValue('--' + k).trim();
    }
  }

  let W = 0, H = 0, dpr = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  new ResizeObserver(resize).observe(pad);
  resize();

  function draw(t) {
    readColors(t);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.panel;
    ctx.fillRect(0, 0, W, H);

    const penX = W - 24;
    const x = (tt) => penX - ((t - tt) / CFG.chartMs) * penX;
    const tAt = (px) => t - ((penX - px) / penX) * CFG.chartMs;

    // paper grid, scrolling with time
    ctx.lineWidth = 1;
    for (let s = Math.floor(tAt(0) / 200) * 200; s <= t; s += 200) {
      const gx = Math.round(x(s)) + 0.5;
      ctx.strokeStyle = s % 1000 === 0 ? colors['grid-strong'] : colors.grid;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0, i = 0; gy <= H; gy += H / 20, i++) {
      ctx.strokeStyle = i % 5 === 0 ? colors['grid-strong'] : colors.grid;
      const yy = Math.round(gy) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }

    const splitY = H * 0.55;
    const pulseMid = splitY * 0.62, pulseAmp = splitY * 0.42;
    const tempoMid = splitY + (H - splitY) * 0.5, tempoAmp = (H - splitY) * 0.38;

    // question windows
    for (const q of questions) {
      const x0 = x(q.t);
      const x1 = x(q.end ?? t);
      if (x1 < 0) continue;
      const tone = q.result ? (q.result.lie ? colors.alarm : colors.ok) : colors.warn;
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = tone;
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tone;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, 0); ctx.lineTo(Math.round(x0) + 0.5, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tone;
      ctx.font = '600 11px "JetBrains Mono", monospace';
      const tag = q.result ? `Q${q.n} ${q.result.lie ? 'LIE' : 'TRUTH'}` : `Q${q.n}`;
      ctx.fillText(tag, x0 + 5, 30);
    }

    // channel labels
    ctx.fillStyle = colors.muted;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillText('CH1  PULSE · LEFT BUTTON', 10, 15);
    ctx.fillText('CH2  TEMPO Δ vs RHYTHM', 10, splitY + 15);
    ctx.textAlign = 'right';
    const [slowLabel, fastLabel] = opts.tempoLabels?.() || ['SLOWER', 'FASTER'];
    ctx.fillText(`${slowLabel} +30%`, penX - 6, tempoMid - tempoAmp - 5);
    ctx.fillText(`${fastLabel} −30%`, penX - 6, tempoMid + tempoAmp + 13);
    ctx.textAlign = 'left';
    ctx.strokeStyle = colors.muted;
    ctx.beginPath(); ctx.moveTo(0, Math.round(splitY) + 0.5); ctx.lineTo(W, Math.round(splitY) + 0.5); ctx.stroke();

    // tempo baseline
    ctx.strokeStyle = colors['grid-strong'];
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, tempoMid); ctx.lineTo(penX, tempoMid); ctx.stroke();

    // CH1 pulse trace
    const visible = clicks.filter((c) => c > tAt(0) - 300);
    ctx.strokeStyle = colors.pen;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let px = 0; px <= penX; px += 1.5) {
      const tt = tAt(px);
      let v = Math.sin(tt / 97) * 0.015 + Math.sin(tt / 23) * 0.008;
      for (const c of visible) {
        const d = tt - c;
        if (d < -120 || d > 260) continue;
        v += pulse(d);
      }
      const yy = pulseMid - v * pulseAmp;
      px === 0 ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    ctx.stroke();

    // CH2 tempo deviation steps
    const devs = intervals.filter((iv) => iv.dev !== null && iv.t > tAt(0) - 2000);
    const yDev = (d) => tempoMid - clamp(d, -0.3, 0.3) / 0.3 * tempoAmp;
    if (devs.length) {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      devs.forEach((d, i) => {
        const xx = x(d.t), yy = yDev(d.dev);
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
        const next = devs[i + 1];
        ctx.lineTo(next ? x(next.t) : penX, yy);
      });
      ctx.stroke();
      for (const d of devs) {
        const hot = Math.abs(d.dev) > 0.15;
        ctx.fillStyle = hot ? colors.alarm : colors.ink;
        ctx.beginPath(); ctx.arc(x(d.t), yDev(d.dev), hot ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // pen carriage
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(penX + 0.5, 0); ctx.lineTo(penX + 0.5, H); ctx.stroke();
    let headV = 0;
    for (const c of visible) {
      const d = t - c;
      if (d >= -120 && d <= 260) headV += pulse(d);
    }
    ctx.fillStyle = colors[opts.penTint?.() || 'pen'];
    ctx.beginPath(); ctx.arc(penX, pulseMid - headV * pulseAmp, 4, 0, Math.PI * 2); ctx.fill();
  }

  function frame() {
    const t = now();
    checkActive(t);
    updateGauges(t);
    draw(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  $('v-meter').style.setProperty('--threshold', CFG.threshold + '%');
  $('v-threshold').textContent = `threshold ${CFG.threshold}`;

  return {
    beat,
    reset,
    flash,
    askQuestion,
    get active() { return active; },
    state: () => machineState(now()),
  };
};
