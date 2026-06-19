// CONTROL window: builds the UI and sends commands to the output window.
// It also receives reports (meters, fps, device list, play state).

const $ = (s) => document.querySelector(s);
const send = (msg) => djv.send(msg);
const filePath = (f) => djv.pathForFile(f);

// ---------------------------------------------------------------- scenes
const sceneNames = (window.SHADERS && window.SHADERS.names) ||
  ['Frattale', 'Plasma', 'Tunnel', 'Vortice', 'Onde', 'Cellule', 'Iperspazio', 'Specchi'];
const sceneContainer = $('#scene-buttons');
sceneNames.forEach((name, i) => {
  const b = document.createElement('button');
  b.dataset.scene = i;
  b.textContent = (i + 1) + ' · ' + name;
  if (i === 0) b.classList.add('active');
  sceneContainer.appendChild(b);
});

function setScene(i) {
  if (i < 0 || i >= sceneNames.length) return;
  send({ type: 'scene', index: i });
  $('#scene-name').textContent = sceneNames[i];
  document.querySelectorAll('#scene-buttons button').forEach((b, idx) =>
    b.classList.toggle('active', idx === i));
}
sceneContainer.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setScene(parseInt(b.dataset.scene, 10));
});

// ---------------------------------------------------------------- audio
$('#btn-file').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  const p = f && filePath(f);
  if (p) {
    send({ type: 'loadFile', path: p });
    $('#btn-play').disabled = false;
    $('#btn-play').textContent = '⏸ Pausa';
  }
});
$('#btn-play').addEventListener('click', () => send({ type: 'togglePlay' }));
$('#btn-use-input').addEventListener('click', () =>
  send({ type: 'useInput', deviceId: $('#device-select').value || null }));

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

// ---------------------------------------------------------------- ticker
$('#ticker-text').addEventListener('input', (e) => send({ type: 'tickerText', text: e.target.value }));
$('#ticker-on').addEventListener('change', (e) => send({ type: 'tickerOn', on: e.target.checked }));
$('#ticker-pos').addEventListener('change', (e) => send({ type: 'tickerPos', pos: e.target.value }));
$('#ticker-speed').addEventListener('input', (e) => {
  const m = parseFloat(e.target.value);
  $('#ticker-speed-val').textContent = m.toFixed(1) + '×';
  send({ type: 'tickerSpeed', mult: m });
});

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

// ---------------------------------------------------------------- drag & drop
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragover'); });
window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragover'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const files = [...e.dataTransfer.files];
  const audioFile = files.find(f => f.type.startsWith('audio/'));
  const imgPaths = files.filter(f => f.type.startsWith('image/')).map(filePath).filter(Boolean);
  const audioPath = audioFile && filePath(audioFile);
  if (audioPath) {
    send({ type: 'loadFile', path: audioPath });
    $('#btn-play').disabled = false;
  }
  if (imgPaths.length) send({ type: 'addImages', paths: imgPaths });
});

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if (e.key >= '1' && e.key <= '9') { setScene(parseInt(e.key, 10) - 1); return; }
  switch (e.key.toLowerCase()) {
    case 'f': djv.toggleOutputFullscreen(); break;
    case 'o': $('#file-input').click(); break;
    case 'g': $('#image-input').click(); break;
    case 'arrowright': send({ type: 'imgNext' }); break;
    case 'arrowleft': send({ type: 'imgPrev' }); break;
    case 't': { const cb = $('#ticker-on'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); break; }
    case ' ': e.preventDefault(); send({ type: 'togglePlay' }); break;
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
    case 'meters':
      $('#m-bass').style.width = (m.bass * 100).toFixed(0) + '%';
      $('#m-mid').style.width = (m.mid * 100).toFixed(0) + '%';
      $('#m-treble').style.width = (m.treble * 100).toFixed(0) + '%';
      $('#fps').textContent = m.fps.toFixed(0) + ' fps';
      break;
    case 'playState':
      $('#btn-play').disabled = false;
      $('#btn-play').textContent = m.playing ? '⏸ Pausa' : '▶ Play';
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
refreshDisplays();
window.addEventListener('focus', refreshDisplays);
send({ type: 'refreshDevices' });
