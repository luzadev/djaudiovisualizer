// CONTROL window: builds the UI and sends commands to the output window.
// It also receives reports (meters, fps, device list, play state).

const $ = (s) => document.querySelector(s);
const send = (msg) => djv.send(msg);
const filePath = (f) => djv.pathForFile(f);

// ---------------------------------------------------------------- effects
const EFFECTS = window.EFFECTS;
let currentEffect = EFFECTS.list[0];

function applyEffect(effect) {
  currentEffect = effect;
  send({ type: 'effect', effect });
  $('#scene-name').textContent = effect.name;
  renderLibrary();
}

// --- Library browser (hundreds of presets, filterable) ---
const familySel = $('#effect-family');
EFFECTS.families.forEach((name, i) => {
  const o = document.createElement('option'); o.value = i; o.textContent = name;
  familySel.appendChild(o);
});

const LIB_CAP = 300; // max items rendered at once
function filteredEffects() {
  const fam = parseInt($('#effect-family').value, 10);
  const q = $('#effect-search').value.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < EFFECTS.list.length; i++) {
    const e = EFFECTS.list[i];
    if (fam >= 0 && e.family !== fam) continue;
    if (q && e.name.toLowerCase().indexOf(q) < 0) continue;
    out.push(e);
    if (out.length >= LIB_CAP) break;
  }
  return out;
}
function renderLibrary() {
  const list = $('#effect-list');
  const items = filteredEffects();
  list.innerHTML = '';
  items.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'fx' + (e === currentEffect ? ' active' : '');
    row.innerHTML = '<span class="fx-name">' + e.name + '</span>' +
      '<button class="fx-add" title="Aggiungi alla sequenza">➕</button>';
    row.querySelector('.fx-name').addEventListener('click', () => applyEffect(e));
    row.querySelector('.fx-add').addEventListener('click', () => addToSequence(e));
    list.appendChild(row);
  });
  $('#effects-count').textContent = EFFECTS.count + ' preset' +
    (items.length >= LIB_CAP ? ' · mostro i primi ' + LIB_CAP : '');
}
$('#effect-family').addEventListener('change', () => {
  renderLibrary();
  // Switching to a specific family applies its first preset, so the
  // visualization changes category immediately (e.g. away from an SVG).
  const fam = parseInt($('#effect-family').value, 10);
  if (fam >= 0) {
    const first = filteredEffects()[0];
    if (first) applyEffect(first);
  }
});
$('#effect-search').addEventListener('input', renderLibrary);

// --- SVG / image as a custom effect source ---
function applySvgFamily() {
  const fam = EFFECTS.families.indexOf('SVG/Immagine');
  const eff = EFFECTS.list.find(e => e.family === fam);
  if (eff) applyEffect(eff);
}
function useSvg(dataUrl) {
  send({ type: 'svg', dataUrl });
  applySvgFamily();
}

const svgSelect = $('#svg-select');
let builtinSvgs = [];
(async () => {
  builtinSvgs = (djv.listBuiltinSvgs ? await djv.listBuiltinSvgs() : []) || [];
  builtinSvgs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((s) => {
      const o = document.createElement('option');
      o.value = builtinSvgs.indexOf(s);
      o.textContent = s.name;
      svgSelect.appendChild(o);
    });
})();
svgSelect.addEventListener('change', (e) => {
  const i = parseInt(e.target.value, 10);
  if (i >= 0 && builtinSvgs[i]) useSvg(builtinSvgs[i].dataUrl);
});

$('#btn-svg-load').addEventListener('click', () => $('#svg-input').click());
$('#svg-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => useSvg(r.result); // data: URL
  r.readAsDataURL(f);
  e.target.value = '';
});

// --- Effect sequence (playlist of effects with auto-cycle) ---
let sequence = [];          // { effect, key }
let seqIndex = -1;
let seqCapturing = -1;
let seqDragFrom = -1;
let autoCycle = false, onBeat = false, shuffle = false, seqMs = 8000;
let autoTimer = null, lastBeatAdvance = 0;

function addToSequence(effect) { sequence.push({ effect, key: null }); renderSequence(); }
function applySeqIndex(i) {
  if (i < 0 || i >= sequence.length) return;
  seqIndex = i;
  applyEffect(sequence[i].effect);
  renderSequence();
}
function nextInSequence() {
  if (!sequence.length) return;
  const n = shuffle ? Math.floor(Math.random() * sequence.length) : (seqIndex + 1) % sequence.length;
  applySeqIndex(n);
}
function removeSeq(i) {
  sequence.splice(i, 1);
  if (i === seqIndex) seqIndex = -1; else if (i < seqIndex) seqIndex--;
  renderSequence();
}
function moveSeq(from, to) {
  if (to < 0 || to >= sequence.length) return;
  const [it] = sequence.splice(from, 1);
  sequence.splice(to, 0, it);
  if (seqIndex === from) seqIndex = to;
  renderSequence();
}
function renderSequence() {
  const ol = $('#effect-seq');
  ol.innerHTML = '';
  sequence.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'track' + (i === seqIndex ? ' playing' : '');
    li.draggable = true;
    li.innerHTML =
      '<span class="grip">⠿</span>' +
      '<span class="tname" title="' + s.effect.name.replace(/"/g, '&quot;') + '">' +
        (i + 1) + '. ' + s.effect.name + '</span>' +
      '<button class="key-btn" title="Tasto rapido">' +
        (seqCapturing === i ? '…' : (s.key ? s.key.toUpperCase() : '⌨')) + '</button>' +
      '<button class="play-btn" title="Applica">▶</button>' +
      '<button class="del-btn" title="Rimuovi">✕</button>';
    li.querySelector('.play-btn').addEventListener('click', () => applySeqIndex(i));
    li.querySelector('.del-btn').addEventListener('click', () => removeSeq(i));
    li.querySelector('.key-btn').addEventListener('click', () => {
      seqCapturing = seqCapturing === i ? -1 : i; renderSequence();
    });
    li.addEventListener('dragstart', () => { seqDragFrom = i; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => { seqDragFrom = -1; li.classList.remove('dragging'); });
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => { e.preventDefault(); if (seqDragFrom >= 0 && seqDragFrom !== i) moveSeq(seqDragFrom, i); });
    ol.appendChild(li);
  });
  $('#seq-count').textContent = sequence.length + ' in sequenza';
}
function restartAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (autoCycle && !onBeat) autoTimer = setInterval(nextInSequence, seqMs);
}
$('#btn-seq-add').addEventListener('click', () => addToSequence(currentEffect));
$('#btn-seq-clear').addEventListener('click', () => { sequence = []; seqIndex = -1; renderSequence(); });
$('#seq-auto').addEventListener('change', (e) => { autoCycle = e.target.checked; restartAuto(); });
$('#seq-beat').addEventListener('change', (e) => { onBeat = e.target.checked; restartAuto(); });
$('#seq-shuffle').addEventListener('change', (e) => { shuffle = e.target.checked; });
$('#seq-interval').addEventListener('input', (e) => {
  seqMs = parseFloat(e.target.value) * 1000;
  $('#seq-interval-val').textContent = parseFloat(e.target.value).toFixed(1) + 's';
  restartAuto();
});

// ---------------------------------------------------------------- audio
function togglePlayPause() {
  // If the track finished, restart it; otherwise pause/resume.
  if (ended && currentIndex >= 0) { playIndex(currentIndex); return; }
  if (segTimer) { // a visual segment (interlude/gap) is running — pause/resume it
    if (segPaused) { resumeSeg(); isPlaying = true; $('#btn-play').textContent = '⏸ Pausa'; }
    else { pauseSeg(); isPlaying = false; $('#btn-play').textContent = '▶ Play'; }
    renderPlaylist();
    return;
  }
  send({ type: 'togglePlay' });
}
$('#btn-play').addEventListener('click', togglePlayPause);

// ---------------------------------------------------------------- playlist
let playlist = [];          // { path, name, key }
let currentIndex = -1;
let repeat = false;
let isPlaying = false;       // whether the current track is playing
let ended = false;           // true when the current track reached its end
let playbackOwner = 'playlist'; // 'playlist' or 'pad' — who started playback
const durations = {};        // path -> seconds (probed from the output window)
const peaksCache = {};       // path -> Array(N) of 0..1 peak amplitudes (or 'loading')
const WAVE_BUCKETS = 400;
let playCur = 0, playDur = 0; // live progress of the currently playing track

