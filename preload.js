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
  // Bundled svg/ folder, read in the main process, as same-origin data URLs.
  listBuiltinSvgs: () => ipcRenderer.invoke('svg:listBuiltin'),
  // Resolve a dropped/picked File to its absolute filesystem path.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch (e) { return file && file.path ? file.path : null; }
  },
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  moveOutputTo: (id) => ipcRenderer.invoke('output:moveTo', id),
  toggleOutputFullscreen: () => ipcRenderer.invoke('output:toggleFullscreen'),
  // Recording (output streams chunks to main, which muxes/transcodes to MP4).
  recStart: () => ipcRenderer.invoke('rec:start'),
  recChunk: (bytes) => ipcRenderer.send('rec:chunk', bytes),
  recStop: (opts) => ipcRenderer.invoke('rec:stop', opts),
  openRecordingsFolder: () => ipcRenderer.invoke('rec:openFolder'),
  // Pad bank persistence.
  loadPads: () => ipcRenderer.invoke('pads:load'),
  savePads: (data) => ipcRenderer.invoke('pads:save', data),
  loadPlaylist: () => ipcRenderer.invoke('playlist:load'),
  savePlaylist: (data) => ipcRenderer.invoke('playlist:save', data),
  exportPlaylist: (data) => ipcRenderer.invoke('playlist:export', data),
  importPlaylist: () => ipcRenderer.invoke('playlist:import'),
  peaks: (path, buckets) => ipcRenderer.invoke('audio:peaks', path, buckets),
  readFile: (path) => ipcRenderer.invoke('file:read', path)
});
