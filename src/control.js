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
  if (ended && currentIndex >= 0) playIndex(currentIndex);
  else send({ type: 'togglePlay' });
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
let playCur = 0, playDur = 0; // live progress of the currently playing track
let padCrossfadeMs = 0;      // crossfade duration for pad triggers
let capturingFor = -1;      // index of the track awaiting a hotkey, or -1
let sceneEditing = -1;      // playlist index whose scene editor is open
let sceneImgTarget = -1, sceneCueTarget = -1; // track/cue awaiting an image
let activeCues = [], firedCue = -1;            // cue schedule for the playing track

function serializePlaylist() {
  return playlist.map(t => ({ path: t.path, name: t.name, key: t.key || null, cues: t.cues || [], isVideo: !!t.isVideo }));
}
function normalizeTrack(t) {
  return { path: t.path, name: t.name || baseName(t.path), key: t.key || null, cues: Array.isArray(t.cues) ? t.cues : [], isVideo: !!t.isVideo };
}
function savePlaylistState() {
  if (djv.savePlaylist) djv.savePlaylist(serializePlaylist());
}

function hasScene(tr) {
  return !!(tr.cues && tr.cues.some(c => c.effectIndex != null || (c.text && c.text.trim()) || c.image));
}
function parseTime(str) {
  str = String(str).trim();
  if (str.indexOf(':') >= 0) { const p = str.split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }
  return parseFloat(str) || 0;
}

// Snapshot the current Text-tab styling for a cue.
function captureTextStyle() {
  return {
    dir: $('#ticker-dir').value,
    fx: $('#ticker-fx').value,
    font: $('#ticker-font').value,
    size: parseFloat($('#ticker-size').value),
    weight: $('#ticker-bold').checked,
    color: $('#ticker-color').value
  };
}
const FX_NAMES = { none: 'Nessuno', updown: 'Su-giù', wave: 'Onda', zoom: 'Zoom', flash: 'Flash', rotate: 'Rotazione' };
function textStyleSummary(ts) {
  if (!ts) return 'stile attuale del pannello';
  const dir = ts.dir === 'h' ? 'Orizz.' : (ts.dir === 'vup' ? 'Vert.↑' : 'Vert.↓');
  return dir + ' · ' + (FX_NAMES[ts.fx] || ts.fx) + ' · ' + ts.size + 'vh';
}
const IMG_POS = { center: { x: 50, y: 50 }, top: { x: 50, y: 18 }, bottom: { x: 50, y: 82 }, left: { x: 20, y: 50 }, right: { x: 80, y: 50 } };

// Apply one cue (effect optional; text and image always set so a timeline reads
// predictably — empty text / null image hide them).
function applyCue(c) {
  if (!c) return;
  if (c.effectIndex != null && EFFECTS.list[c.effectIndex]) applyEffect(EFFECTS.list[c.effectIndex]);

  // Text + its full styling
  const showText = !!(c.text && c.text.trim());
  send({ type: 'tickerText', text: c.text || '' });
  send({ type: 'tickerOn', on: showText });
  $('#ticker-text').value = c.text || '';
  $('#ticker-on').checked = showText;
  const ts = c.textStyle;
  if (ts) {
    send({ type: 'tickerDir', value: ts.dir });
    send({ type: 'tickerFx', value: ts.fx });
    send({ type: 'tickerFont', value: ts.font });
    send({ type: 'tickerSize', value: ts.size });
    send({ type: 'tickerWeight', on: ts.weight });
    send({ type: 'tickerColor', value: ts.color });
    $('#ticker-dir').value = ts.dir; $('#ticker-fx').value = ts.fx;
    $('#ticker-font').value = ts.font; $('#ticker-size').value = ts.size;
    $('#ticker-size-val').textContent = (+ts.size).toFixed(1);
    $('#ticker-bold').checked = ts.weight; $('#ticker-color').value = ts.color;
  }

  // Image + size/position
  if (c.image) {
    const p = IMG_POS[c.imagePos || 'center'] || IMG_POS.center;
    send({ type: 'sceneImage', path: c.image, size: c.imageSize || 60, x: p.x, y: p.y });
  } else {
    send({ type: 'sceneImage', path: null });
  }
}
function startCues(tr) {
  activeCues = (tr.cues || []).slice().sort((a, b) => a.time - b.time);
  firedCue = -1;
  advanceCues(0); // apply the base cue (time 0)
}
function advanceCues(t) {
  while (firedCue + 1 < activeCues.length && t >= activeCues[firedCue + 1].time) {
    firedCue++;
    applyCue(activeCues[firedCue]);
  }
}

const baseName = (p) => p.split('/').pop();

