const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Each window is launched with --role=control, --role=output or --role=aux.
const roleArg = process.argv.find(a => a.startsWith('--role='));
const role = roleArg ? roleArg.split('=')[1] : 'control';
// Aux outputs also get the id of the display they live on.
const dispArg = process.argv.find(a => a.startsWith('--display='));
const displayId = dispArg ? parseInt(dispArg.split('=')[1], 10) : -1;

contextBridge.exposeInMainWorld('djv', {
  role,
  displayId,
  // Audio analysis relay: main output -> aux outputs (~30 Hz).
  sendAudio: (data) => ipcRenderer.send('afr', data),
  onAudio: (cb) => ipcRenderer.on('afr', (_e, d) => cb(d)),
  // Create/close aux output windows to match the given display-id list.
  auxSync: (ids) => ipcRenderer.invoke('aux:sync', ids),
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
  // Ask macOS for camera permission (interactive family) right before use.
  camAccess: () => ipcRenderer.invoke('cam:ensure'),
  // Convert Mixamo FBX files via Blender: animation clips / character models.
  convertAnim: (p) => ipcRenderer.invoke('anim:convert', p),
  convertModel: (p) => ipcRenderer.invoke('model:convert', p),
  readFile: (path) => ipcRenderer.invoke('file:read', path)
});
