const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sceneBoardDesktop', {
  savePygameProject: (name, files) => ipcRenderer.invoke('portable:pygame-project', name, files),
  save: (filename, bytes) => ipcRenderer.invoke('portable:save', filename, bytes),
  copyText: text => ipcRenderer.invoke('portable:clipboard', text),
})