// Lazily fetch the waveform peaks for a file, then redraw its card.
function ensurePeaks(path) {
  if (!path || peaksCache[path]) return;
  peaksCache[path] = 'loading';
  djv.peaks(path, WAVE_BUCKETS).then((p) => {
    peaksCache[path] = p && p.length ? p : null;
    renderPlaylist();
  }).catch(() => { peaksCache[path] = null; });
}

// Draw a waveform on a canvas, shading the trimmed-out parts and the playhead.
function drawWave(canvas, tr, isCur) {
  const peaks = peaksCache[tr.path];
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, mid = h / 2;
  ctx.clearRect(0, 0, w, h);
  if (!Array.isArray(peaks)) { // still loading / unavailable
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, mid - 1, w, 2);
    return;
  }
  const dur = durations[tr.path] || 0;
  const s = tr.start || 0;
  const e = tr.end > 0 ? tr.end : dur;
  const sx = dur > 0 ? (s / dur) * w : 0;
  const ex = dur > 0 ? (e / dur) * w : w;
  const N = peaks.length;
  for (let x = 0; x < w; x++) {
    const pk = peaks[Math.min(N - 1, Math.floor(x / w * N))];
    const bar = Math.max(1, pk * (h * 0.46));
    const inTrim = x >= sx && x <= ex;
    ctx.fillStyle = inTrim ? 'rgba(140,182,255,0.85)' : 'rgba(140,182,255,0.18)';
    ctx.fillRect(x, mid - bar, 1, bar * 2);
  }
  // trim handles
  if (dur > 0) {
    ctx.fillStyle = '#6ee7a0'; ctx.fillRect(sx, 0, 2, h);       // start (green)
    ctx.fillStyle = '#ff9a9a'; ctx.fillRect(ex - 2, 0, 2, h);   // end (red)
  }
  // playhead
  if (isCur && playDur > 0) {
    const px = Math.min(w, (playCur / playDur) * w);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(px, 0, 1.5, h);
  }
}

// Clamp and persist a track's start/end; push it live to the output if playing.
function commitTrim(tr, i, rerender) {
  const dur = durations[tr.path] || 0;
  tr.start = Math.max(0, tr.start || 0);
  if (dur > 0 && tr.start > dur) tr.start = dur;
  if (tr.end > 0) {
    if (dur > 0 && tr.end > dur) tr.end = dur;
    if (tr.end <= tr.start + 0.2) tr.end = Math.min(dur || tr.start + 1, tr.start + 1);
  }
  savePlaylistState();
  if (i === currentIndex) send({ type: 'setTrim', start: tr.start || 0, end: tr.end || 0 });
  if (rerender) renderPlaylist();
}

