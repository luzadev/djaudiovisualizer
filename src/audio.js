// Audio engine: builds a Web Audio graph from either a loaded file or a live
// input device, runs an FFT analyser, and exposes smoothed bass/mid/treble/
// level values plus a simple beat detector.

class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);

    // Output gain so a loaded file is audible; live input stays muted to
    // avoid feedback (it's already playing through the system).
    this.outGain = this.ctx.createGain();
    this.outGain.gain.value = 1.0;
    this.outGain.connect(this.ctx.destination);

    this.sourceNode = null;   // current MediaElement / MediaStream source
    this.mediaEl = null;      // <audio> element when playing a file
    this.stream = null;       // MediaStream when using live input
    this.mode = 'none';

    // Smoothed band values and beat state.
    this.gain = 1.0;          // user reactivity multiplier
    this.bass = 0; this.mid = 0; this.treble = 0; this.level = 0;
    this.beat = 0;
    this._bassAvg = 0;        // running average for beat detection
    this._beatCooldown = 0;
  }

  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }

  _disconnectSource() {
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch (e) {} this.sourceNode = null; }
    if (this.mediaEl) { this.mediaEl.pause(); this.mediaEl.src = ''; this.mediaEl = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }

  // Play a File/Blob, or a src URL (e.g. file://…), through the analyser and
  // the speakers.
  async loadFile(fileOrSrc) {
    this.resume();
    this._disconnectSource();

    const el = new Audio();
    el.src = typeof fileOrSrc === 'string' ? fileOrSrc : URL.createObjectURL(fileOrSrc);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    this.mediaEl = el;

    const src = this.ctx.createMediaElementSource(el);
    src.connect(this.analyser);
    src.connect(this.outGain); // file audio is audible
    this.sourceNode = src;
    this.mode = 'file';

    await el.play();
    return el;
  }

  // Use a live input device (mic / line-in / BlackHole). Not routed to output
  // to avoid feedback loops.
  async useInput(deviceId) {
    this.resume();
    this._disconnectSource();

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.stream = stream;

    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.analyser); // analyser only — no output
    this.sourceNode = src;
    this.mode = 'input';
  }

  async listInputDevices() {
    // Labels are only populated after permission is granted.
    try { await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())); } catch (e) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  togglePlay() {
    if (!this.mediaEl) return null;
    if (this.mediaEl.paused) { this.mediaEl.play(); return true; }
    this.mediaEl.pause();
    return false;
  }

  // Sample the analyser and update smoothed values. Call once per frame.
  update() {
    this.analyser.getByteFrequencyData(this.freq);
    const bins = this.freq.length;          // 1024 bins, ~0..(sr/2)
    // Roughly: bass 0-6%, mid 6-25%, treble 25-65% of spectrum.
    const bassEnd = Math.floor(bins * 0.06);
    const midEnd = Math.floor(bins * 0.25);
    const trebEnd = Math.floor(bins * 0.65);

    let b = 0, m = 0, t = 0;
    for (let i = 0; i < bassEnd; i++) b += this.freq[i];
    for (let i = bassEnd; i < midEnd; i++) m += this.freq[i];
    for (let i = midEnd; i < trebEnd; i++) t += this.freq[i];
    b = b / (bassEnd * 255);
    m = m / ((midEnd - bassEnd) * 255);
    t = t / ((trebEnd - midEnd) * 255);

    const g = this.gain;
    // Smooth toward new values (attack/release) and apply user gain.
    this.bass = this._smooth(this.bass, Math.min(1, b * 1.6 * g), 0.5, 0.12);
    this.mid = this._smooth(this.mid, Math.min(1, m * 2.2 * g), 0.5, 0.12);
    this.treble = this._smooth(this.treble, Math.min(1, t * 3.0 * g), 0.6, 0.15);
    this.level = this._smooth(this.level, Math.min(1, (b + m + t) / 3 * 2.0 * g), 0.4, 0.1);

    // Beat detection: bass spike above running average.
    this._bassAvg = this._bassAvg * 0.94 + b * 0.06;
    this._beatCooldown -= 1;
    if (b > this._bassAvg * 1.35 && b > 0.12 && this._beatCooldown <= 0) {
      this.beat = 1.0;
      this._beatCooldown = 8; // ~min frames between beats
    } else {
      this.beat *= 0.86; // decay
    }

    return this;
  }

  _smooth(cur, target, attack, release) {
    const k = target > cur ? attack : release;
    return cur + (target - cur) * k;
  }

  get values() {
    return { bass: this.bass, mid: this.mid, treble: this.treble, level: this.level, beat: this.beat };
  }
}

window.AudioEngine = AudioEngine;
