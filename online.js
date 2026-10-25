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
  else if (params.has('host')) host();
  else lobby();

  // ---------- lobby ----------
  function lobby() {
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
    $('btn-create').addEventListener('click', () => { location.search = '?host'; });
    input.focus();
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
    let lean = null;     // 'truth' | 'lie' | null
    let verdictN = 0;

    const poly = RhythmPolygraph({
      clock: () => performance.now() + (offset ?? 0),
      silentReset: true,
      penTint: () => (lean === 'truth' ? 'ok' : lean === 'lie' ? 'alarm' : null),
      decide(q) {
        if (!lean) return;
        const r = q.result;
        if (!r.freeze && r.score < STEADY_LIMIT) r.lie = lean === 'lie';
        lean = null;
      },
      onVerdict(q) {
        if (roomRef && playerId) roomRef.child('verdict').set({ n: ++verdictN, lie: q.result.lie, p: playerId });
      },
    });

    const toggle = (v) => { lean = lean === v ? null : v; };
    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
      if (e.code === 'KeyT') toggle('truth');
      else if (e.code === 'KeyL') toggle('lie');
    });
    $('h-a').addEventListener('pointerdown', () => toggle('truth'));
    $('h-b').addEventListener('pointerdown', () => toggle('lie'));

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
      lean = null;
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
      roomRef.child('beats').push({ p: myId, t: performance.now() });
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      press.addEventListener(ev, () => press.classList.remove('down'));
    }
    press.addEventListener('contextmenu', (e) => e.preventDefault());
  }
})();
