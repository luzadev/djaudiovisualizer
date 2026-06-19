const { app, BrowserWindow, screen, ipcMain, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let controlWin = null;   // panel with all the controls (primary screen)
let outputWin = null;    // pure visualization (external screen, fullscreen)

function externalDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find(d => d.id !== primary.id) || primary;
}

function createWindows() {
  const primary = screen.getPrimaryDisplay();
  const ext = externalDisplay();
  const hasExternal = ext.id !== primary.id;

  console.log(`[DJV] Schermi rilevati: ${screen.getAllDisplays().length}` +
    ` — esterno ${hasExternal ? 'SÌ' : 'NO'} (output su ${hasExternal ? 'monitor esterno' : 'principale, finestra'})`);

  // --- Control window (the panel) ---
  controlWin = new BrowserWindow({
    width: 580,
    height: 880,
    minWidth: 420,
    x: primary.bounds.x + 60,
    y: primary.bounds.y + 60,
    title: 'DJ Visualizer — Controlli',
    backgroundColor: '#0e0e16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--role=control']
    }
  });
  controlWin.loadFile(path.join(__dirname, 'src', 'control.html'));

  // --- Output window (the visuals) ---
  outputWin = new BrowserWindow({
    width: hasExternal ? ext.bounds.width : 960,
    height: hasExternal ? ext.bounds.height : 600,
    x: hasExternal ? ext.bounds.x : primary.bounds.x + 520,
    y: hasExternal ? ext.bounds.y : primary.bounds.y + 60,
    title: 'DJ Visualizer — Output',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--role=output'],
      // Let audio loaded via IPC play without a click inside the output window.
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  outputWin.loadFile(path.join(__dirname, 'src', 'output.html'));
  if (hasExternal) {
    outputWin.once('ready-to-show', () => placeOutputOnDisplay(ext, true));
  }

  controlWin.on('closed', () => {
    controlWin = null;
    if (outputWin) outputWin.close();
    app.quit();
  });
  outputWin.on('closed', () => { outputWin = null; });
}

async function ensureMicAccess() {
  if (process.platform !== 'darwin') return;
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status !== 'granted') await systemPreferences.askForMediaAccess('microphone');
  } catch (e) { /* getUserMedia will prompt again if needed */ }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'build', 'icon_1024.png')); } catch (e) { /* non-fatal */ }
  }
  await ensureMicAccess();
  createWindows();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- IPC routing between the two windows --------------------------------

// Control -> Output (commands).
ipcMain.on('ctl', (_e, msg) => {
  if (outputWin && !outputWin.isDestroyed()) outputWin.webContents.send('ctl', msg);
});

// Output -> Control (reports: meters, device list, play state).
ipcMain.on('rpt', (_e, msg) => {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('rpt', msg);
});

// --- Display management --------------------------------------------------

// --- Recording: receive WebM chunks, mux to MP4 at a chosen aspect ratio ---
let recStream = null, recTempPath = null;

function ffmpegPath() {
  const cands = [];
  try { cands.push(require('ffmpeg-static')); } catch (e) { /* optional */ }
  cands.push(process.env.FFMPEG, 'ffmpeg',
    '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  for (const c of cands) {
    if (!c) continue;
    if (c === 'ffmpeg' || fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

function transcodeToMp4(input, output, opts) {
  const w = (opts && opts.w) || 1920;
  const h = (opts && opts.h) || 1080;
  // Cover the target frame then centre-crop, so the chosen aspect is filled
  // without distortion.
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const args = ['-y', '-i', input, '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error('ffmpeg: ' + String(stderr || err.message).slice(-500)));
      else resolve();
    });
  });
}

function recordingsDir() {
  const dir = path.join(app.getPath('videos'), 'DJ Visualizer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('rec:start', () => {
  recTempPath = path.join(app.getPath('temp'), 'djv-rec-' + Date.now() + '.webm');
  recStream = fs.createWriteStream(recTempPath);
  return true;
});

