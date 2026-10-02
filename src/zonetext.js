// Animated text for ONE mapping zone: drawn every frame on a transparent 2D
// canvas sized to the zone's on-screen proportions, then warped into the zone
// by the mapping engine as an alpha overlay. Mirrors the options of the
// playlist text element (direction, letter effect, font, position, size,
// weight, colour, speed) and glows with the music like the main ticker.
(function () {

class ZoneText {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cfg = null;
    this.t0 = performance.now();
  }

  // cfg: the scene text element; aspect: zone width/height in output pixels
  set(cfg, aspect) {
    const restart = !this.cfg || this.cfg.text !== cfg.text || this.cfg.dir !== cfg.dir;
    this.cfg = cfg;
    const a = Math.max(0.15, Math.min(8, aspect || 16 / 9));
    const W = a >= 1 ? 1024 : Math.round(1024 * a);
    const H = a >= 1 ? Math.round(1024 / a) : 1024;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    if (restart) this.t0 = performance.now();
  }

  render(audio) {
    const c = this.cfg, ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!c || !c.text || !c.text.trim()) return;
    const t = (performance.now() - this.t0) / 1000;
    const beat = (audio && audio.beat) || 0, level = (audio && audio.level) || 0;
    const sp = c.speed || 1;
    // size 2..18 (vh on the main ticker) -> share of the zone height
    const fs = Math.max(8, H * (c.size || 6) * 0.03);
    ctx.font = (c.weight === false ? '400 ' : '800 ') + fs + 'px ' + (c.font || 'sans-serif');
    ctx.textBaseline = 'middle';
    ctx.fillStyle = c.color || '#ffffff';
    ctx.shadowColor = c.color || '#ffffff';
    ctx.shadowBlur = 6 + level * 24 + beat * 20;
    const txt = c.text + '   •   ';
    const tw = ctx.measureText(txt).width;
    const fx = c.fx || 'none';
    let alpha = 1, scale = 1, bob = 0;
    if (fx === 'flash') alpha = 0.35 + 0.65 * Math.min(1, beat + 0.2 * Math.sin(t * 6) + 0.2);
    if (fx === 'zoom') scale = 1 + beat * 0.25;
    if (fx === 'updown') bob = Math.sin(t * 3 * sp) * fs * 0.35;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    const dir = c.dir || 'h';
    if (dir === 'vup' || dir === 'vdown') {
      // the line travels vertically through the zone, centred horizontally
      const span = H + fs * 2, v = (t * sp * H / 4) % span;
      const y = dir === 'vup' ? H + fs - v : -fs + v;
      this._line(c.text, W / 2 - ctx.measureText(c.text).width * scale / 2, y + bob, fs, scale, fx, t, sp);
    } else {
      // horizontal marquee (also used for 'sides'): two copies for a seamless loop
      const y = (c.pos === 'top' ? H * 0.2 : c.pos === 'middle' ? H * 0.5 : H * 0.8) + bob;
      const off = (t * sp * W / 6) % (tw * scale);
      for (let x = -off; x < W; x += tw * scale) this._line(txt, x, y, fs, scale, fx, t, sp);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // one run of text, letter by letter when the effect moves single letters
  _line(s, x, y, fs, scale, fx, t, sp) {
    const ctx = this.ctx;
    if (fx !== 'wave' && fx !== 'rotate' && scale === 1) { ctx.fillText(s, x, y); return; }
    let cx = x;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const w = ctx.measureText(ch).width * scale;
      ctx.save();
      ctx.translate(cx + w / 2, y + (fx === 'wave' ? Math.sin(t * 4 * sp + i * 0.6) * fs * 0.25 : 0));
      if (fx === 'rotate') ctx.rotate(Math.sin(t * 3 * sp + i * 0.5) * 0.35);
      ctx.scale(scale, scale);
      ctx.fillText(ch, -w / scale / 2, 0);
      ctx.restore();
      cx += w;
    }
  }
}

window.ZoneText = ZoneText;
})();