// Wire the trim inputs, the "set to current" buttons and waveform drag handles.
function wireTrim(li, canvas, tr, i) {
  const sIn = li.querySelector('.trim-start');
  const eIn = li.querySelector('.trim-end');
  sIn.addEventListener('change', () => { tr.start = parseTime(sIn.value); commitTrim(tr, i, true); });
  eIn.addEventListener('change', () => { tr.end = eIn.value.trim() ? parseTime(eIn.value) : 0; commitTrim(tr, i, true); });
  li.querySelector('.trim-here-s').addEventListener('click', () => { if (i === currentIndex) { tr.start = Math.max(0, playCur); commitTrim(tr, i, true); } });
  li.querySelector('.trim-here-e').addEventListener('click', () => { if (i === currentIndex) { tr.end = Math.max(0.5, playCur); commitTrim(tr, i, true); } });
  li.querySelector('.trim-reset').addEventListener('click', () => { tr.start = 0; tr.end = 0; commitTrim(tr, i, true); });

  let dragH = null;
  const dur = () => durations[tr.path] || (i === currentIndex ? playDur : 0) || 0;
  const timeAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return f * dur();
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!dur()) return;
    const t = timeAt(e), s = tr.start || 0, en = tr.end > 0 ? tr.end : dur();
    dragH = Math.abs(t - s) <= Math.abs(t - en) ? 'start' : 'end';
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragH) return;
    const t = timeAt(e);
    if (dragH === 'start') tr.start = Math.max(0, Math.min(t, (tr.end > 0 ? tr.end : dur()) - 0.5));
    else tr.end = Math.min(dur(), Math.max(t, (tr.start || 0) + 0.5));
    drawWave(canvas, tr, i === currentIndex);
    sIn.value = fmtTime(Math.floor(tr.start || 0));
    eIn.value = tr.end > 0 ? fmtTime(Math.floor(tr.end)) : '';
  });
  const endDrag = () => { if (dragH) { dragH = null; commitTrim(tr, i, true); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
}
let padCrossfadeMs = 0;      // crossfade duration for pad triggers
let capturingFor = -1;      // index of the track awaiting a hotkey, or -1
let sceneEditing = -1;      // playlist index whose scene editor is open
let sceneImgTarget = -1, sceneCueTarget = -1; // track/cue awaiting an image
let activeCues = [], firedCue = -1;            // cue schedule for the playing track

function serializePlaylist() {
  return playlist.map(t => ({ path: t.path, name: t.name, key: t.key || null, cues: t.cues || [], isVideo: !!t.isVideo, gap: t.gap || 0, isInterlude: !!t.isInterlude, duration: t.duration || 0, start: t.start || 0, end: t.end || 0 }));
}
function normalizeTrack(t) {
  return { path: t.path || '', name: t.name || baseName(t.path || '') || 'Intermezzo', key: t.key || null, cues: migrateCues(Array.isArray(t.cues) ? t.cues : []), isVideo: !!t.isVideo, gap: t.gap || 0, isInterlude: !!t.isInterlude, duration: t.duration || 0, start: t.start || 0, end: t.end || 0 };
}
function savePlaylistState() {
  if (djv.savePlaylist) djv.savePlaylist(serializePlaylist());
}

function hasScene(tr) {
  return !!(tr.cues && tr.cues.some(c =>
    (c.type === 'effect' && c.effectIndex != null) ||
    (c.type === 'text' && c.text && c.text.trim()) ||
    (c.type === 'image' && c.image)));
}
function parseTime(str) {
  str = String(str).trim();
  if (str.indexOf(':') >= 0) { const p = str.split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }
  return parseFloat(str) || 0;
}

// ---- Scene model -----------------------------------------------------------
// A track scene is a list of timed ELEMENTS, each of type 'effect' | 'text' |
// 'image' with its OWN appearance time and optional visible duration. The three
// channels are independent: an effect, a text and an image each appear/disappear
// on their own schedule. dur 0 = stays until the next element of the same type.
const TXT_FONTS = [
  ['-apple-system, BlinkMacSystemFont, sans-serif', 'Sistema'],
  ["'Arial Black', Impact, sans-serif", 'Arial Black'],
  ['Impact, sans-serif', 'Impact'],
  ["Georgia, 'Times New Roman', serif", 'Georgia'],
  ["'Courier New', monospace", 'Monospace'],
  ["'Brush Script MT', 'Snell Roundhand', cursive", 'Corsivo'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ["'Trebuchet MS', sans-serif", 'Trebuchet'],
];
const TXT_DIRS = [['h', '➡️ Orizzontale'], ['vup', '⬆️ Vert. su'], ['vdown', '⬇️ Vert. giù'], ['sides', '↕️ Bordi laterali']];
const TXT_FX = [['none', 'Nessuno'], ['updown', 'Su e giù'], ['wave', 'Onda'], ['zoom', 'Zoom'], ['flash', 'Flash'], ['rotate', 'Rotazione']];
const TXT_POS = [['bottom', 'Basso'], ['top', 'Alto'], ['middle', 'Centro']];
const IMG_POS = { center: { x: 50, y: 50 }, top: { x: 50, y: 18 }, bottom: { x: 50, y: 82 }, left: { x: 20, y: 50 }, right: { x: 80, y: 50 } };
const IMG_POS_LABELS = { center: 'Centro', top: 'Alto', bottom: 'Basso', left: 'Sinistra', right: 'Destra' };

function optList(pairs, sel) {
  return pairs.map(([v, l]) => '<option value="' + String(v).replace(/"/g, '&quot;') + '"' + (v === sel ? ' selected' : '') + '>' + l + '</option>').join('');
}
function newEffectEl(time) { return { type: 'effect', time, effectIndex: EFFECTS.list.indexOf(currentEffect), effectName: currentEffect.name, dur: 0 }; }
function newTextEl(time) { return { type: 'text', time, text: '', dir: 'h', fx: 'none', font: TXT_FONTS[0][0], size: 6, weight: true, color: '#ffffff', pos: 'bottom', speed: 1, dur: 0 }; }
function newImageEl(time) { return { type: 'image', time, image: null, imageSize: 60, imagePos: 'center', dur: 0 }; }

// Convert legacy combined cues into the new per-element list (idempotent).
function migrateCues(cues) {
  if (!Array.isArray(cues) || cues.length === 0) return cues || [];
  if (cues.every(c => c && c.type)) return cues;
  const out = [];
  cues.forEach(c => {
    if (c && c.type) { out.push(c); return; }
    const t = (c && c.time) || 0;
    if (c.effectIndex != null) out.push({ type: 'effect', time: t, effectIndex: c.effectIndex, effectName: c.effectName || '', dur: 0 });
    if (c.text && c.text.trim()) {
      const s = c.textStyle || {};
      out.push({ type: 'text', time: t, text: c.text, dir: s.dir || 'h', fx: s.fx || 'none', font: s.font || TXT_FONTS[0][0], size: s.size || 6, weight: s.weight != null ? s.weight : true, color: s.color || '#ffffff', pos: 'bottom', speed: 1, dur: 0 });
    }
    if (c.image) out.push({ type: 'image', time: t, image: c.image, imageSize: c.imageSize || 60, imagePos: c.imagePos || 'center', dur: 0 });
  });
  return out;
}

// Runtime: re-evaluate which element is active per channel and diff-apply it.
let lastScene = { effect: null, text: null, image: null };
let userTrackBlend = 'normal'; // playlist-video blend chosen by the user
let sentTrackBlend = null;     // last blend pushed to the output (auto or manual)

function startCues(tr) {
  tr.cues = migrateCues(tr.cues || []);
  activeCues = tr.cues.slice().sort((a, b) => a.time - b.time);
  sentTrackBlend = null; // re-evaluate auto-blend for the new track
  // `undefined` (not null) forces advanceCues to APPLY every channel once, so a
  // stale text/image from the previous track is cleared even when the new scene
  // has nothing active at t=0.
  lastScene = { effect: undefined, text: undefined, image: undefined };
  advanceCues(0);
}
function sceneActive(type, t) {
  let best = null;
  for (const el of activeCues) {
    if (el.type !== type || el.time > t) continue;
    if (el.dur && el.time + el.dur <= t) continue;
    if (!best || el.time >= best.time) best = el;
  }
  return best;
}
function advanceCues(t) {
  const ef = sceneActive('effect', t);
  if (ef !== lastScene.effect) { lastScene.effect = ef; if (ef && EFFECTS.list[ef.effectIndex]) applyEffect(EFFECTS.list[ef.effectIndex]); }
  // Auto-blend: on a video track, when a scene effect is active, blend the video
  // ('screen') so the effect shows through underneath. Only when the user left
  // the blend at the default 'normal' — a manual choice is always respected.
  const curTr = playlist[currentIndex];
  if (curTr && curTr.isVideo) {
    const effOn = !!(ef && ef.effectIndex != null && EFFECTS.list[ef.effectIndex]);
    const wantBlend = (effOn && userTrackBlend === 'normal') ? 'screen' : userTrackBlend;
    if (wantBlend !== sentTrackBlend) { sentTrackBlend = wantBlend; send({ type: 'trackVideoBlend', value: wantBlend }); }
  }
  const tx = sceneActive('text', t);
  if (tx !== lastScene.text) { lastScene.text = tx; applyTextEl(tx); }
  const im = sceneActive('image', t);
  if (im !== lastScene.image) { lastScene.image = im; applyImageEl(im); }
}
function applyTextEl(el) {
  const show = !!(el && el.text && el.text.trim());
  send({ type: 'tickerText', text: show ? el.text : '' });
  send({ type: 'tickerOn', on: show });
  $('#ticker-text').value = show ? el.text : '';
  $('#ticker-on').checked = show;
  if (show) {
    send({ type: 'tickerDir', value: el.dir });
    send({ type: 'tickerFx', value: el.fx });
    send({ type: 'tickerFont', value: el.font });
    send({ type: 'tickerSize', value: el.size });
    send({ type: 'tickerWeight', on: el.weight });
    send({ type: 'tickerColor', value: el.color });
    send({ type: 'tickerPos', pos: el.pos });
    send({ type: 'tickerSpeed', mult: el.speed });
  }
}
function applyImageEl(el) {
  if (el && el.image) {
    const p = IMG_POS[el.imagePos || 'center'] || IMG_POS.center;
    send({ type: 'sceneImage', path: el.image, size: el.imageSize || 60, x: p.x, y: p.y });
  } else {
    send({ type: 'sceneImage', path: null });
  }
}
// Live preview: when editing the scene of the current track, re-apply at the
// current playback position so changes show immediately on the output.
function refreshScenePreview(i) {
  if (i !== currentIndex) return;
  activeCues = (playlist[i].cues || []).slice().sort((a, b) => a.time - b.time);
  lastScene = { effect: undefined, text: undefined, image: undefined };
  advanceCues(playCur || 0);
}

const baseName = (p) => p.split('/').pop();

function probePaths(paths) {
  const todo = paths.filter(p => p && !(p in durations));
  if (todo.length) send({ type: 'probeDurations', paths: todo });
}

function addTracks(items) {
  // items: array of { path, name }
  const start = playlist.length;
  items.forEach(it => { if (it.path) playlist.push({ path: it.path, name: it.name || baseName(it.path), key: null, cues: [], isVideo: !!it.isVideo, gap: 0, start: 0, end: 0 }); });
  renderPlaylist();
  savePlaylistState();
  probePaths(items.map(it => it.path));
  // Auto-start the first added track if nothing is playing yet.
  if (currentIndex < 0 && playlist.length > start) playIndex(start);
}

// Add a visual-only interlude item (effects/text/image between tracks).
function addInterlude() {
  playlist.push({ path: '', name: 'Intermezzo', key: null, cues: [], isVideo: false, isInterlude: true, duration: 15, gap: 0 });
  sceneEditing = playlist.length - 1; // open its scene editor right away
  renderPlaylist();
  savePlaylistState();
}

function playIndex(i) {
  if (i < 0 || i >= playlist.length) return;
  clearGap();
  const tr = playlist[i];
  currentIndex = i;
  isPlaying = true;
  ended = false;
  playbackOwner = 'playlist';
  activePad = -1; padPlaying = false; renderPads();
  $('#btn-play').disabled = false;
  $('#btn-play').textContent = '⏸ Pausa';
  if (tr.isInterlude) {
    playInterlude(tr);
    return;
  }
  send({ type: tr.isVideo ? 'playVideoTrack' : 'playTrack', path: tr.path, start: tr.start || 0, end: tr.end || 0 });
  startCues(tr);
  renderPlaylist();
}

// Visual-only interlude: silence audio, run this item's scene for its duration.
function playInterlude(tr) {
  send({ type: 'playSilence' });
  startCues(tr);
  const dur = Math.max(1, tr.duration || 15);
  runSeg('interlude', dur, 0, () => {
    if (tr.gap > 0) startGap(tr, tr.gap);
    else if (!nextTrack()) stopPlaylist();
  });
}

function nextTrack() {
  if (!playlist.length) return false;
  let n = currentIndex + 1;
  if (n >= playlist.length) { if (!repeat) return false; n = 0; }
  playIndex(n);
  return true;
}

function stopPlaylist() {
  isPlaying = false; ended = true; $('#btn-play').textContent = '▶ Play'; renderPlaylist();
}

// Timed visual segment: drives the scene timeline with no audio for `durSecs`,
// then runs onDone. Used both for inter-track gaps ('gap', continuing the
// previous scene from `base`) and for visual-only interlude items ('interlude',
// their own scene from base 0). Supports pause/resume via the Play button.
let segTimer = null, segMode = null, segRemain = 0;
let segDur = 0, segBase = 0, segElapsed = 0, segT0 = 0, segPaused = false, segDone = null;
function clearGap() { if (segTimer) { clearInterval(segTimer); segTimer = null; } segMode = null; segPaused = false; segRemain = 0; }
const clearSeg = clearGap;
function segTick() {
  if (segPaused) return;
  const elapsed = segElapsed + (Date.now() - segT0) / 1000;
  segRemain = Math.max(0, segDur - elapsed);
  playCur = Math.min(segDur, elapsed); playDur = segDur;
  advanceCues(segBase + elapsed);
  renderPlaylist();
  if (elapsed >= segDur) { const d = segDone; clearSeg(); if (d) d(); }
}
function runSeg(mode, durSecs, base, onDone) {
  clearSeg();
  segMode = mode; segDur = durSecs; segBase = base; segDone = onDone;
  segElapsed = 0; segT0 = Date.now(); segPaused = false;
  segTimer = setInterval(segTick, 200);
  segTick();
}
function pauseSeg() { if (segTimer && !segPaused) { segElapsed += (Date.now() - segT0) / 1000; segPaused = true; } }
function resumeSeg() { if (segTimer && segPaused) { segT0 = Date.now(); segPaused = false; } }
function startGap(tr, secs) {
  runSeg('gap', secs, playDur || playCur || 0, () => { if (!nextTrack()) stopPlaylist(); });
}

function removeTrack(i) {
  playlist.splice(i, 1);
  if (i === currentIndex) currentIndex = -1;
  else if (i < currentIndex) currentIndex--;
  if (sceneEditing === i) sceneEditing = -1;
  renderPlaylist();
  savePlaylistState();
}

function moveTrack(from, to) {
  if (to < 0 || to >= playlist.length) return;
  const [item] = playlist.splice(from, 1);
  playlist.splice(to, 0, item);
  if (currentIndex === from) currentIndex = to;
  else if (from < currentIndex && to >= currentIndex) currentIndex--;
  else if (from > currentIndex && to <= currentIndex) currentIndex++;
  renderPlaylist();
  savePlaylistState();
}

let dragFrom = -1;

// Build the <option> list of effect families for a cue's effect picker.
function cueFamilyOptions(selFam) {
  let s = '<option value="-1"' + (selFam < 0 ? ' selected' : '') + '>— nessun effetto —</option>';
  EFFECTS.families.forEach((name, i) => {
    s += '<option value="' + i + '"' + (i === selFam ? ' selected' : '') + '>' + name + '</option>';
  });
  return s;
}
// Build the <option> list of presets within a family for a cue's effect picker.
function cuePresetOptions(fam, selIdx) {
  if (fam < 0) return '<option value="">—</option>';
  let s = '';
  for (let i = 0; i < EFFECTS.list.length; i++) {
    if (EFFECTS.list[i].family !== fam) continue;
    s += '<option value="' + i + '"' + (i === selIdx ? ' selected' : '') + '>' + EFFECTS.list[i].name + '</option>';
  }
  return s;
}
// First preset index of a family (used when a family is chosen).
function firstPresetOfFamily(fam) {
  for (let i = 0; i < EFFECTS.list.length; i++) if (EFFECTS.list[i].family === fam) return i;
  return -1;
}

const EL_ICON = { effect: '🌀', text: '🔤', image: '🖼' };
const EL_LABEL = { effect: 'Effetto', text: 'Testo', image: 'Immagine' };

// Build the per-track scene editor: a list of independent timed elements
// (effect / text / image), each with its own appearance time and duration.
function buildSceneEditor(tr, i, li) {
  const cues = tr.cues = migrateCues(tr.cues || []);
  cues.sort((a, b) => a.time - b.time);
  const ed = document.createElement('li');
  ed.className = 'scene-editor';

  let html = '<div class="se-title">🎬 Scena a tempo <small>— ogni elemento appare al suo tempo; durata 0 = resta fino al successivo</small></div>';
  if (cues.length === 0) html += '<div class="se-empty">Nessun elemento. Aggiungi un effetto, un testo o un\'immagine qui sotto.</div>';

  cues.forEach((c, ci) => {
    html +=
      '<div class="cue cue-' + c.type + '" data-c="' + ci + '">' +
        '<div class="cue-head">' +
          '<span class="cue-ico">' + EL_ICON[c.type] + '</span>' +
          '<span class="cue-type">' + EL_LABEL[c.type] + '</span>' +
          '<span class="cue-at">@</span>' +
          '<input class="cue-time" type="text" value="' + fmtTime(Math.floor(c.time)) + '" title="Quando appare (mm:ss)" />' +
          '<span class="cue-durl">⏱</span>' +
          '<input class="cue-dur" type="number" min="0" step="1" value="' + (c.dur || 0) + '" title="Durata visibile in secondi (0 = resta fino al prossimo)" />' +
          '<button class="cue-del" title="Rimuovi elemento">✕</button>' +
        '</div>';

    if (c.type === 'effect') {
      const ce = (c.effectIndex != null && EFFECTS.list[c.effectIndex]) ? EFFECTS.list[c.effectIndex] : null;
      const cFam = ce ? ce.family : -1;
      html +=
        '<div class="cue-body">' +
          '<div class="cue-row">' +
            '<select class="cue-eff-fam" title="Categoria">' + cueFamilyOptions(cFam) + '</select>' +
            '<select class="cue-eff-pre" title="Preset"' + (cFam < 0 ? ' disabled' : '') + '>' + cuePresetOptions(cFam, c.effectIndex) + '</select>' +
          '</div>' +
          '<div class="cue-row">' +
            '<button class="cue-eff-cur" title="Usa l\'effetto visibile ora">🎯 Usa corrente</button>' +
            '<span class="cue-eff-name">' + (ce ? ce.name : 'nessuno') + '</span>' +
          '</div>' +
        '</div>';
    } else if (c.type === 'text') {
      html +=
        '<div class="cue-body">' +
          '<input class="cue-text textfield" placeholder="Testo da mostrare" />' +
          '<div class="cue-row">' +
            '<select class="cue-tx-dir" title="Direzione">' + optList(TXT_DIRS, c.dir) + '</select>' +
            '<select class="cue-tx-fx" title="Effetto">' + optList(TXT_FX, c.fx) + '</select>' +
          '</div>' +
          '<div class="cue-row">' +
            '<select class="cue-tx-font" title="Font">' + optList(TXT_FONTS, c.font) + '</select>' +
            '<select class="cue-tx-pos" title="Posizione">' + optList(TXT_POS, c.pos) + '</select>' +
          '</div>' +
          '<div class="cue-row">' +
            '<span class="cue-dim">Dim</span><input class="cue-tx-size" type="range" min="2" max="18" step="0.5" value="' + c.size + '" />' +
            '<label class="chk"><input class="cue-tx-bold" type="checkbox"' + (c.weight ? ' checked' : '') + ' /> B</label>' +
            '<input class="cue-tx-color" type="color" value="' + c.color + '" />' +
          '</div>' +
          '<div class="cue-row"><span class="cue-dim">Vel</span><input class="cue-tx-speed" type="range" min="0.2" max="4" step="0.1" value="' + c.speed + '" /></div>' +
        '</div>';
    } else {
      html +=
        '<div class="cue-body">' +
          '<div class="cue-row">' +
            '<button class="cue-img">Carica…</button>' +
            '<button class="cue-img-clear">✕</button>' +
            '<span class="cue-name">' + (c.image ? baseName(c.image) : 'nessuna') + '</span>' +
          '</div>' +
          '<div class="cue-row"><select class="cue-img-pos">' +
            Object.keys(IMG_POS_LABELS).map(p => '<option value="' + p + '"' + ((c.imagePos || 'center') === p ? ' selected' : '') + '>' + IMG_POS_LABELS[p] + '</option>').join('') +
          '</select><span class="cue-dim">Dim</span><input class="cue-img-size" type="range" min="10" max="100" step="1" value="' + (c.imageSize || 60) + '" /></div>' +
        '</div>';
    }
    html += '</div>';
  });

  html += '<div class="se-foot">' +
    '<button class="add-eff" title="Aggiungi effetto">➕🌀</button>' +
    '<button class="add-txt" title="Aggiungi testo">➕🔤</button>' +
    '<button class="add-img" title="Aggiungi immagine">➕🖼</button>' +
    '<button class="se-clear">🗑 Scena</button>' +
  '</div>' +
  (tr.isInterlude
    ? '<div class="se-gap" title="Durata dell\'intermezzo (solo scena, niente audio)">' +
        '✨ Durata intermezzo <input class="cue-segdur" type="number" min="1" step="1" value="' + (tr.duration || 15) + '" /> s' +
      '</div>'
    : '<div class="se-gap" title="Pausa dopo questo brano: la scena continua per questi secondi prima di passare al prossimo">' +
        '⏸ Pausa dopo <input class="cue-gap" type="number" min="0" step="1" value="' + (tr.gap || 0) + '" /> s ' +
        '<small>la scena continua durante la pausa</small>' +
      '</div>');
  ed.innerHTML = html;

  // re-render (used after structural changes)
  const save = () => { savePlaylistState(); refreshScenePreview(i); renderPlaylist(); };
  // keep the open editor (no re-render) for smooth slider/typing edits
  const saveLive = () => { savePlaylistState(); refreshScenePreview(i); li.querySelector('.scene-btn').classList.toggle('active', hasScene(tr)); };

  ed.querySelectorAll('.cue').forEach(cueEl => {
    const ci = parseInt(cueEl.dataset.c, 10);
    const c = cues[ci];
    cueEl.querySelector('.cue-time').addEventListener('change', (e) => { c.time = parseTime(e.target.value); save(); });
    cueEl.querySelector('.cue-dur').addEventListener('change', (e) => { c.dur = Math.max(0, parseFloat(e.target.value) || 0); saveLive(); });
    cueEl.querySelector('.cue-del').addEventListener('click', () => { cues.splice(ci, 1); save(); });

    if (c.type === 'effect') {
      cueEl.querySelector('.cue-eff-fam').addEventListener('change', (e) => {
        const fam = parseInt(e.target.value, 10);
        if (fam < 0) { c.effectIndex = null; c.effectName = ''; }
        else { const idx = firstPresetOfFamily(fam); c.effectIndex = idx; c.effectName = idx >= 0 ? EFFECTS.list[idx].name : ''; }
        save();
      });
      cueEl.querySelector('.cue-eff-pre').addEventListener('change', (e) => {
        const idx = parseInt(e.target.value, 10);
        if (idx >= 0 && EFFECTS.list[idx]) { c.effectIndex = idx; c.effectName = EFFECTS.list[idx].name; save(); }
      });
      cueEl.querySelector('.cue-eff-cur').addEventListener('click', () => { c.effectIndex = EFFECTS.list.indexOf(currentEffect); c.effectName = currentEffect.name; save(); });
    } else if (c.type === 'text') {
      const ti = cueEl.querySelector('.cue-text'); ti.value = c.text || '';
      ti.addEventListener('input', (e) => { c.text = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-tx-dir').addEventListener('change', (e) => { c.dir = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-tx-fx').addEventListener('change', (e) => { c.fx = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-tx-font').addEventListener('change', (e) => { c.font = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-tx-pos').addEventListener('change', (e) => { c.pos = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-tx-size').addEventListener('input', (e) => { c.size = parseFloat(e.target.value); saveLive(); });
      cueEl.querySelector('.cue-tx-bold').addEventListener('change', (e) => { c.weight = e.target.checked; saveLive(); });
      cueEl.querySelector('.cue-tx-color').addEventListener('input', (e) => { c.color = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-tx-speed').addEventListener('input', (e) => { c.speed = parseFloat(e.target.value); saveLive(); });
    } else {
      cueEl.querySelector('.cue-img').addEventListener('click', () => { sceneImgTarget = i; sceneCueTarget = ci; $('#scene-img-input').click(); });
      cueEl.querySelector('.cue-img-clear').addEventListener('click', () => { c.image = null; save(); });
      cueEl.querySelector('.cue-img-pos').addEventListener('change', (e) => { c.imagePos = e.target.value; saveLive(); });
      cueEl.querySelector('.cue-img-size').addEventListener('input', (e) => { c.imageSize = parseInt(e.target.value, 10); saveLive(); });
    }
  });

  const addEl = (mk) => {
    const lastT = cues.length ? cues[cues.length - 1].time : 0;
    cues.push(mk(cues.length ? lastT : 0));
    save();
  };
  ed.querySelector('.add-eff').addEventListener('click', () => addEl(newEffectEl));
  ed.querySelector('.add-txt').addEventListener('click', () => addEl(newTextEl));
  ed.querySelector('.add-img').addEventListener('click', () => addEl(newImageEl));
  ed.querySelector('.se-clear').addEventListener('click', () => { tr.cues = []; sceneEditing = -1; save(); });
  const gapInput = ed.querySelector('.cue-gap');
  if (gapInput) gapInput.addEventListener('change', (e) => { tr.gap = Math.max(0, parseFloat(e.target.value) || 0); savePlaylistState(); renderPlaylist(); });
  const segInput = ed.querySelector('.cue-segdur');
  if (segInput) segInput.addEventListener('change', (e) => { tr.duration = Math.max(1, parseFloat(e.target.value) || 15); savePlaylistState(); renderPlaylist(); });
  return ed;
}

function renderPlaylist() {
  const ol = $('#playlist');
  ol.innerHTML = '';
  playlist.forEach((tr, i) => {
    const li = document.createElement('li');
    li.className = 'track' + (i === currentIndex ? ' playing' : '');
    li.draggable = true;
    li.dataset.index = i;

    const isCur = i === currentIndex;
    const inSeg = isCur && segTimer;
    const playIcon = (isCur && isPlaying) ? '⏸' : '▶';
    let timeLabel = '';
    if (inSeg) timeLabel = (segMode === 'interlude' ? '✨ ' : '⏸ ') + Math.ceil(segRemain) + 's';
    else if (tr.isInterlude) timeLabel = '✨ ' + fmtTime(tr.duration || 15);
    else if (isCur && playDur > 0) timeLabel = '-' + fmtTime(Math.floor(Math.max(0, playDur - playCur)));
    else if (durations[tr.path] > 0) timeLabel = fmtTime(Math.floor(durations[tr.path]));
    const prog = (isCur && playDur > 0) ? Math.min(100, playCur / playDur * 100) : 0;
    const gapBadge = (tr.gap > 0 && !tr.isInterlude) ? '<span class="gap-badge" title="Pausa di ' + tr.gap + 's dopo questo brano">⏸' + tr.gap + 's</span>' : '';
    const icon = tr.isInterlude ? '✨ ' : (tr.isVideo ? '🎞 ' : '');

    // Total / elapsed / remaining for the trimmed range.
    const dur = durations[tr.path] || (isCur ? playDur : 0);
    const tStart = tr.start || 0;
    const tEnd = tr.end > 0 ? tr.end : dur;
    const total = Math.max(0, tEnd - tStart);
    const elapsed = isCur ? Math.max(0, Math.min(total, playCur - tStart)) : 0;
    const remaining = Math.max(0, total - elapsed);

    const body = (tr.isInterlude || !tr.path) ? '' :
      '<div class="track-body">' +
        '<div class="track-times">' +
          '<span class="tt-el" title="Trascorso">▶ ' + fmtTime(Math.floor(elapsed)) + '</span>' +
          '<span class="tt-tot" title="Durata totale">⏱ ' + fmtTime(Math.floor(total)) + '</span>' +
          '<span class="tt-rem" title="Rimasto">⧗ -' + fmtTime(Math.ceil(remaining)) + '</span>' +
        '</div>' +
        '<canvas class="wave" width="' + WAVE_BUCKETS + '" height="46"></canvas>' +
        '<div class="track-trim">' +
          '<span class="trim-lbl trim-lbl-s">Inizio</span>' +
          '<input class="trim-start" type="text" value="' + fmtTime(Math.floor(tStart)) + '" title="Punto di inizio (mm:ss)" />' +
          '<button class="trim-here-s" title="Imposta inizio al punto attuale">📍</button>' +
          '<span class="trim-lbl trim-lbl-e">Fine</span>' +
          '<input class="trim-end" type="text" value="' + (tr.end > 0 ? fmtTime(Math.floor(tr.end)) : '') + '" placeholder="—" title="Punto di fine (mm:ss, vuoto = fine brano)" />' +
          '<button class="trim-here-e" title="Imposta fine al punto attuale">📍</button>' +
          '<button class="trim-reset" title="Azzera inizio/fine">↺</button>' +
        '</div>' +
      '</div>';

    li.innerHTML =
      '<div class="track-head">' +
        '<span class="grip">⠿</span>' +
        '<span class="tname' + (tr.isInterlude ? ' is-interlude' : '') + '" title="Avvia / riavvia dall\'inizio — ' + tr.name.replace(/"/g, '&quot;') + '">' + icon + tr.name + gapBadge + '</span>' +
        '<span class="ttime">' + timeLabel + '</span>' +
        '<button class="key-btn" title="Assegna tasto rapido">' +
          (capturingFor === i ? '…' : (tr.key ? tr.key.toUpperCase() : '⌨')) + '</button>' +
        '<button class="play-btn" title="' + (isCur && isPlaying ? 'Pausa' : 'Avvia') + '">' + playIcon + '</button>' +
        '<button class="scene-btn' + (hasScene(tr) ? ' active' : '') + '" title="Scena del brano (effetto/testo/immagine)">🎬</button>' +
        '<button class="del-btn" title="Rimuovi">✕</button>' +
        (isCur ? '<i class="tprog" style="width:' + prog.toFixed(1) + '%"></i>' : '') +
      '</div>' + body;

    // Clicking the name (re)starts the track from the beginning.
    li.querySelector('.tname').addEventListener('click', () => playIndex(i));
    // On the current track the button pauses/resumes/replays; on others it starts that track.
    li.querySelector('.play-btn').addEventListener('click', () => {
      if (i === currentIndex) togglePlayPause();
      else playIndex(i);
    });
    li.querySelector('.del-btn').addEventListener('click', () => removeTrack(i));
    li.querySelector('.key-btn').addEventListener('click', () => {
      capturingFor = capturingFor === i ? -1 : i;
      renderPlaylist();
    });
    li.querySelector('.scene-btn').addEventListener('click', () => {
      sceneEditing = sceneEditing === i ? -1 : i;
      renderPlaylist();
    });

    // Waveform + trim controls.
    const canvas = li.querySelector('.wave');
    if (canvas) {
      ensurePeaks(tr.path);
      drawWave(canvas, tr, isCur);
      wireTrim(li, canvas, tr, i);
    }

    // Drag to reorder.
    li.addEventListener('dragstart', () => { dragFrom = i; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => { dragFrom = -1; li.classList.remove('dragging'); });
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragFrom >= 0 && dragFrom !== i) moveTrack(dragFrom, i);
    });

    ol.appendChild(li);

    if (sceneEditing === i) ol.appendChild(buildSceneEditor(tr, i, li));
  });
  $('#playlist-count').textContent = playlist.length + (playlist.length === 1 ? ' brano' : ' brani');
}

$('#btn-add-tracks').addEventListener('click', () => $('#tracks-input').click());
$('#btn-add-interlude').addEventListener('click', addInterlude);
$('#tracks-input').addEventListener('change', (e) => {
  const items = [...e.target.files].map(f => ({ path: filePath(f), name: f.name, isVideo: f.type.startsWith('video/') }));
  if (items.length) addTracks(items);
  e.target.value = ''; // allow re-adding the same file
});
$('#scene-img-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  const p = f && filePath(f);
  if (p && sceneImgTarget >= 0 && playlist[sceneImgTarget]) {
    const tr = playlist[sceneImgTarget];
    const el = (tr.cues || [])[sceneCueTarget];
    if (el && el.type === 'image') { el.image = p; savePlaylistState(); refreshScenePreview(sceneImgTarget); renderPlaylist(); }
  }
  sceneImgTarget = -1; sceneCueTarget = -1; e.target.value = '';
});
$('#btn-clear-playlist').addEventListener('click', () => {
  playlist = []; currentIndex = -1; sceneEditing = -1; renderPlaylist(); savePlaylistState();
});
$('#repeat-playlist').addEventListener('change', (e) => { repeat = e.target.checked; });

// Export / import the playlist to a file.
$('#btn-pl-save').addEventListener('click', async () => {
  if (djv.exportPlaylist) await djv.exportPlaylist(serializePlaylist());
});
$('#btn-pl-load').addEventListener('click', async () => {
  if (!djv.importPlaylist) return;
  const data = await djv.importPlaylist();
  if (Array.isArray(data)) {
    playlist = data.map(normalizeTrack);
    currentIndex = -1; sceneEditing = -1;
    renderPlaylist(); savePlaylistState();
    probePaths(playlist.map(t => t.path));
  }
});

// Playlist-video rendering (blend / opacity / fit).
$('#tvid-fit').addEventListener('change', (e) => send({ type: 'trackVideoFit', value: e.target.value }));
$('#tvid-blend').addEventListener('change', (e) => { userTrackBlend = e.target.value; sentTrackBlend = e.target.value; send({ type: 'trackVideoBlend', value: e.target.value }); });
$('#tvid-op').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  $('#tvid-op-val').textContent = v + '%';
  send({ type: 'trackVideoOpacity', value: v / 100 });
});
$('#btn-use-input').addEventListener('click', () =>
  send({ type: 'useInput', deviceId: $('#device-select').value || null }));
$('#output-select').addEventListener('change', (e) =>
  send({ type: 'outputDevice', deviceId: e.target.value || '' }));

// Per-band visual intensity (Bass / Mid / Treble).
[['bass', 'bass-gain'], ['mid', 'mid-gain'], ['treble', 'treble-gain']].forEach(([band, id]) => {
  $('#' + id).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    $('#' + id + '-val').textContent = v.toFixed(1) + '×';
    send({ type: 'bandGain', band, value: v });
  });
});

// ---------------------------------------------------------------- parameters
$('#gain').addEventListener('input', (e) => {
  $('#gain-val').textContent = parseFloat(e.target.value).toFixed(1) + '×';
  send({ type: 'gain', value: parseFloat(e.target.value) });
});
$('#speed').addEventListener('input', (e) => {
  $('#speed-val').textContent = parseFloat(e.target.value).toFixed(1) + '×';
  send({ type: 'speed', value: parseFloat(e.target.value) });
});

// ---------------------------------------------------------------- images
$('#btn-images').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', (e) => {
  const paths = [...e.target.files].map(filePath).filter(Boolean);
  if (paths.length) send({ type: 'addImages', paths });
});
$('#btn-images-clear').addEventListener('click', () => send({ type: 'clearImages' }));
$('#img-blend').addEventListener('change', (e) => send({ type: 'imgBlend', value: e.target.value }));
$('#img-slideshow').addEventListener('change', (e) => send({ type: 'slideshow', on: e.target.checked }));
$('#img-beat').addEventListener('change', (e) => send({ type: 'imgBeat', on: e.target.checked }));
$('#img-size').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  $('#img-size-val').textContent = v + '%';
  send({ type: 'imgSize', value: v });
});
$('#img-interval').addEventListener('input', (e) => {
  const s = parseFloat(e.target.value);
  $('#img-interval-val').textContent = s.toFixed(1) + 's';
  send({ type: 'slideshowInterval', ms: s * 1000 });
});

