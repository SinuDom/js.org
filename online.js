// Rhythm Polygraph online mode.
// The host opens online.html, gets a room link and sees the chart. The player opens
// online.html?room=CODE and sees only a button and the final TRUTH or LIE.
// Browsers talk directly over WebRTC; PeerJS's public server only introduces them.
(() => {
  'use strict';

  const PREFIX = 'rhythm-polygraph-';
  const WAY_OFF = 70;          // stress index at or above this ignores the host's override
  const PING_MS = 2000;
  const DROP_MS = 8000;        // no message for this long = player gone
  const CONNECT_TIMEOUT_MS = 15000;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const $ = (id) => document.getElementById(id);
  const code = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function setLamp(lamp, label, cls, text) {
    lamp.className = 'lamp ' + cls;
    label.textContent = text;
  }

  function makeCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  }

  if (typeof Peer === 'undefined') {
    const view = code ? $('player-view') : $('host-view');
    view.hidden = false;
    view.prepend(Object.assign(document.createElement('p'), {
      className: 'flash',
      textContent: 'The connection library did not load. Check your internet connection and reload the page.',
    }));
    return;
  }

  if (code) player(code);
  else host();

  // ---------- host ----------
  function host() {
    $('host-view').hidden = false;
    $('way-off').textContent = WAY_OFF;
    const status = (cls, text) => setLamp($('conn-lamp'), $('conn-status'), cls, text);

    let peer = null;
    let conn = null;
    let lastSeen = 0;
    let offset = null;   // player's clock minus ours, from the least-delayed beat
    let rig = null;      // 'truth' | 'lie' | null

    const poly = RhythmPolygraph({
      clock: () => performance.now() + (offset ?? 0),
      silentReset: true,
      decide(q) {
        if (!rig) return;
        const r = q.result;
        q.rig = { wanted: rig, machineLie: r.lie };
        if (r.freeze || r.score >= WAY_OFF) q.rig.ignored = true;
        else r.lie = rig === 'lie';
        setRig(null);
      },
      onVerdict(q) {
        send({ type: 'verdict', lie: q.result.lie });
        if (!q.rig) return;
        const li = document.createElement('li');
        li.className = 'rigged';
        const wanted = q.rig.wanted.toUpperCase();
        li.textContent = q.rig.ignored
          ? `Your ${wanted} override was ignored: their rhythm was way off (stress ${q.result.score}).`
          : `Forced to ${wanted} by you. The machine said ${q.rig.machineLie ? 'LIE' : 'TRUTH'}.`;
        $('reasons').prepend(li);
      },
    });

    function setRig(v) {
      rig = v;
      const el = $('rig-val');
      el.textContent = v ? v : 'off';
      el.className = v || '';
    }
    const toggleRig = (v) => setRig(rig === v ? null : v);

    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea')) return;
      if (e.code === 'KeyT') toggleRig('truth');
      else if (e.code === 'KeyL') toggleRig('lie');
    });
    $('btn-truth').addEventListener('click', (e) => { e.currentTarget.blur(); toggleRig('truth'); });
    $('btn-lie').addEventListener('click', (e) => { e.currentTarget.blur(); toggleRig('lie'); });

    $('btn-copy').addEventListener('click', async (e) => {
      e.currentTarget.blur();
      const input = $('share-link');
      try {
        await navigator.clipboard.writeText(input.value);
        poly.flash('Link copied. Send it to the other player.');
      } catch {
        input.select();
        poly.flash('Press Ctrl+C (or Cmd+C) to copy the selected link.');
      }
    });

    function send(msg) {
      if (conn && conn.open) conn.send(msg);
    }

    function openRoom(roomCode) {
      const p = new Peer(PREFIX + roomCode, { debug: 0 });
      peer = p;
      p.on('open', () => {
        try { sessionStorage.setItem('rp-room', roomCode); } catch {}
        const url = new URL(location.href);
        url.search = '?room=' + roomCode;
        url.hash = '';
        $('room-code').textContent = roomCode;
        $('share-link').value = url.href;
        $('btn-copy').disabled = false;
        if (!conn) status('cal', 'Waiting for the other player to join');
      });
      p.on('connection', accept);
      p.on('disconnected', () => {
        // Open player connections survive this; reconnecting keeps the room joinable.
        setTimeout(() => { if (!p.destroyed && p.disconnected) p.reconnect(); }, 1500);
      });
      p.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          p.destroy();
          openRoom(makeCode());
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          status('', 'Connection server unreachable. Retrying…');
        } else if (err.type !== 'peer-unavailable') {
          status('', `Connection problem (${err.type}). Reload to open a new room.`);
        }
      });
    }

    function accept(c) {
      c.on('open', () => {
        if (conn && conn.open) {
          c.send({ type: 'full' });
          setTimeout(() => c.close(), 3000);
          return;
        }
        conn = c;
        offset = null;
        lastSeen = performance.now();
        setRig(null);
        poly.reset('The other player joined. Waiting for their first button presses.');
        status('ready', 'Player connected');
        c.send({ type: 'welcome' });
      });
      c.on('data', (msg) => {
        if (c !== conn || !msg) return;
        lastSeen = performance.now();
        if (msg.type === 'beat' && Number.isFinite(msg.t)) {
          const o = msg.t - performance.now();
          if (offset === null || o > offset) offset = o;
          poly.beat(msg.t);
        }
      });
      c.on('close', () => { if (c === conn) dropped(); });
      c.on('error', () => { if (c === conn) dropped(); });
    }

    function dropped() {
      if (!conn) return;
      const c = conn;
      conn = null;
      try { c.close(); } catch {}
      setRig(null);
      poly.reset('The other player left. They can rejoin with the same link.');
      status('cal', 'Player left. Waiting for someone to join');
    }

    setInterval(() => {
      if (conn && performance.now() - lastSeen > DROP_MS) dropped();
    }, 1000);

    let saved = null;
    try { saved = sessionStorage.getItem('rp-room'); } catch {}
    openRoom(saved && /^[A-Z0-9]{6}$/.test(saved) ? saved : makeCode());
    window.addEventListener('pagehide', () => { if (peer) peer.destroy(); });
  }

  // ---------- player ----------
  function player(roomCode) {
    $('player-view').hidden = false;
    document.title = 'Rhythm Polygraph';
    const status = (cls, text) => setLamp($('p-lamp'), $('p-status'), cls, text);
    const press = $('press');
    const stamp = $('p-stamp');
    let peer = null;
    let conn = null;
    let pingTimer = 0;
    let connectTimer = 0;
    let verdictTimer = 0;

    function fail(text) {
      clearInterval(pingTimer);
      clearTimeout(connectTimer);
      press.disabled = true;
      status('', text);
      $('p-retry').hidden = false;
      if (peer && !peer.destroyed) peer.destroy();
      conn = null;
    }

    function connect() {
      $('p-retry').hidden = true;
      status('cal', `Connecting to room ${roomCode}…`);
      peer = new Peer({ debug: 0 });
      connectTimer = setTimeout(() => fail('Could not reach the room. Check the link and try again.'), CONNECT_TIMEOUT_MS);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + roomCode, { reliable: true });
        let welcomed = false;
        conn = c;
        c.on('data', (msg) => {
          if (!msg) return;
          if (msg.type === 'welcome') {
            welcomed = true;
            clearTimeout(connectTimer);
            press.disabled = false;
            status('ready', 'Connected. Start pressing');
            clearInterval(pingTimer);
            pingTimer = setInterval(() => { if (c.open) c.send({ type: 'ping' }); }, PING_MS);
          } else if (msg.type === 'full') {
            fail('This room already has a player.');
          } else if (msg.type === 'verdict') {
            showVerdict(!!msg.lie);
          }
        });
        c.on('close', () => {
          if (conn !== c) return;
          fail(welcomed ? 'The room closed. Ask for a new link, or try again.' : 'Could not join: this room already has a player, or it has closed.');
        });
        c.on('error', () => { if (conn === c) fail('Lost the connection to the room.'); });
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') fail('This room does not exist or has closed. Ask for a new link.');
        else fail(`Connection problem (${err.type}).`);
      });
    }

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
      if (conn && conn.open) conn.send({ type: 'beat', t: performance.now() });
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      press.addEventListener(ev, () => press.classList.remove('down'));
    }
    press.addEventListener('contextmenu', (e) => e.preventDefault());

    $('p-retry').addEventListener('click', () => connect());
    window.addEventListener('pagehide', () => { if (peer) peer.destroy(); });
    connect();
  }
})();