ipcMain.on('rec:chunk', (_e, bytes) => {
  if (recStream && bytes) recStream.write(Buffer.from(bytes));
});

ipcMain.handle('rec:stop', async (_e, opts) => {
  if (!recStream) return { ok: false, error: 'Nessuna registrazione attiva' };
  await new Promise(r => recStream.end(r));
  const temp = recTempPath;
  recStream = null; recTempPath = null;
  try {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const outPath = path.join(recordingsDir(), 'rec-' + stamp + '.mp4');
    await transcodeToMp4(temp, outPath, opts);
    try { fs.unlinkSync(temp); } catch (e) { /* ignore */ }
    return { ok: true, path: outPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('rec:openFolder', () => {
  const dir = recordingsDir();
  shell.openPath(dir);
  return dir;
});

// --- Pad bank persistence ---
const padsFile = () => path.join(app.getPath('userData'), 'pads.json');
ipcMain.handle('pads:load', () => {
  try { return JSON.parse(fs.readFileSync(padsFile(), 'utf8')); } catch (e) { return null; }
});
ipcMain.handle('pads:save', (_e, data) => {
  try { fs.writeFileSync(padsFile(), JSON.stringify(data)); return true; } catch (e) { return false; }
});

// Read the bundled svg/ folder and return each SVG as a data: URL.
ipcMain.handle('svg:listBuiltin', () => {
  try {
    const dir = path.join(__dirname, 'svg');
    return fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.svg'))
      .map(f => {
        const txt = fs.readFileSync(path.join(dir, f), 'utf8');
        const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(txt, 'utf8').toString('base64');
        const name = f
          .replace(/\.svg$/i, '')
          .replace(/-svgrepo-com.*$/i, '')
          .replace(/^freesvg[\s-]+/i, '')
          .replace(/[-_]+/g, ' ')
          .trim();
        return { name: name || f, dataUrl };
      });
  } catch (e) { return []; }
});

ipcMain.handle('displays:list', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    index: i,
    label: d.label || `Display ${i + 1}`,
    bounds: d.bounds,
    isPrimary: d.id === primary.id
  }));
});

// Place the output window on a given display. On macOS we use *simple*
// fullscreen (a borderless window covering the screen) instead of native
// fullscreen: native fullscreen creates a Space tied to whichever display the
// window happens to be on and is unreliable when moving between monitors.
function placeOutputOnDisplay(target, fullscreen) {
  if (!outputWin || !target) return;
  // Leave any current fullscreen first so the window can be repositioned.
  if (process.platform === 'darwin') {
    if (outputWin.isSimpleFullScreen()) outputWin.setSimpleFullScreen(false);
  } else if (outputWin.isFullScreen()) {
    outputWin.setFullScreen(false);
  }

  // Move onto the target display.
  outputWin.setBounds({ ...target.bounds });
  outputWin.show();
  outputWin.focus();

  if (!fullscreen) return;
  // Cover the target display once the move has settled.
  setTimeout(() => {
    if (!outputWin) return;
    outputWin.setBounds({ ...target.bounds });
    if (process.platform === 'darwin') outputWin.setSimpleFullScreen(true);
    else outputWin.setFullScreen(true);
  }, 100);
}

// Move the OUTPUT window to a display and go fullscreen there.
ipcMain.handle('output:moveTo', (_e, displayId) => {
  const target = screen.getAllDisplays().find(d => d.id === displayId);
  if (!target) return false;
  placeOutputOnDisplay(target, true);
  return true;
});

ipcMain.handle('output:toggleFullscreen', () => {
  if (!outputWin) return false;
  if (process.platform === 'darwin') {
    const next = !outputWin.isSimpleFullScreen();
    outputWin.setSimpleFullScreen(next);
    return next;
  }
  outputWin.setFullScreen(!outputWin.isFullScreen());
  return outputWin.isFullScreen();
});