// ---------------------------------------------------------------- video
$('#btn-video').addEventListener('click', () => $('#video-input').click());
$('#video-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  const p = f && filePath(f);
  if (p) send({ type: 'videoLoad', path: p });
  e.target.value = '';
});
$('#btn-video-toggle').addEventListener('click', () => send({ type: 'videoToggle' }));
$('#btn-video-clear').addEventListener('click', () => send({ type: 'videoClear' }));
$('#video-op').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  $('#video-op-val').textContent = v + '%';
  send({ type: 'videoOpacity', value: v / 100 });
});
$('#video-fit').addEventListener('change', (e) => send({ type: 'videoFit', value: e.target.value }));
$('#video-blend').addEventListener('change', (e) => send({ type: 'videoBlend', value: e.target.value }));

// ---------------------------------------------------------------- ticker
$('#ticker-text').addEventListener('input', (e) => send({ type: 'tickerText', text: e.target.value.replace(/\s*\n\s*/g, ' · ') }));
$('#ticker-on').addEventListener('change', (e) => send({ type: 'tickerOn', on: e.target.checked }));
$('#ticker-pos').addEventListener('change', (e) => send({ type: 'tickerPos', pos: e.target.value }));
$('#ticker-dir').addEventListener('change', (e) => send({ type: 'tickerDir', value: e.target.value }));
$('#ticker-speed').addEventListener('input', (e) => {
  const m = parseFloat(e.target.value);
  $('#ticker-speed-val').textContent = m.toFixed(1) + '×';
  send({ type: 'tickerSpeed', mult: m });
});
$('#ticker-font').addEventListener('change', (e) => send({ type: 'tickerFont', value: e.target.value }));
$('#ticker-size').addEventListener('input', (e) => {
  $('#ticker-size-val').textContent = parseFloat(e.target.value).toFixed(1);
  send({ type: 'tickerSize', value: parseFloat(e.target.value) });
});
$('#ticker-bold').addEventListener('change', (e) => send({ type: 'tickerWeight', on: e.target.checked }));
$('#ticker-color').addEventListener('input', (e) => send({ type: 'tickerColor', value: e.target.value }));
$('#ticker-fx').addEventListener('change', (e) => send({ type: 'tickerFx', value: e.target.value }));