function probePaths(paths) {
  const todo = paths.filter(p => p && !(p in durations));
  if (todo.length) send({ type: 'probeDurations', paths: todo });
}

function addTracks(items) {
  // items: array of { path, name }
  const start = playlist.length;
  items.forEach(it => { if (it.path) playlist.push({ path: it.path, name: it.name || baseName(it.path), key: null, cues: [], isVideo: !!it.isVideo }); });
  renderPlaylist();
  savePlaylistState();
  probePaths(items.map(it => it.path));
  // Auto-start the first added track if nothing is playing yet.
  if (currentIndex < 0 && playlist.length > start) playIndex(start);
}

function playIndex(i) {
  if (i < 0 || i >= playlist.length) return;
  currentIndex = i;
  isPlaying = true;
  ended = false;
  playbackOwner = 'playlist';
  activePad = -1; padPlaying = false; renderPads();
  send({ type: playlist[i].isVideo ? 'playVideoTrack' : 'playTrack', path: playlist[i].path });
  startCues(playlist[i]);
  $('#btn-play').disabled = false;
  $('#btn-play').textContent = '⏸ Pausa';
  renderPlaylist();
}

function nextTrack() {
  if (!playlist.length) return false;
  let n = currentIndex + 1;
  if (n >= playlist.length) { if (!repeat) return false; n = 0; }
  playIndex(n);
  return true;
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

function defaultCue(time) {
  return { time, effectIndex: null, effectName: '', text: '', textStyle: null, image: null, imageSize: 60, imagePos: 'center' };
}

// Build the per-track scene editor (timeline of cues with text + image styling).
function buildSceneEditor(tr, i, li) {
  const cues = tr.cues || (tr.cues = []);
  if (cues.length === 0) cues.push(defaultCue(0));
  cues.sort((a, b) => a.time - b.time);
  const ed = document.createElement('li');
  ed.className = 'scene-editor';

  const posLabels = { center: 'Centro', top: 'Alto', bottom: 'Basso', left: 'Sinistra', right: 'Destra' };
  let html = '<div class="se-title">🎬 Scene a tempo <small>— la cue @00:00 parte col brano, le altre scattano al loro tempo</small></div>';
  cues.forEach((c, ci) => {
    html +=
      '<div class="cue" data-c="' + ci + '">' +
        '<div class="cue-head">' +
          '<span class="cue-at">@</span>' +
          '<input class="cue-time" type="text" value="' + fmtTime(Math.floor(c.time)) + '" title="Tempo (mm:ss)" />' +
          '<button class="cue-eff" title="Usa l\'effetto attualmente visibile">🌀 ' + (c.effectName || 'imposta effetto') + '</button>' +
          (ci > 0 ? '<button class="cue-del" title="Rimuovi cue">✕</button>' : '<span class="cue-base">base</span>') +
        '</div>' +
        '<div class="cue-block">' +
          '<div class="cue-bh">🔤 Testo</div>' +
          '<input class="cue-text textfield" placeholder="Testo (vuoto = nessuno)" />' +
          '<div class="cue-row">' +
            '<button class="cue-tstyle">🎨 Cattura stile</button>' +
            '<span class="cue-tinfo">' + textStyleSummary(c.textStyle) + '</span>' +
            (c.textStyle ? '<button class="cue-tstyle-clear" title="Stile predefinito">✕</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cue-block">' +
          '<div class="cue-bh">🖼 Immagine</div>' +
          '<div class="cue-row">' +
            '<button class="cue-img">Carica…</button>' +
            '<button class="cue-img-clear">✕</button>' +
            '<span class="cue-name">' + (c.image ? baseName(c.image) : 'nessuna') + '</span>' +
          '</div>' +
          (c.image ?
            '<div class="cue-row"><select class="cue-img-pos">' +
              Object.keys(posLabels).map(p => '<option value="' + p + '"' + ((c.imagePos || 'center') === p ? ' selected' : '') + '>' + posLabels[p] + '</option>').join('') +
            '</select><span class="cue-dim">Dim</span><input class="cue-img-size" type="range" min="10" max="100" step="1" value="' + (c.imageSize || 60) + '" /></div>'
            : '') +
        '</div>' +
      '</div>';
  });
  html += '<div class="se-foot"><button class="cue-add">➕ Aggiungi cue</button><button class="se-clear">🗑 Rimuovi scena</button></div>';
  ed.innerHTML = html;

  ed.querySelectorAll('.cue').forEach(cueEl => {
    const ci = parseInt(cueEl.dataset.c, 10);
    const c = cues[ci];
    cueEl.querySelector('.cue-text').value = c.text || '';
    cueEl.querySelector('.cue-time').addEventListener('change', (e) => { c.time = parseTime(e.target.value); savePlaylistState(); renderPlaylist(); });
    cueEl.querySelector('.cue-eff').addEventListener('click', () => { c.effectIndex = EFFECTS.list.indexOf(currentEffect); c.effectName = currentEffect.name; savePlaylistState(); renderPlaylist(); });
    cueEl.querySelector('.cue-text').addEventListener('input', (e) => { c.text = e.target.value; li.querySelector('.scene-btn').classList.toggle('active', hasScene(tr)); savePlaylistState(); });
    cueEl.querySelector('.cue-tstyle').addEventListener('click', () => { c.textStyle = captureTextStyle(); savePlaylistState(); renderPlaylist(); });
    const tsc = cueEl.querySelector('.cue-tstyle-clear');
    if (tsc) tsc.addEventListener('click', () => { c.textStyle = null; savePlaylistState(); renderPlaylist(); });
    cueEl.querySelector('.cue-img').addEventListener('click', () => { sceneImgTarget = i; sceneCueTarget = ci; $('#scene-img-input').click(); });
    cueEl.querySelector('.cue-img-clear').addEventListener('click', () => { c.image = null; savePlaylistState(); renderPlaylist(); });
    const posSel = cueEl.querySelector('.cue-img-pos');
    if (posSel) posSel.addEventListener('change', (e) => { c.imagePos = e.target.value; savePlaylistState(); });
    const sizeSl = cueEl.querySelector('.cue-img-size');
    if (sizeSl) sizeSl.addEventListener('input', (e) => { c.imageSize = parseInt(e.target.value, 10); savePlaylistState(); });
    const del = cueEl.querySelector('.cue-del');
    if (del) del.addEventListener('click', () => { cues.splice(ci, 1); savePlaylistState(); renderPlaylist(); });
  });
  ed.querySelector('.cue-add').addEventListener('click', () => {
    const lastT = cues.length ? cues[cues.length - 1].time : 0;
    cues.push(defaultCue(lastT + 30));
    savePlaylistState(); renderPlaylist();
  });
  ed.querySelector('.se-clear').addEventListener('click', () => { tr.cues = []; sceneEditing = -1; savePlaylistState(); renderPlaylist(); });
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
    const playIcon = (isCur && isPlaying) ? '⏸' : '▶';
    let timeLabel = '';
    if (isCur && playDur > 0) timeLabel = '-' + fmtTime(Math.floor(Math.max(0, playDur - playCur)));
    else if (durations[tr.path] > 0) timeLabel = fmtTime(Math.floor(durations[tr.path]));
    const prog = (isCur && playDur > 0) ? Math.min(100, playCur / playDur * 100) : 0;
    li.innerHTML =
      '<span class="grip">⠿</span>' +
      '<span class="tname" title="Avvia / riavvia dall\'inizio — ' + tr.name.replace(/"/g, '&quot;') + '">' + (tr.isVideo ? '🎞 ' : '') + tr.name + '</span>' +
      '<span class="ttime">' + timeLabel + '</span>' +
      '<button class="key-btn" title="Assegna tasto rapido">' +
        (capturingFor === i ? '…' : (tr.key ? tr.key.toUpperCase() : '⌨')) + '</button>' +
      '<button class="play-btn" title="' + (isCur && isPlaying ? 'Pausa' : 'Avvia') + '">' + playIcon + '</button>' +
      '<button class="scene-btn' + (hasScene(tr) ? ' active' : '') + '" title="Scena del brano (effetto/testo/immagine)">🎬</button>' +
      '<button class="del-btn" title="Rimuovi">✕</button>' +
      (isCur ? '<i class="tprog" style="width:' + prog.toFixed(1) + '%"></i>' : '');

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
    tr.cues = tr.cues || [];
    if (!tr.cues[sceneCueTarget]) sceneCueTarget = 0;
    if (!tr.cues[sceneCueTarget]) tr.cues.push(defaultCue(0));
    tr.cues[sceneCueTarget].image = p;
    savePlaylistState(); renderPlaylist();
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
$('#tvid-blend').addEventListener('change', (e) => send({ type: 'trackVideoBlend', value: e.target.value }));
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
  playbackOwner = 'pad';
  activePad = i; padPlaying = true;
  activeCues = []; firedCue = -1; // pads don't run playlist cues
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
      } else if (!nextTrack()) {
        // No next track: reset to a stopped state so the button shows ▶ again.
        isPlaying = false;
        ended = true;
        $('#btn-play').textContent = '▶ Play';
        renderPlaylist();
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
