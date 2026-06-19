const { app, BrowserWindow, screen, ipcMain, systemPreferences } = require('electron');
const path = require('path');

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