// ---------------------------------------------------------------- displays
async function refreshDisplays() {
  const list = await djv.listDisplays();
  const sel = $('#display-select');
  sel.innerHTML = '';
  list.forEach(d => {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.label + (d.isPrimary ? ' (principale)' : '') + ` — ${d.bounds.width}×${d.bounds.height}`;
    sel.appendChild(o);
  });
  const ext = list.find(d => !d.isPrimary);
  if (ext) sel.value = ext.id;
}
$('#btn-display').addEventListener('click', () => {
  const id = parseInt($('#display-select').value, 10);
  if (id) djv.moveOutputTo(id);
});
$('#btn-fullscreen').addEventListener('click', () => djv.toggleOutputFullscreen());

// ---------------------------------------------------------------- recording
let recOn = false, recTimer = null, recStartedAt = 0;
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = s % 60;
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}
function recTick() { $('#rec-time').textContent = fmtTime(Math.floor((Date.now() - recStartedAt) / 1000)); }
function stopRecTimer() { if (recTimer) { clearInterval(recTimer); recTimer = null; } }

$('#btn-rec').addEventListener('click', () => {
  if (!recOn) {
    send({ type: 'recStart' });
  } else {
    const [w, h] = $('#rec-aspect').value.split('x').map(Number);
    send({ type: 'recStop', w, h });
    stopRecTimer();
    $('#rec-label').textContent = 'Conversione MP4…';
    $('#btn-rec').disabled = true;
  }
});
$('#btn-rec-folder').addEventListener('click', () => djv.openRecordingsFolder());

