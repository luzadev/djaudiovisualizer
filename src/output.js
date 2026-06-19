// OUTPUT window: renders the visuals + overlays and runs the audio engine.
// It receives commands from the control window via window.djv.onControl and
// sends back reports (meters, fps, device list, play state).

const $ = (s) => document.querySelector(s);

const canvas = $('#gl');
let viz;
try {
  viz = new Visualizer(canvas);
} catch (e) {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font-family:sans-serif">' +
    'Errore grafica:<br><pre>' + e.message + '</pre></div>';
  throw e;
}

const audio = new AudioEngine();
let speed = 1.0;

// Convert an absolute filesystem path into a file:// URL the renderer can load.
function toFileURL(p) {
  return encodeURI('file://' + p).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// ---------------------------------------------------------------- overlays
const imgLayer = $('#overlay-images');
let images = [];
let imgIndex = 0;
let slideshow = false, slideshowTimer = null, slideshowMs = 5000;
let beatPulse = true;
let imgBlend = 'screen';

function addImages(paths) {
  paths.forEach(p => {
    const img = document.createElement('img');
    img.src = toFileURL(p);
    img.style.mixBlendMode = imgBlend;
    imgLayer.appendChild(img);
    images.push(img);
  });
  if (images.length) showImage(images.length - paths.length);
  hideHint();
}
function showImage(i) {
  if (!images.length) return;
  imgIndex = (i + images.length) % images.length;
  images.forEach((im, idx) => im.classList.toggle('show', idx === imgIndex));
}
function clearImages() {
  images.forEach(im => im.remove());
  images = []; imgIndex = 0;
}
function restartSlideshow() {
  if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; }
  if (slideshow) slideshowTimer = setInterval(() => showImage(imgIndex + 1), slideshowMs);
}

const ticker = $('#ticker');
const tickerTrack = $('#ticker-track');
const tickerSpans = ticker.querySelectorAll('span');
function setTickerText(t) { tickerSpans.forEach(s => s.textContent = t + '   •   '); }
function setTickerSpeed(m) { tickerTrack.style.setProperty('--ticker-dur', (18 / m) + 's'); }
ticker.classList.add('pos-bottom');
setTickerSpeed(1);

function hideHint() { $('#drop-hint').classList.add('hidden'); }

// ---------------------------------------------------------------- audio devices
async function reportDevices() {
  try {
    const devices = await audio.listInputDevices();
    djv.report({ type: 'devices', list: devices.map(d => ({ deviceId: d.deviceId, label: d.label })) });
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- command bus
djv.onControl(async (m) => {
  switch (m.type) {
    case 'scene': viz.setScene(m.index); break;
    case 'gain': audio.gain = m.value; break;
    case 'speed': speed = m.value; break;

    case 'loadFile':
      try {
        await audio.loadFile(toFileURL(m.path));
        hideHint();
        djv.report({ type: 'fileLoaded' });
        djv.report({ type: 'playState', playing: true });
      } catch (e) { djv.report({ type: 'error', message: e.message }); }
      break;
    case 'togglePlay': {
      const playing = audio.togglePlay();
      if (playing !== null) djv.report({ type: 'playState', playing });
      break;
    }
    case 'useInput':
      try { await audio.useInput(m.deviceId || null); hideHint(); await reportDevices(); }
      catch (e) { djv.report({ type: 'error', message: e.message }); }
      break;
    case 'refreshDevices': reportDevices(); break;

    case 'addImages': addImages(m.paths); break;
    case 'clearImages': clearImages(); break;
    case 'imgBlend': imgBlend = m.value; images.forEach(im => im.style.mixBlendMode = m.value); break;
    case 'slideshow': slideshow = m.on; restartSlideshow(); break;
    case 'slideshowInterval': slideshowMs = m.ms; restartSlideshow(); break;
    case 'imgSize': imgLayer.style.setProperty('--img-size', m.value); break;
    case 'imgBeat': beatPulse = m.on; break;
    case 'imgNext': showImage(imgIndex + 1); break;
    case 'imgPrev': showImage(imgIndex - 1); break;

    case 'tickerText': setTickerText(m.text); break;
    case 'tickerOn': ticker.classList.toggle('show', m.on); break;
    case 'tickerPos':
      ticker.classList.remove('pos-bottom', 'pos-top', 'pos-middle');
      ticker.classList.add('pos-' + m.pos);
      break;
    case 'tickerSpeed': setTickerSpeed(m.mult); break;
  }
});

// ---------------------------------------------------------------- render loop
const startTime = performance.now();
let frames = 0, fpsT = performance.now(), fps = 0, lastReport = 0;

function frame() {
  const t = (performance.now() - startTime) / 1000;
  audio.update();
  const a = audio.values;
  viz.render(t * speed, a);

  // Overlays react to audio.
  imgLayer.style.setProperty('--beat-scale',
    (beatPulse && images.length ? 1 + a.beat * 0.12 + a.bass * 0.05 : 1).toFixed(3));
  tickerTrack.style.setProperty('--ticker-glow', (a.level * 24 + a.beat * 20).toFixed(0) + 'px');

  // FPS + meter report to the control window (throttled to ~15 Hz).
  frames++;
  const now = performance.now();
  if (now - fpsT > 500) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
  if (now - lastReport > 66) {
    lastReport = now;
    djv.report({ type: 'meters', bass: a.bass, mid: a.mid, treble: a.treble, fps });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Populate the device list once at startup so the control dropdown fills in.
reportDevices();
