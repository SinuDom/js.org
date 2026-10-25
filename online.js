// Rhythm Polygraph online mode, synced through Firebase Realtime Database.
// online.html            lobby: join with a code or start a room
// online.html?host       the machine: creates a room and shows the chart
// online.html?room=CODE  the subject: a button and the verdict
//
// rooms/CODE = { host, created, player: {id, at}, ready, beats: {push: {p, t}}, verdict: {n, lie, p} }
(() => {
  'use strict';

  const CODE_LEN = 4;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const STEADY_LIMIT = 70;
  const HOLD_MS = 150;
  // The fraction of a beat's t says which part of the button was pressed.
  const SIDE_FRAC = { c: 0, l: 0.25, r: 0.5 };
  const sideOf = (t) => { const f = t - Math.floor(t); return f > 0.4 ? 'r' : f > 0.1 ? 'l' : 'c'; };

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const cleanCode = (v) => (v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LEN);
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
  const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(CODE_LEN)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  const load = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const save = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
  const show = (id) => { for (const v of ['lobby', 'setup-view', 'host-view', 'player-view']) $(v).hidden = v !== id; };

  function setLamp(lamp, label, cls, text) {
    lamp.className = 'lamp ' + cls;
    label.textContent = text;
  }

  const cfg = window.FIREBASE_CONFIG;
  if (typeof firebase === 'undefined' || !cfg || !cfg.databaseURL || cfg.databaseURL.includes('YOUR_')) {
    show('setup-view');
    return;
  }
  firebase.initializeApp(cfg);
  const db = firebase.database();
  const NOW = firebase.database.ServerValue.TIMESTAMP;

  const joinCode = cleanCode(params.get('room'));
  if (joinCode.length === CODE_LEN) player(joinCode);
  else if (params.has('host')) hostGate();
  else lobby();

  // The passcode for starting a room is this device's local time as HHMM (14:35 -> 1435).
  // The previous minute also counts, in case the clock ticks over while typing.
  function passcodeOk(value) {
    const typed = String(value).replace(/\D/g, '');
    const now = Date.now();
    return [0, 1].some((m) => {
      const d = new Date(now - m * 60000);
      const h = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
      const h12 = h % 12 || 12;
      return [String(h).padStart(2, '0') + mm, h + mm, String(h12).padStart(2, '0') + mm, h12 + mm].includes(typed);
    });
  }

  async function hostGate() {
    if (load('rp-host-ok') === '1') return host();
    history.replaceState(null, '', location.pathname);
    lobby(true);
  }

  // ---------- lobby ----------
  function lobby(askPass = false) {
    show('lobby');
    const input = $('join-code');
    const go = () => {
      const c = cleanCode(input.value);
      if (c.length !== CODE_LEN) {
        $('join-error').textContent = `Enter the ${CODE_LEN}-letter room code.`;
        input.focus();
        return;
      }
      location.search = '?room=' + c;
    };
    input.addEventListener('input', () => {
      const c = cleanCode(input.value);
      if (input.value !== c) input.value = c;
      $('join-error').textContent = '';
      if (c.length === CODE_LEN) go();
    });
    $('join-form').addEventListener('submit', (e) => { e.preventDefault(); go(); });
    const pass = $('create-pass');
    const openPass = () => {
      $('btn-create').hidden = true;
      $('create-box').hidden = false;
      pass.focus();
    };
    $('btn-create').addEventListener('click', openPass);
    pass.addEventListener('input', () => { $('create-error').textContent = ''; });
    $('create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!passcodeOk(pass.value)) {
        $('create-error').textContent = 'Wrong passcode.';
        pass.select();
        return;
      }
      save('rp-host-ok', '1');
      location.search = '?host';
    });
    if (askPass) openPass();
    else input.focus();
  }

  // ---------- host ----------
  async function host() {
    show('host-view');
    const status = (cls, text) => setLamp($('conn-lamp'), $('conn-status'), cls, text);

    let hostId = load('rp-host-id');
    if (!hostId) { hostId = randomId(); save('rp-host-id', hostId); }

    let roomRef = null;
    let playerId = null;
    let offset = null;   // subject's clock minus ours, from the least-delayed beat
    let verdictN = 0;
    let sides = [];      // {t, s} for the current player's presses
    let control = false; // starts off on every load
    let holdAt = null;   // when Space or the question button went down
    let heldQ = null;    // question marked by the press that is still held

    function sideLean(q) {
      const n = { l: 0, r: 0, c: 0 };
      for (const b of sides) if (b.t > q.t && b.t <= q.end) n[b.s]++;
      if (n.l > n.r && n.l > n.c) return 'lie';
      if (n.r > n.l && n.r > n.c) return 'truth';
      return null;
    }

    function setVerdict(r, lie) {
      if (r.lie === lie) return;
      const th = RhythmPolygraph.CFG.threshold;
      const jitter = (n) => Math.floor(Math.random() * n);
      r.lie = lie;
      r.score = lie ? Math.min(100, Math.max(r.score, th + 4 + jitter(18))) : Math.min(r.score, Math.max(0, th - 6 - jitter(14)));
      r.confidence = RhythmPolygraph.confidenceFor(r.score);
    }

    const poly = RhythmPolygraph({
      clock: () => performance.now() + (offset ?? 0),
      silentReset: true,
      questionButton: false,
      tempoLabels: () => (control ? ['SLOW', 'FAST'] : ['SLOWER', 'FASTER']),
      onQuestion(q) {
        q.c = control;
        if (!control) return;
        if (holdAt !== null) heldQ = q;
        else q.lean = 'truth';
      },
      decide(q) {
        const r = q.result;
        let lean;
        if (q.c) {
          lean = heldQ === q ? 'lie' : q.lean;
          if (r.freeze || r.score >= STEADY_LIMIT) lean = null;
        } else {
          lean = sideLean(q);
        }
        if (lean) setVerdict(r, lean === 'lie');
      },
      onVerdict(q) {
        if (roomRef && playerId) roomRef.child('verdict').set({ n: ++verdictN, lie: q.result.lie, p: playerId });
      },
    });

    const pressStart = () => { holdAt = performance.now(); };
    const pressEnd = () => {
      if (holdAt === null) return;
      const ms = performance.now() - holdAt;
      holdAt = null;
      if (heldQ) { heldQ.lean = ms > HOLD_MS ? 'lie' : 'truth'; heldQ = null; }
    };
    const toggleControl = () => { control = !control; };

    // Capture phase, so the press is timed before the analyser marks the question.
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
      if (e.code === 'Space') pressStart();
      else if (e.code === 'KeyC') toggleControl();
    }, true);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') pressEnd(); }, true);

    // The question button marks the question on touch, like Space, and times the hold.
    const qBtn = $('btn-q');
    qBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      qBtn.setPointerCapture?.(e.pointerId);
      pressStart();
      poly.askQuestion();
    });
    for (const ev of ['pointerup', 'pointercancel']) qBtn.addEventListener(ev, pressEnd);
    qBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); poly.askQuestion(); } });
    qBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    // Triple-tap on the chart does what C does.
    let chartTaps = [];
    $('pad').addEventListener('pointerdown', () => {
      const t = performance.now();
      chartTaps = chartTaps.filter((x) => t - x < 600);
      chartTaps.push(t);
      if (chartTaps.length >= 3) { toggleControl(); chartTaps = []; }
    });

    $('btn-copy').addEventListener('click', async (e) => {
      e.currentTarget.blur();
      const input = $('share-link');
      try {
        await navigator.clipboard.writeText(input.value);
        poly.flash('Link copied.');
      } catch {
        input.select();
        poly.flash('Press Ctrl+C (or Cmd+C) to copy the selected link.');
      }
    });

    async function claim(code) {
      const res = await db.ref('rooms/' + code).transaction((cur) => {
        if (cur === null || cur.host === hostId) return { host: hostId, created: NOW };
        return undefined;
      }, undefined, false);
      return res.committed;
    }

    let code = null;
    try {
      const saved = cleanCode(load('rp-room'));
      if (saved.length === CODE_LEN && await claim(saved)) code = saved;
      for (let i = 0; !code && i < 25; i++) {
        const c = makeCode();
        if (await claim(c)) code = c;
      }
    } catch {
      status('', 'Could not reach the database. Reload to try again.');
      return;
    }
    if (!code) {
      status('', 'Could not open a room. Reload to try again.');
      return;
    }
    save('rp-room', code);
    roomRef = db.ref('rooms/' + code);
    roomRef.onDisconnect().remove();

    const page = new URL('online.html', location.href);
    $('room-code').textContent = code;
    $('join-where').textContent = page.host + page.pathname;
    page.search = '?room=' + code;
    $('share-link').value = page.href;
    $('btn-copy').disabled = false;
    status('cal', 'Waiting for the other player to join');

    roomRef.child('player').on('value', (snap) => {
      const p = snap.val();
      const id = (p && p.id) || null;
      if (id === playerId) return;
      playerId = id;
      offset = null;
      sides = [];
      roomRef.child('beats').remove();
      roomRef.child('verdict').remove();
      if (playerId) {
        roomRef.child('ready').set(playerId);
        poly.reset('The other player joined. Waiting for their first button presses.');
        status('ready', 'Player connected');
      } else {
        roomRef.child('ready').remove();
        poly.reset('The other player left. They can rejoin with the same code.');
        status('cal', 'Waiting for the other player to join');
      }
    });

    roomRef.child('beats').on('child_added', (snap) => {
      const b = snap.val();
      if (!b || b.p !== playerId || !Number.isFinite(b.t)) return;
      const o = b.t - performance.now();
      if (offset === null || o > offset) offset = o;
      sides.push({ t: b.t, s: sideOf(b.t) });
      if (sides.length > 80) sides.shift();
      poly.beat(b.t);
    });

    // After a network drop the server has already removed the room; put it back.
    let wasOnline = true;
    db.ref('.info/connected').on('value', (snap) => {
      if (!snap.val()) { wasOnline = false; return; }
      if (wasOnline) return;
      wasOnline = true;
      roomRef.update({ host: hostId, created: NOW });
      roomRef.onDisconnect().remove();
    });
  }

  // ---------- player ----------
  async function player(code) {
    show('player-view');
    document.title = 'Rhythm Polygraph';
    $('p-room').textContent = 'Room ' + code;
    const status = (cls, text) => setLamp($('p-lamp'), $('p-status'), cls, text);
    const press = $('press');
    const stamp = $('p-stamp');
    const roomRef = db.ref('rooms/' + code);
    const myId = randomId();
    let lastN = null;
    let verdictTimer = 0;
    let closed = false;

    $('p-retry').addEventListener('click', () => { location.search = '?room=' + code; });

    function fail(text) {
      closed = true;
      press.disabled = true;
      status('', text);
      $('p-retry').hidden = false;
      for (const k of ['host', 'player', 'ready', 'verdict']) roomRef.child(k).off();
    }

    status('cal', `Joining room ${code}…`);
    try {
      const hostSnap = await roomRef.child('host').once('value');
      if (!hostSnap.exists()) return fail(`There is no room ${code}. Check the code and try again.`);
      const res = await roomRef.child('player').transaction((cur) => {
        if (cur === null || cur.id === myId) return { id: myId, at: NOW };
        return undefined;
      }, undefined, false);
      if (!res.committed) return fail(`Room ${code} already has a player.`);
    } catch {
      return fail('Could not reach the room. Check your connection and try again.');
    }
    roomRef.child('player').onDisconnect().remove();

    roomRef.child('host').on('value', (snap) => {
      if (!snap.exists() && !closed) fail('The room closed.');
    });
    roomRef.child('player').on('value', (snap) => {
      const p = snap.val();
      if (!closed && p && p.id !== myId) fail(`Room ${code} already has a player.`);
    });
    roomRef.child('ready').on('value', (snap) => {
      if (closed) return;
      const ok = snap.val() === myId;
      press.disabled = !ok;
      status(ok ? 'ready' : 'cal', ok ? 'Connected. Start pressing' : `Joining room ${code}…`);
    });
    roomRef.child('verdict').on('value', (snap) => {
      const v = snap.val();
      if (!v || v.p !== myId) return;
      if (lastN === null || v.n > lastN) {
        lastN = v.n;
        showVerdict(!!v.lie);
      }
    });

    function showVerdict(lie) {
      stamp.hidden = false;
      stamp.className = 'stamp ' + (lie ? 'lie' : 'truth');
      stamp.textContent = lie ? 'Lie' : 'Truth';
      void stamp.offsetWidth;
      stamp.classList.add('pop');
      clearTimeout(verdictTimer);
      verdictTimer = setTimeout(() => { stamp.hidden = true; }, 6000);
    }

    press.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || press.disabled) return;
      e.preventDefault();
      press.classList.add('down');
      const rect = press.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const side = x < 0.4 ? 'l' : x > 0.6 ? 'r' : 'c';
      roomRef.child('beats').push({ p: myId, t: Math.floor(performance.now()) + SIDE_FRAC[side] });
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      press.addEventListener(ev, () => press.classList.remove('down'));
    }
    press.addEventListener('contextmenu', (e) => e.preventDefault());
  }
})();