// ---------------------------------------------------------------- pad bank
const PAD_COUNT = 20; // 5 × 4
let pads = new Array(PAD_COUNT).fill(null);   // each: { path, name } or null
let activePad = -1, padPlaying = false, padLoadTarget = -1, padCapturing = -1;
const padGrid = $('#pad-grid');

function savePadState() { if (djv.savePads) djv.savePads(pads); }

function renderPads() {
  if (!padGrid) return;
  padGrid.innerHTML = '';
  pads.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'pad' + (p ? ' filled' : '') + (i === activePad && padPlaying ? ' active' : '');
    d.dataset.i = i;
    const isActive = i === activePad && padPlaying;
    const prog = (isActive && playDur > 0) ? Math.min(100, playCur / playDur * 100) : 0;
    const remain = (isActive && playDur > 0) ? '-' + fmtTime(Math.floor(Math.max(0, playDur - playCur)))
      : (p && durations[p.path] > 0 ? fmtTime(Math.floor(durations[p.path])) : '');
    d.innerHTML = '<span class="pad-num">' + (i + 1) + '</span>' +
      (p ? '<span class="pad-name">' + p.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>' +
           (remain ? '<span class="pad-time">' + remain + '</span>' : '') +
           '<button class="pad-x" title="Svuota">✕</button>' +
           '<button class="pad-key" title="Assegna tasto rapido">' +
             (padCapturing === i ? '…' : (p.key ? p.key.toUpperCase() : '⌨')) + '</button>' +
           (isActive ? '<i class="pad-prog" style="width:' + prog.toFixed(1) + '%"></i>' : '')
         : '<span class="pad-plus">＋</span>');
    padGrid.appendChild(d);
  });
}

