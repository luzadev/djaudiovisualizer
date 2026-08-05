// Aux output window: a lightweight, visual-only renderer for one extra
// physical display. It has no audio engine of its own — the main output relays
// its analysis (~30 Hz on the 'afr' channel) and this window renders with it.
// Modes: 'follow' (same effect as the main output), 'effect' (own preset),
// 'image' (fullscreen picture), 'black'.
'use strict';

const cv = document.getElementById('gl');
const imgEl = document.getElementById('aux-image');
const viz = new Visualizer(cv);

const MY_ID = window.djv.displayId;

let mode = 'follow';
let ownEffect = null;      // effect object for mode 'effect'
let followEffect = null;   // last effect broadcast by the control panel

function toFileURL(p) {
  let n = String(p).replace(/\\/g, '/');
  if (n[0] !== '/') n = '/' + n;
  return encodeURI('file://' + n).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// Camera/3D families run hardware or heavy engines that must stay exclusive
// to the main output; an aux window falls back to a plain shader instead.
function safeEffect(e) {
  if (!e || e.isInteractive || e.isModel3d) return EFFECTS.defaults();
  return e;
}

function applyMode() {
  const showCanvas = mode === 'follow' || mode === 'effect';
  cv.style.display = showCanvas ? 'block' : 'none';
  imgEl.style.display = mode === 'image' && imgEl.src ? 'block' : 'none';
  if (mode === 'effect' && ownEffect) viz.setEffect(safeEffect(ownEffect));
  if (mode === 'follow' && followEffect) viz.setEffect(safeEffect(followEffect));
}

// Overlay text on top of whatever the mode shows (even plain black): the SAME
// ticker as the main output (structure + style.css), with the full option set
// of the Testo tab — direction, letter effect, font, position, size, speed.
const ticker = document.getElementById('ticker');
const tickerTrack = document.getElementById('ticker-track');
const tickCopies = ticker.querySelectorAll('.tick-copy');
const sideText = document.getElementById('side-text');
const sideCopies = sideText.querySelectorAll('.side-copy');
function buildLetters(txt) {
  const full = (txt || '') + '   •   ';
  let html = '';
  for (let i = 0; i < full.length; i++) {
    const c = full[i];
    const ch = c === ' ' ? ' ' : c.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    html += '<span class="tl" style="--i:' + i + '">' + ch + '</span>';
  }
  return html;
}
function styleBoth(prop, value) { tickerTrack.style[prop] = value; sideText.style[prop] = value; }
function applyText(c) {
  const on = !!(c && c.on && c.value && c.value.trim());
  const dir = (c && c.dir) || 'h';
  ticker.classList.toggle('show', on && dir !== 'sides');
  sideText.classList.toggle('show', on && dir === 'sides');
  if (!on) return;
  const h = buildLetters(c.value);
  tickCopies.forEach(el => el.innerHTML = h);
  sideCopies.forEach(el => el.innerHTML = h);
  ticker.classList.remove('dir-h', 'dir-vup', 'dir-vdown');
  if (dir !== 'sides') ticker.classList.add('dir-' + dir);
  ticker.classList.remove('pos-bottom', 'pos-top', 'pos-middle');
  ticker.classList.add('pos-' + (c.pos || 'bottom'));
  styleBoth('fontFamily', c.font || "-apple-system, BlinkMacSystemFont, sans-serif");
  styleBoth('fontSize', (c.size || 6) + 'vh');
  styleBoth('fontWeight', c.weight === false ? '400' : '800');
  styleBoth('color', c.color || '#ffffff');
  [tickerTrack, sideText].forEach(el => {
    el.classList.remove('fx-updown', 'fx-wave', 'fx-zoom', 'fx-flash', 'fx-rotate');
    if (c.fx && c.fx !== 'none') el.classList.add('fx-' + c.fx);
  });
  document.documentElement.style.setProperty('--ticker-dur', (18 / (c.speed || 1)) + 's');
}

// ---- audio + clock -------------------------------------------------------
// The relay carries the primary's clock (already speed-scaled). Between frames
// we extrapolate with the local rAF delta so motion stays 60fps-smooth, and a
// gentle correction keeps us glued to the primary without visible jumps.
let audioData = null;
let clockT = 0, clockAt = performance.now();

const SILENT = {
  bass: 0, mid: 0, treble: 0, level: 0, beat: 0,
  spectrum: new Float32Array(32), wave: new Float32Array(256), waveHist: new Float32Array(256)
};

window.djv.onAudio((d) => {
  audioData = d;
  const now = performance.now();
  const local = clockT + (now - clockAt) / 1000;
  clockAt = now;
  // Adopt the primary's time, but smoothly when the gap is small.
  clockT = Math.abs(d.t - local) > 0.5 ? d.t : local + (d.t - local) * 0.15;
});

window.djv.onControl((m) => {
  switch (m.type) {
    case 'effect':
      followEffect = m.effect;
      if (mode === 'follow') viz.setEffect(safeEffect(followEffect));
      break;
    case 'auxCfg': {
      if (m.displayId !== MY_ID) break;
      mode = m.mode || 'follow';
      if (m.effect) followEffect = m.effect;
      if (m.effectIndex != null && EFFECTS.list[m.effectIndex]) ownEffect = EFFECTS.list[m.effectIndex];
      if (m.image) imgEl.src = toFileURL(m.image);
      else if (m.mode !== 'image') imgEl.removeAttribute('src');
      applyMode();
      applyText(m.text);
      break;
    }
    case 'auxFx': {
      // Scene cue targeted at aux outputs. displayId -1 = every aux window,
      // but follow-mode windows ignore the broadcast form: they receive the
      // same effect through the normal 'effect' broadcast and switching them
      // to 'effect' mode would silently stop them from following afterwards.
      if (m.displayId !== MY_ID && !(m.displayId === -1 && mode !== 'follow')) break;
      const e = EFFECTS.list[m.effectIndex];
      if (e) { mode = 'effect'; ownEffect = e; applyMode(); }
      break;
    }
  }
});

function frame() {
  const now = performance.now();
  clockT += (now - clockAt) / 1000;
  clockAt = now;
  if (mode === 'follow' || mode === 'effect') {
    viz.render(clockT, audioData || SILENT);
  }
  // Ticker letters glow with the music, same formula as the main output.
  if (audioData) {
    tickerTrack.style.setProperty('--ticker-glow',
      (audioData.level * 24 + audioData.beat * 20).toFixed(0) + 'px');
    sideText.style.setProperty('--ticker-glow',
      (audioData.level * 24 + audioData.beat * 20).toFixed(0) + 'px');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Announce ourselves so the panel can (re)send this display's configuration.
window.djv.report({ type: 'auxReady', displayId: MY_ID });
