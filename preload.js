const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Each window is launched with --role=control or --role=output.
const roleArg = process.argv.find(a => a.startsWith('--role='));
const role = roleArg ? roleArg.split('=')[1] : 'control';

contextBridge.exposeInMainWorld('djv', {
  role,
  // Control -> Output commands.
  send: (msg) => ipcRenderer.send('ctl', msg),
  onControl: (cb) => ipcRenderer.on('ctl', (_e, m) => cb(m)),
  // Output -> Control reports.
  report: (msg) => ipcRenderer.send('rpt', msg),
  onReport: (cb) => ipcRenderer.on('rpt', (_e, m) => cb(m)),
  // Display management (control window).
  // Resolve a dropped/picked File to its absolute filesystem path.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch (e) { return file && file.path ? file.path : null; }
  },
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  moveOutputTo: (id) => ipcRenderer.invoke('output:moveTo', id),
  toggleOutputFullscreen: () => ipcRenderer.invoke('output:toggleFullscreen')
});