function assignPad(i, item) { pads[i] = item; renderPads(); savePadState(); if (item) probePaths([item.path]); }
function loadPadFile(i) { padLoadTarget = i; $('#pad-input').click(); }

function playPad(i) {
  const p = pads[i];
  if (!p) { loadPadFile(i); return; }
  if (i === activePad && padPlaying) {       // re-press the active pad = stop
    send({ type: 'togglePlay' });
    padPlaying = false; renderPads();
    return;
  }
  clearGap();
  playbackOwner = 'pad';
  activePad = i; padPlaying = true;
  activeCues = []; firedCue = -1; lastScene = { effect: null, text: null, image: null }; // pads don't run playlist cues
  playCur = 0; playDur = durations[p.path] || 0;
  // The playlist is no longer the active source.
  currentIndex = -1; isPlaying = false; renderPlaylist();
  send({ type: 'playTrack', path: p.path, crossfade: padCrossfadeMs });
  renderPads();
}

function clearPad(i) {
  pads[i] = null;
  if (i === activePad) { activePad = -1; padPlaying = false; }
  renderPads();
  savePadState();
}

padGrid.addEventListener('click', (e) => {
  const pad = e.target.closest('.pad');
  if (!pad) return;
  const i = parseInt(pad.dataset.i, 10);
  if (e.target.closest('.pad-x')) { e.stopPropagation(); clearPad(i); return; }
  if (e.target.closest('.pad-key')) { e.stopPropagation(); padCapturing = padCapturing === i ? -1 : i; renderPads(); return; }
  playPad(i);
});
padGrid.addEventListener('contextmenu', (e) => {
  const pad = e.target.closest('.pad');
  if (!pad) return;
  e.preventDefault();
  loadPadFile(parseInt(pad.dataset.i, 10));
});
padGrid.addEventListener('dragover', (e) => { if (e.target.closest('.pad')) { e.preventDefault(); e.stopPropagation(); } });
padGrid.addEventListener('drop', (e) => {
  const pad = e.target.closest('.pad');
  if (!pad) return;
  e.preventDefault(); e.stopPropagation();
  const f = [...e.dataTransfer.files].find(x => x.type.startsWith('audio/'));
  const p = f && filePath(f);
  if (p) assignPad(parseInt(pad.dataset.i, 10), { path: p, name: f.name });
});

$('#pad-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  const p = f && filePath(f);
  if (p && padLoadTarget >= 0) assignPad(padLoadTarget, { path: p, name: f.name });
  padLoadTarget = -1; e.target.value = '';
});
$('#btn-pad-stop').addEventListener('click', () => {
  if (padPlaying) { send({ type: 'togglePlay' }); padPlaying = false; renderPads(); }
});
$('#btn-pad-clear').addEventListener('click', () => {
  pads = new Array(PAD_COUNT).fill(null); activePad = -1; padPlaying = false; renderPads(); savePadState();
});
const padXfade = $('#pad-xfade');
if (padXfade) padXfade.addEventListener('input', (e) => {
  const s = parseFloat(e.target.value);
  $('#pad-xfade-val').textContent = s.toFixed(1) + 's';
  padCrossfadeMs = s * 1000;
});

// Load saved pad assignments on startup.
(async () => {
  try {
    const saved = djv.loadPads ? await djv.loadPads() : null;
    if (Array.isArray(saved)) for (let i = 0; i < PAD_COUNT; i++) pads[i] = saved[i] || null;
  } catch (e) { /* ignore */ }
  renderPads();
  probePaths(pads.filter(Boolean).map(p => p.path));
})();

// Load saved playlist (with per-track scenes/cues) on startup.
(async () => {
  try {
    const saved = djv.loadPlaylist ? await djv.loadPlaylist() : null;
    if (Array.isArray(saved) && saved.length) {
      playlist = saved.map(normalizeTrack);
      renderPlaylist();
      probePaths(playlist.map(t => t.path));
    }
  } catch (e) { /* ignore */ }
})();

// ---------------------------------------------------------------- tabs
document.querySelectorAll('#tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === t));
  });
});

// ---------------------------------------------------------------- logos
document.querySelectorAll('.logo-load').forEach(b => b.addEventListener('click', () =>
  document.querySelector('.logo-input[data-logo="' + b.dataset.logo + '"]').click()));

