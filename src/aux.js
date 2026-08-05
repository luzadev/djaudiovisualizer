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

// Overlay text on top of whatever the mode shows (even plain black).
const txtEl = document.getElementById('aux-text');
const txtInner = document.getElementById('aux-text-inner');
function applyText(c) {
  const on = !!(c && c.on && c.value && c.value.trim());
  txtEl.style.display = on ? 'block' : 'none';
  if (!on) return;
  txtInner.textContent = c.value;
  txtEl.className = c.scroll ? 'scroll' : 'static';
  txtEl.style.fontSize = (c.size || 8) + 'vh';
  txtEl.style.color = c.color || '#ffffff';
  txtEl.style.fontWeight = c.weight === false ? 'normal' : '900';
  const pos = c.pos || 'middle';
  txtEl.style.top = pos === 'top' ? '6%' : pos === 'bottom' ? 'auto' : '50%';
  txtEl.style.bottom = pos === 'bottom' ? '6%' : 'auto';
  txtEl.style.transform = pos === 'middle' ? 'translateY(-50%)' : 'none';
  // Longer texts scroll at the same apparent speed: duration scales with length.
  const base = 8 + c.value.length * 0.35;
  txtEl.style.setProperty('--aux-scroll-dur', (base / (c.speed || 1)).toFixed(1) + 's');
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
  }
});

function frame() {
  if (mode === 'follow' || mode === 'effect') {
    const now = performance.now();
    clockT += (now - clockAt) / 1000;
    clockAt = now;
    viz.render(clockT, audioData || SILENT);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Announce ourselves so the panel can (re)send this display's configuration.
window.djv.report({ type: 'auxReady', displayId: MY_ID });
