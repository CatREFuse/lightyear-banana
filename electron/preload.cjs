const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lightyearBridge', {
  getBridgeStatus: () => ipcRenderer.invoke('lightyear:status'),
  loadSettings: () => ipcRenderer.sendSync('lightyear:settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('lightyear:settings:save', settings),
  invoke: (command, payload) => ipcRenderer.invoke('lightyear:invoke', command, payload),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lightyear:event', listener)
    return () => ipcRenderer.removeListener('lightyear:event', listener)
  }
})