document.querySelectorAll('.logo-input').forEach(inp => inp.addEventListener('change', (e) => {
  const i = parseInt(inp.dataset.logo, 10);
  const p = e.target.files[0] && filePath(e.target.files[0]);
  if (p) send({ type: 'logo', index: i, path: p });
  inp.value = '';
}));

document.querySelectorAll('.logo-clear').forEach(b => b.addEventListener('click', () =>
  send({ type: 'logo', index: parseInt(b.dataset.logo, 10), path: null })));

function bindLogoSliders(cls, valCls, type, fmt, xform) {
  document.querySelectorAll('.' + cls).forEach(s => s.addEventListener('input', (e) => {
    const i = parseInt(s.dataset.logo, 10);
    const v = parseFloat(e.target.value);
    s.closest('.logo-ctl').querySelector('.' + valCls).textContent = fmt(v);
    send({ type, index: i, value: xform ? xform(v) : v });
  }));
}
bindLogoSliders('logo-x', 'logo-x-val', 'logoX', v => v + '%');
bindLogoSliders('logo-y', 'logo-y-val', 'logoY', v => v + '%');
bindLogoSliders('logo-size', 'logo-size-val', 'logoSize', v => v + '%');
bindLogoSliders('logo-op', 'logo-op-val', 'logoOpacity', v => v + '%', v => v / 100);

// ---------------------------------------------------------------- drag & drop
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragover'); });
window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragover'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const files = [...e.dataTransfer.files];
  // Audio and video files both go into the playlist as tracks.
  const mediaItems = files.filter(f => f.type.startsWith('audio/') || f.type.startsWith('video/'))
    .map(f => ({ path: filePath(f), name: f.name, isVideo: f.type.startsWith('video/') }));
  const imgPaths = files.filter(f => f.type.startsWith('image/')).map(filePath).filter(Boolean);
  if (mediaItems.length) addTracks(mediaItems);
  if (imgPaths.length) send({ type: 'addImages', paths: imgPaths });
});

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  // Assigning a hotkey to a playlist track.
  if (capturingFor >= 0) {
    e.preventDefault();
    if (e.key !== 'Escape' && e.key.length === 1) {
      const k = e.key.toLowerCase();
      playlist.forEach(t => { if (t.key === k) t.key = null; }); // keys are unique
      playlist[capturingFor].key = k;
      savePlaylistState();
    }
    capturingFor = -1;
    renderPlaylist();
    return;
  }
  // Assigning a hotkey to a sequence effect.
  if (seqCapturing >= 0) {
    e.preventDefault();
    if (e.key !== 'Escape' && e.key.length === 1) {
      const k = e.key.toLowerCase();
      sequence.forEach(s => { if (s.key === k) s.key = null; });
      sequence[seqCapturing].key = k;
    }
    seqCapturing = -1;
    renderSequence();
    return;
  }
  // Assigning a hotkey to a pad.
  if (padCapturing >= 0) {
    e.preventDefault();
    if (e.key !== 'Escape' && e.key.length === 1) {
      const k = e.key.toLowerCase();
      pads.forEach(p => { if (p && p.key === k) p.key = null; }); // keys are unique
      if (pads[padCapturing]) pads[padCapturing].key = k;
      savePadState();
    }
    padCapturing = -1;
    renderPads();
    return;
  }

  if ((e.target.tagName === 'INPUT' && e.target.type === 'text') || e.target.tagName === 'TEXTAREA') return;

  const lk = e.key.toLowerCase();
  // Track hotkeys take priority, then effect hotkeys.
  const hk = playlist.findIndex(t => t.key === lk);
  if (hk >= 0) { playIndex(hk); return; }
  const ek = sequence.findIndex(s => s.key === lk);
  if (ek >= 0) { applySeqIndex(ek); return; }
  const pk = pads.findIndex(p => p && p.key === lk);
  if (pk >= 0) { playPad(pk); return; }

  // Number keys 1-9 apply the first nine sequence slots.
  if (e.key >= '1' && e.key <= '9') { applySeqIndex(parseInt(e.key, 10) - 1); return; }
  switch (lk) {
    case 'f': djv.toggleOutputFullscreen(); break;
    case 'o': $('#tracks-input').click(); break;
    case 'g': $('#image-input').click(); break;
    case 'arrowright': send({ type: 'imgNext' }); break;
    case 'arrowleft': send({ type: 'imgPrev' }); break;
    case 't': { const cb = $('#ticker-on'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); break; }
    case ' ': e.preventDefault(); togglePlayPause(); break;
  }
});

// ---------------------------------------------------------------- reports in
djv.onReport((m) => {
  switch (m.type) {
    case 'devices': {
      const sel = $('#device-select');
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Input live (mic/line/BlackHole) —</option>';
      m.list.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Input audio';
        sel.appendChild(o);
      });
      sel.value = cur;
      break;
    }
    case 'outputs': {
      const sel = $('#output-select');
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Uscita predefinita —</option>';
      m.list.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Uscita audio';
        sel.appendChild(o);
      });
      sel.value = cur;
      break;
    }
    case 'meters':
      $('#m-bass').style.width = (m.bass * 100).toFixed(0) + '%';
      $('#m-mid').style.width = (m.mid * 100).toFixed(0) + '%';
      $('#m-treble').style.width = (m.treble * 100).toFixed(0) + '%';
      $('#fps').textContent = m.fps.toFixed(0) + ' fps';
      break;
    case 'playState':
      if (playbackOwner === 'pad') {
        padPlaying = m.playing;
        renderPads();
      } else {
        isPlaying = m.playing;
        if (m.playing) ended = false;
        $('#btn-play').disabled = false;
        $('#btn-play').textContent = m.playing ? '⏸ Pausa' : '▶ Play';
        renderPlaylist();
      }
      break;
    case 'trackEnded':
      if (playbackOwner === 'pad') {
        padPlaying = false;
        renderPads();
      } else {
        const endedTr = playlist[currentIndex];
        const gap = (endedTr && endedTr.gap) || 0;
        if (gap > 0) {
          startGap(endedTr, gap); // intermission, then advance
        } else if (!nextTrack()) {
          // No next track: reset to a stopped state so the button shows ▶ again.
          isPlaying = false;
          ended = true;
          $('#btn-play').textContent = '▶ Play';
          renderPlaylist();
        }
      }
      break;
    case 'beat':
      // Auto-cycle effects on the beat (with a small guard against double-fires).
      if (autoCycle && onBeat) {
        const now = Date.now();
        if (now - lastBeatAdvance > 250) { lastBeatAdvance = now; nextInSequence(); }
      }
      break;
    case 'durations':
      m.list.forEach(d => { durations[d.path] = d.duration; });
      renderPlaylist(); renderPads();
      break;
    case 'progress':
      if (segTimer) break; // a visual segment (interlude/gap) drives time itself
      playCur = m.currentTime; playDur = m.duration;
      if (playbackOwner === 'pad') { renderPads(); }
      else { advanceCues(playCur); renderPlaylist(); }
      break;
    case 'recState':
      recOn = m.recording;
      $('#btn-rec').disabled = false;
      $('#rec-dot').className = recOn ? 'on' : 'off';
      if (recOn) {
        $('#btn-rec').textContent = '⏹ Ferma e salva MP4';
        $('#rec-label').textContent = 'Registrazione…';
        recStartedAt = Date.now(); recTick();
        stopRecTimer(); recTimer = setInterval(recTick, 1000);
      } else {
        $('#btn-rec').textContent = '🔴 Avvia registrazione';
        stopRecTimer();
      }
      break;
    case 'recSaved':
      $('#rec-label').textContent = 'Salvato ✓';
      $('#btn-rec').disabled = false;
      break;
    case 'recError':
      recOn = false; stopRecTimer();
      $('#rec-dot').className = 'off';
      $('#btn-rec').disabled = false;
      $('#btn-rec').textContent = '🔴 Avvia registrazione';
      $('#rec-label').textContent = 'Errore: ' + m.message;
      console.warn('rec error:', m.message);
      break;
    case 'fileLoaded':
      $('#btn-play').disabled = false;
      break;
    case 'error':
      console.warn('output error:', m.message);
      break;
  }
});

// ---------------------------------------------------------------- init
renderLibrary();
renderSequence();
applyEffect(currentEffect); // push the starting effect to the output window
refreshDisplays();
window.addEventListener('focus', refreshDisplays);
send({ type: 'refreshDevices' });
