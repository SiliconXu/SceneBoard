const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sceneBoardDesktop', {
  save: (filename, bytes) => ipcRenderer.invoke('portable:save', filename, bytes),
  copyText: text => ipcRenderer.invoke('portable:clipboard', text),
})
