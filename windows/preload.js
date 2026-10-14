// The renderer's only way out: shells, config, clipboard, links and notifications, all through main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magica', {
  init: () => ipcRenderer.invoke('init'),
  spawn: opts => ipcRenderer.invoke('pty:spawn', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: id => ipcRenderer.send('pty:kill', id),
  onData: fn => ipcRenderer.on('pty:data', (_, id, data) => fn(id, data)),
  onExit: fn => ipcRenderer.on('pty:exit', (_, id, code) => fn(id, code)),
  saveTheme: name => ipcRenderer.send('theme:save', name),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: text => ipcRenderer.send('clipboard:write', text),
  resolvePath: (p, cwd) => ipcRenderer.invoke('path:resolve', p, cwd),
  open: target => ipcRenderer.send('open', target),
  notify: opts => ipcRenderer.send('notify', opts),
  flash: () => ipcRenderer.send('flash'),
  quitEmpty: () => ipcRenderer.send('quit-empty'),
  onSessionRequest: fn => ipcRenderer.on('session:get', () => ipcRenderer.send('session:save', fn())),
});
