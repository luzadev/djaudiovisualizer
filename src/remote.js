// DJV Remote — runs in the phone's browser. Connects back to the Mac with the
// key from the QR code, sends commands and redraws from the state pushed by
// the panel. Reconnects on its own when the Wi-Fi drops for a moment.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const key = new URLSearchParams(location.search).get('k') || '';
  let ws = null, retry = 600, st = null;

  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };

  function cmd(c, extra) {
    buzz();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ cmd: c }, extra || {})));
  }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?k=' + encodeURIComponent(key));
    ws.onopen = () => { retry = 600; $('#conn').classList.add('on'); $('#offline').hidden = true; };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'state') render(m.state);
    };
    ws.onclose = () => {
      $('#conn').classList.remove('on');
      $('#offline').hidden = false;
      setTimeout(connect, retry);
      retry = Math.min(5000, retry * 1.6);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  // static buttons
  document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => cmd(b.dataset.cmd)));
  $('#btn-blackout').addEventListener('click', () => cmd('blackout', { on: !(st && st.blackout) }));
  $('#btn-freeze').addEventListener('click', () => cmd('freeze', { on: !(st && st.freeze) }));
  $('#btn-map').addEventListener('click', () => cmd('mapOn', { on: !(st && st.map.on) }));
  $('#btn-scene-stop').addEventListener('click', () => cmd(st && st.sceneHalted ? 'sceneResume' : 'sceneStop'));
  $('#btn-allzones').addEventListener('click', () => cmd('mapShow', { ids: null }));
  $('#fam').addEventListener('change', (e) => { if (e.target.value !== '') cmd('fxFamily', { fam: parseInt(e.target.value, 10) }); });

  // lists are rebuilt only when their content changes (keeps taps reliable)
  const sig = {};
  function changed(k, v) { const j = JSON.stringify(v); if (sig[k] === j) return false; sig[k] = j; return true; }

  function render(s) {
    st = s;
    // now playing
    const t = s.track;
    $('#np-name').textContent = t ? t.name : 'Nessun brano';
    $('#np-prog').style.width = t && t.dur > 0 ? Math.min(100, t.cur / t.dur * 100) + '%' : '0%';
    $('#np-cur').textContent = fmt(t ? t.cur : 0);
    $('#np-rem').textContent = '-' + fmt(t && t.dur ? t.dur - t.cur : 0);
    $('#btn-play').textContent = t && t.playing ? '⏸' : '▶';
    $('#bpm').textContent = s.meters.bpm ? s.meters.bpm + ' BPM' : '— BPM';
    $('#m-b').style.width = Math.min(100, s.meters.bass * 100) + '%';
    $('#m-m').style.width = Math.min(100, s.meters.mid * 100) + '%';
    $('#m-h').style.width = Math.min(100, s.meters.treble * 100) + '%';

    // scene of the current track
    const sc = s.scene || [];
    $('#scene-card').hidden = !sc.length;
    if (changed('scene', sc.map(c => [c.i, c.type, c.time, c.label]))) {
      const ICO = { effect: '🌀', text: '🔤', image: '🖼', video: '🎞', map: '🗺' };
      $('#scene').innerHTML = sc.map(c => '<div class="cue-wrap"><button class="cue" data-i="' + c.i + '">' +
        '<span class="ico">' + (ICO[c.type] || '•') + '</span>' +
        '<span class="at">' + fmt(c.time) + '</span>' +
        '<span class="lbl">' + esc(c.label) + '</span></button>' +
        '<button class="cue-stop" data-i="' + c.i + '" hidden aria-label="Ferma">■</button></div>').join('');
      $('#scene').querySelectorAll('.cue').forEach(b => b.addEventListener('click', () => cmd('cue', { i: +b.dataset.i })));
      $('#scene').querySelectorAll('.cue-stop').forEach(b => b.addEventListener('click', () => cmd('cueStop', { i: +b.dataset.i })));
    }
    const liveSet = new Set(sc.filter(c => c.live).map(c => c.i));
    $('#scene').querySelectorAll('.cue').forEach(b => b.classList.toggle('live', liveSet.has(+b.dataset.i)));
    $('#scene').querySelectorAll('.cue-stop').forEach(b => { b.hidden = !liveSet.has(+b.dataset.i); });
    $('#scene-card').classList.toggle('halted', !!s.sceneHalted);
    $('#btn-scene-stop').classList.toggle('halted', !!s.sceneHalted);
    $('#btn-scene-stop').textContent = s.sceneHalted ? '▶ RIPRENDI' : '■ FERMA SCENA';
    $('#scene-hint').textContent = s.sceneHalted ? 'scena ferma: nessun elemento parte finché non riprendi'
      : 'tocca un elemento per lanciarlo ora · ■ per fermarlo';

    // effects
    $('#fx-name').textContent = s.effect || '—';
    $('#btn-autovj').classList.toggle('on', !!s.autoVj);
    if (changed('fams', s.families)) {
      $('#fam').innerHTML = '<option value="">Famiglia…</option>' +
        s.families.map(f => '<option value="' + f.i + '">' + esc(f.name) + '</option>').join('');
    }
    $('#fam').value = s.families.some(f => f.i === s.family) ? String(s.family) : '';
    if (changed('seq', s.seq)) {
      $('#seq-cap').hidden = !s.seq.length;
      $('#seq').innerHTML = s.seq.map((n, i) => '<button data-i="' + i + '">' + esc(n) + '</button>').join('');
      $('#seq').querySelectorAll('button').forEach(b => b.addEventListener('click', () => cmd('fxSeq', { i: +b.dataset.i })));
    }
    $('#seq').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s.seqIndex));

    // pads
    const anyPad = s.pads.some(Boolean);
    $('#pads-card').hidden = !anyPad;
    if (changed('pads', s.pads)) {
      $('#pads').innerHTML = s.pads.map((n, i) => '<button data-i="' + i + '" class="' + (n ? '' : 'empty') + '">' +
        (n ? esc(n.replace(/\.[^.]+$/, '')) : i + 1) + '</button>').join('');
      $('#pads').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (!b.classList.contains('empty')) cmd('pad', { i: +b.dataset.i }); }));
    }
    $('#pads').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === s.activePad));

    // mapping
    $('#btn-map').classList.toggle('on', s.map.on);
    $('#btn-map').textContent = s.map.on ? '🗺 MAPPATURA ON' : '🗺 MAPPATURA OFF';
    $('#btn-allzones').classList.toggle('on', s.map.on && !s.map.show);
    if (changed('zones', s.map.zones)) {
      $('#zones').innerHTML = s.map.zones.map(z => '<button data-id="' + z.id + '">' + esc(z.name) + '</button>').join('') ||
        '<span style="color:var(--dim);font-size:14px">Nessuna zona: creale nel tab Mappatura del Mac</span>';
      $('#zones').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        // tap = show/hide that zone; starting from "all", a tap means "only this one"
        const id = +b.dataset.id, all = st.map.zones.map(z => z.id);
        const cur = st.map.show || all;
        let next = cur.includes(id) ? cur.filter(x => x !== id) : cur.concat(id);
        if (!st.map.show) next = [id];
        if (next.length === all.length) next = null;
        if (!st.map.on) cmd('mapOn', { on: true });
        cmd('mapShow', { ids: next });
      }));
    }
    $('#zones').querySelectorAll('button').forEach(b => {
      const id = +b.dataset.id;
      b.classList.toggle('on', s.map.on && (!s.map.show || s.map.show.includes(id)));
    });

    // playlist
    if (changed('tracks', [s.tracks, s.sceneCounts])) {
      $('#tracks').innerHTML = s.tracks.map((n, i) => '<li data-i="' + i + '">' + (i + 1) + '. ' + esc(n) +
        ((s.sceneCounts || [])[i] ? '<span class="badge">🎬 ' + s.sceneCounts[i] + '</span>' : '') + '</li>').join('') ||
        '<li style="opacity:.5">Playlist vuota</li>';
      $('#tracks').querySelectorAll('li[data-i]').forEach(li => li.addEventListener('click', () => cmd('track', { i: +li.dataset.i })));
    }
    $('#tracks').querySelectorAll('li[data-i]').forEach(li => li.classList.toggle('cur', t && +li.dataset.i === t.i));

    // panic
    $('#btn-blackout').classList.toggle('on', !!s.blackout);
    $('#btn-freeze').classList.toggle('on', !!s.freeze);
  }

  connect();
})();
