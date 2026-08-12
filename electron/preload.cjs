const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mugenBridge', {
  getBridgeStatus: () => ipcRenderer.invoke('mugen:status'),
  loadSettings: () => ipcRenderer.sendSync('mugen:settings:load'),
  openPreview: (image) => ipcRenderer.invoke('mugen:preview:open', image),
  recordGenerationRequest: (entry) => ipcRenderer.send('mugen:generation:request', entry),
  saveSettings: (settings) => ipcRenderer.invoke('mugen:settings:save', settings),
  invoke: (command, payload) => ipcRenderer.invoke('mugen:invoke', command, payload)
})
