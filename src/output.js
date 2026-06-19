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

// ---------------------------------------------------------------- recording
// Records the output canvas (video) + the audio tap into a WebM stream that
// main transcodes to MP4 at the chosen aspect ratio.
let recorder = null, recording = false, pendingRecOpts = null;
let recCanvas = null, recCtx = null, composeRAF = null;

function pickMime() {
  const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return 'video/webm';
}

// Composite the WebGL visual + DOM overlays (images, logos, ticker) into a 2D
// canvas so the recording captures everything that's on screen, not just WebGL.
function composeFrame() {
  const W = recCanvas.width, H = recCanvas.height;
  const sx = W / window.innerWidth, sy = H / window.innerHeight;
  recCtx.globalAlpha = 1;
  recCtx.globalCompositeOperation = 'source-over';
  recCtx.clearRect(0, 0, W, H);
  recCtx.drawImage(canvas, 0, 0, W, H);

  for (const im of images) {
    if (!im.classList.contains('show')) continue;
    const r = im.getBoundingClientRect();
    recCtx.globalAlpha = parseFloat(getComputedStyle(im).opacity) || 1;
    const bm = im.style.mixBlendMode;
    recCtx.globalCompositeOperation = (bm && bm !== 'normal') ? bm : 'source-over';
    try { recCtx.drawImage(im, r.x * sx, r.y * sy, r.width * sx, r.height * sy); } catch (e) {}
  }
  recCtx.globalAlpha = 1;
  recCtx.globalCompositeOperation = 'source-over';

  for (const l of logos) {
    if (!l.classList.contains('show')) continue;
    const r = l.getBoundingClientRect();
    recCtx.globalAlpha = parseFloat(l.style.opacity || '1');
    try { recCtx.drawImage(l, r.x * sx, r.y * sy, r.width * sx, r.height * sy); } catch (e) {}
  }
  recCtx.globalAlpha = 1;

  if (ticker.classList.contains('show')) {
    for (const span of tickerSpans) {
      const txt = span.textContent;
      if (!txt) continue;
      const r = span.getBoundingClientRect();
      if (r.right < 0 || r.left > window.innerWidth) continue;
      const cs = getComputedStyle(span);
      recCtx.font = cs.fontWeight + ' ' + (parseFloat(cs.fontSize) * sy) + 'px ' + cs.fontFamily;
      recCtx.fillStyle = cs.color;
      recCtx.textBaseline = 'middle';
      recCtx.shadowColor = 'rgba(140,180,255,0.9)';
      recCtx.shadowBlur = 16 * sy;
      recCtx.fillText(txt, r.x * sx, (r.y + r.height / 2) * sy);
      recCtx.shadowBlur = 0;
    }
  }
  composeRAF = requestAnimationFrame(composeFrame);
}

function stopCompose() {
  if (composeRAF) { cancelAnimationFrame(composeRAF); composeRAF = null; }
}

async function startRecording() {
  if (recording) return;
  try {
    await djv.recStart();
    recCanvas = document.createElement('canvas');
    recCanvas.width = canvas.width;
    recCanvas.height = canvas.height;
    recCtx = recCanvas.getContext('2d');
    composeFrame();
    const vstream = recCanvas.captureStream(30);
    const astream = audio.recordDest.stream;
    const stream = new MediaStream([...vstream.getVideoTracks(), ...astream.getAudioTracks()]);
    recorder = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 12e6 });
    // Serialise chunk delivery: ondataavailable is async, so without a chain the
    // header chunk could be sent after a later one and corrupt the WebM.
    let chain = Promise.resolve();
    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      chain = chain.then(async () => djv.recChunk(new Uint8Array(await e.data.arrayBuffer())));
    };
    recorder.onstop = async () => {
      stopCompose();
      await chain; // ensure every chunk is flushed, in order, before muxing
      const res = await djv.recStop(pendingRecOpts || {});
      recording = false;
      djv.report({ type: 'recState', recording: false });
      if (res && res.ok) djv.report({ type: 'recSaved', path: res.path });
      else djv.report({ type: 'recError', message: (res && res.error) || 'errore sconosciuto' });
    };
    recorder.start(2000); // emit a chunk every 2s
    recording = true;
    djv.report({ type: 'recState', recording: true });
  } catch (e) {
    stopCompose();
    djv.report({ type: 'recError', message: e.message });
  }
}

