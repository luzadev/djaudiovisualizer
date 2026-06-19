// Renders build/icon-source.html offscreen and writes build/icon_1024.png.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false,
    webPreferences: { offscreen: false } });
  win.loadFile(path.join(__dirname, 'icon-source.html'));
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const dataUrl = await win.webContents.executeJavaScript(
        'document.getElementById("c").toDataURL("image/png")');
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(__dirname, 'icon_1024.png'), Buffer.from(b64, 'base64'));
      console.log('WROTE icon_1024.png');
      app.quit();
    }, 400);
  });
});
app.on('window-all-closed', () => app.quit());