function stopRecording(opts) {
  if (!recording || !recorder) return;
  pendingRecOpts = { w: opts && opts.w, h: opts && opts.h };
  recorder.stop();
}

// Custom SVG/image source for the "SVG/Immagine" effect family. The image
// arrives as a data: URL (same-origin) so the canvas isn't tainted and the
// pixels can be uploaded to a WebGL texture.
function loadCustomTexture(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const size = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const iw = img.width || 512, ih = img.height || 512;
    const s = Math.min(size / iw, size / ih);
    const w = iw * s, h = ih * s;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    try { viz.setTexture(cv); hideHint(); }
    catch (e) { djv.report({ type: 'error', message: 'Texture SVG: ' + e.message }); }
  };
  img.onerror = () => djv.report({ type: 'error', message: 'SVG/immagine non caricata' });
  img.src = dataUrl;
}

// Two independent logos.
const logos = [$('#logo-0'), $('#logo-1')];
function setLogo(i, url) {
  if (!logos[i]) return;
  if (url) { logos[i].src = url; logos[i].classList.add('show'); hideHint(); }
  else { logos[i].classList.remove('show'); logos[i].removeAttribute('src'); }
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
    const inputs = await audio.listInputDevices();
    djv.report({ type: 'devices', list: inputs.map(d => ({ deviceId: d.deviceId, label: d.label })) });
    const outputs = await audio.listOutputDevices();
    djv.report({ type: 'outputs', list: outputs.map(d => ({ deviceId: d.deviceId, label: d.label })) });
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- command bus
djv.onControl(async (m) => {
  switch (m.type) {
    case 'effect': viz.setEffect(m.effect); break;
    case 'svg': loadCustomTexture(m.dataUrl); break;
    case 'recStart': startRecording(); break;
    case 'recStop': stopRecording(m); break;
    case 'gain': audio.gain = m.value; break;
    case 'speed': speed = m.value; break;
    case 'bandGain': audio[m.band + 'Gain'] = m.value; break;
    case 'outputDevice':
      try { await audio.setOutputDevice(m.deviceId || ''); }
      catch (e) { djv.report({ type: 'error', message: e.message }); }
      break;

    case 'loadFile':
      try {
        await audio.loadFile(toFileURL(m.path));
        hideHint();
        djv.report({ type: 'fileLoaded' });
        djv.report({ type: 'playState', playing: true });
      } catch (e) { djv.report({ type: 'error', message: e.message }); }
      break;
    case 'playTrack':
      try {
        audio.onEnded = () => djv.report({ type: 'trackEnded' });
        await audio.loadFile(toFileURL(m.path), { loop: false });
        hideHint();
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

    case 'logo': setLogo(m.index, m.path ? toFileURL(m.path) : ''); break;
    case 'logoX': logos[m.index].style.left = m.value + '%'; break;
    case 'logoY': logos[m.index].style.top = m.value + '%'; break;
    case 'logoSize': logos[m.index].style.width = m.value + 'vw'; break;
    case 'logoOpacity': logos[m.index].style.opacity = m.value; break;

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
let frames = 0, fpsT = performance.now(), fps = 0, lastReport = 0, prevBeat = 0;

function frame() {
  const t = (performance.now() - startTime) / 1000;
  audio.update();
  const a = audio.values;
  viz.render(t * speed, a);

  // Report beat rising-edges so the control window can auto-cycle effects.
  if (a.beat > 0.6 && prevBeat <= 0.6) djv.report({ type: 'beat' });
  prevBeat = a.beat;

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
